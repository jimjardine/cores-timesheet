// Shared reg/OT calculator — the single source of truth for how entry hours
// split into regular vs overtime. Used by Job Reports and the Timesheets tab
// so both always agree (they previously had diverging copies: the Timesheets
// copy didn't know about is_stat_pay, so the auto 8-hr stat entry wrongly
// consumed the weekly regular allowance there).
//
// Rules, in order, per entry:
//   1. is_stat_pay      → all regular; does NOT consume the weekly allowance
//                         and does NOT count as hours worked that day
//   2. manual ot_hours  → honoured as-is (reg = hours - ot_hours)
//   3. stat holiday or weekend → all OT from the first minute
//   4. otherwise        → regular up to the daily threshold, then up to the
//                         weekly threshold; the rest is OT

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function isWeekend(ymd) {
  const dow = new Date(ymd + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

function isFriday(ymd) {
  return new Date(ymd + 'T12:00:00').getDay() === 5
}

// Pay week runs Thu–Wed
function payWeekStartYMD(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7))
  return toYMD(d)
}

// A per-employee fixed schedule (e.g. Tracy's 8.75/day, 5 on Fridays) only
// covers a normal day — it's not a floor added on top of the standard OT
// rule. If dayTotalHours exceeds it, the whole day reverts to the standard
// dailyThreshold instead. Shared by computeOTMap (the real, final split) and
// by any UI that needs to preview a split before an entry is actually
// approved — those previews drifting out of sync with this rule is exactly
// what made "her OT exemption isn't working" look like a real bug on
// 2026-08-26 when it was really just an unrelated preview using the wrong
// threshold.
export function effectiveDailyThreshold(workDate, dailyThreshold, employeeThreshold, dayTotalHours) {
  if (!employeeThreshold) return dailyThreshold
  const personal = (isFriday(workDate) ? employeeThreshold.friday : employeeThreshold.daily) ?? null
  return personal != null && dayTotalHours <= personal ? personal : dailyThreshold
}

/**
 * @param {Array} entries        timesheet_entries rows (any mix of employees/weeks)
 * @param {Object} opts
 * @param {number} opts.dailyThreshold   default 8
 * @param {number} opts.weeklyThreshold  default 40
 * @param {Set<string>} opts.statHolidays  YMD strings; default empty
 * @param {Object} opts.employeeThresholds  employee_id → { daily, friday } — per-employee
 *   override for a fixed weekly schedule (e.g. office staff on 8.75/day + 5 Fri), used
 *   instead of the global dailyThreshold. Either field can be null to fall back to
 *   dailyThreshold for that day type. weeklyThreshold still applies globally on top.
 *   The override only covers a normal-length day: if the day's total hours exceed
 *   it, that whole day reverts to dailyThreshold instead — the special schedule
 *   isn't a floor added on top of the standard OT rule, it replaces it only for
 *   an ordinary day.
 * @returns {Object} map of entry id → { reg, ot, manual? }
 */
export function computeOTMap(entries, { dailyThreshold = 8, weeklyThreshold = 40, statHolidays = new Set(), employeeThresholds = {} } = {}) {
  const map = {}
  // Group by employee, then by pay week
  const byEmp = entries.reduce((acc, e) => {
    if (!acc[e.employee_id]) acc[e.employee_id] = {}
    const ws = payWeekStartYMD(e.work_date)
    if (!acc[e.employee_id][ws]) acc[e.employee_id][ws] = []
    acc[e.employee_id][ws].push(e)
    return acc
  }, {})
  Object.entries(byEmp).forEach(([employeeId, weeks]) => {
    const empOverride = employeeThresholds[employeeId]
    Object.values(weeks).forEach(weekEnts => {
      const inOrder = [...weekEnts].sort((a, b) =>
        a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1)
      )
      // Day totals up front — whether the override still applies to a given day
      // depends on the WHOLE day's hours, not just whichever entry is being
      // processed at the moment (a day can be split across several job entries).
      const dayTotals = {}
      if (empOverride) {
        inOrder.forEach(e => {
          if (!e.is_stat_pay) dayTotals[e.work_date] = (dayTotals[e.work_date] || 0) + Number(e.hours)
        })
      }
      let weeklyRegSoFar = 0, dayHoursSoFar = 0, currentDate = null
      inOrder.forEach(e => {
        if (e.work_date !== currentDate) { dayHoursSoFar = 0; currentDate = e.work_date }
        const hrs = Number(e.hours)
        if (e.is_stat_pay) {
          map[e.id] = { reg: hrs, ot: 0, manual: true }
        } else if (e.ot_hours !== null && e.ot_hours !== undefined) {
          const ot = Number(e.ot_hours), reg = hrs - ot
          map[e.id] = { reg, ot, manual: true }
          dayHoursSoFar += hrs; weeklyRegSoFar += reg
        } else if (statHolidays.has(e.work_date) || isWeekend(e.work_date)) {
          map[e.id] = { reg: 0, ot: hrs }
          dayHoursSoFar += hrs
        } else {
          const threshold = effectiveDailyThreshold(e.work_date, dailyThreshold, empOverride, dayTotals[e.work_date])
          const dailyRegRemaining  = Math.max(0, threshold - dayHoursSoFar)
          const dailyReg           = Math.min(hrs, dailyRegRemaining)
          const weeklyRegRemaining = Math.max(0, weeklyThreshold - weeklyRegSoFar)
          const actualReg          = Math.min(dailyReg, weeklyRegRemaining)
          map[e.id]                = { reg: actualReg, ot: (hrs - dailyReg) + (dailyReg - actualReg) }
          dayHoursSoFar           += hrs; weeklyRegSoFar += actualReg
        }
      })
    })
  })
  return map
}
