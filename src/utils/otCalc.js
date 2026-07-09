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
//   3. stat holiday     → all OT from the first minute
//   4. otherwise        → regular up to the daily threshold, then up to the
//                         weekly threshold; the rest is OT

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Pay week runs Thu–Wed
function payWeekStartYMD(ymd) {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7))
  return toYMD(d)
}

/**
 * @param {Array} entries        timesheet_entries rows (any mix of employees/weeks)
 * @param {Object} opts
 * @param {number} opts.dailyThreshold   default 8
 * @param {number} opts.weeklyThreshold  default 40
 * @param {Set<string>} opts.statHolidays  YMD strings; default empty
 * @returns {Object} map of entry id → { reg, ot, manual? }
 */
export function computeOTMap(entries, { dailyThreshold = 8, weeklyThreshold = 40, statHolidays = new Set() } = {}) {
  const map = {}
  // Group by employee, then by pay week
  const byEmp = entries.reduce((acc, e) => {
    if (!acc[e.employee_id]) acc[e.employee_id] = {}
    const ws = payWeekStartYMD(e.work_date)
    if (!acc[e.employee_id][ws]) acc[e.employee_id][ws] = []
    acc[e.employee_id][ws].push(e)
    return acc
  }, {})
  Object.values(byEmp).forEach(weeks => {
    Object.values(weeks).forEach(weekEnts => {
      const inOrder = [...weekEnts].sort((a, b) =>
        a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1)
      )
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
        } else if (statHolidays.has(e.work_date)) {
          map[e.id] = { reg: 0, ot: hrs }
          dayHoursSoFar += hrs
        } else {
          const dailyRegRemaining  = Math.max(0, dailyThreshold - dayHoursSoFar)
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
