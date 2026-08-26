// Shared timesheet_entries write logic — used by both the office AdminDashboard
// (manual entry / edit) and the employee mobile self-service site, so the two
// surfaces can never drift on how a job gets added to an existing day.
// Pulled out of AdminDashboard.jsx's saveManualEntry/saveEdit/saveNewJobToTimesheet,
// which had this logic three times over.
import { isStatHoliday } from './statPay'

const cores = (supabase) => supabase.schema('Cores')

function isWeekend(ymd) {
  const dow = new Date(ymd + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

// IMPORTANT: this same-day-only split is for UI *preview* purposes only
// (PendingEntryEdit's estimate of what a pending submission will look like).
// Never write its result into timesheet_entries.ot_hours — otCalc.js's
// computeOTMap treats a non-null ot_hours as a deliberate manual override and
// skips its own daily+weekly threshold logic for that entry, so stamping a
// same-day split at write time silently defeats the weekly overtime rule
// everywhere the entry is later displayed or exported. Every actual insert/
// update of timesheet_entries in this codebase writes ot_hours: null, except
// AdminDashboard's Edit modal where an admin explicitly types reg/ot into
// separate fields — that's the one legitimate manual override.
export function computeDailyOTSplit(hours, alreadyWorkedToday, dailyOTThreshold, statDay) {
  const reg = statDay ? 0 : Math.min(hours, Math.max(0, dailyOTThreshold - alreadyWorkedToday))
  const ot = hours - reg
  return { reg, ot }
}

// Context computeDailyOTSplit needs for a preview: is this a stat/weekend day
// (all OT), the configured daily threshold, and how many non-stat hours the
// employee already has logged that day.
export async function fetchDailyOTContext(supabase, employeeId, workDate) {
  const { data: otCfg } = await cores(supabase).from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single()
  const dailyOTThreshold = otCfg ? Number(otCfg.value) : 8

  const statDay = (await isStatHoliday(workDate)) || isWeekend(workDate)

  const { data: existingToday } = await cores(supabase).from('timesheet_entries')
    .select('hours').eq('employee_id', employeeId).eq('work_date', workDate).eq('is_stat_pay', false)
  const alreadyWorked = (existingToday || []).reduce((s, e) => s + Number(e.hours), 0)

  return { statDay, dailyOTThreshold, alreadyWorked }
}

// Replace whatever supplies are logged for an employee/day with a new set —
// same delete-then-insert pattern used everywhere supplies are edited.
export async function replaceSupplies(supabase, employeeId, workDate, supplies) {
  // Scoped to already-applied rows only — an in-progress GearPhotos draft
  // (applied_at still null) for this same employee/day must survive this
  // delete-then-insert cycle untouched, since it isn't part of what this
  // caller loaded/is editing.
  await cores(supabase).from('job_supplies').delete()
    .eq('employee_id', employeeId).eq('work_date', workDate).not('applied_at', 'is', null)

  const validSupplies = (supplies || []).filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
  if (validSupplies.length === 0) return { error: null }

  // A typed-in supply row is already a deliberate, reviewed action (unlike
  // the gear-photo path, which has its own draft step before Apply), so it's
  // immediately applied — same as it's always behaved.
  const { error } = await cores(supabase).from('job_supplies').insert(validSupplies.map(s => ({
    job_id: s.job_id, employee_id: employeeId, work_date: workDate,
    supply_name: s.supply_name, quantity: Number(s.quantity),
    applied_at: new Date().toISOString(),
  })))
  return { error }
}

// Derives calculated_time_out/delta_minutes for an sms_submissions row from
// its stated shift times — same math PendingEntryEdit uses, shared here so
// the mobile self-entry flow (EntryForm.jsx, EmployeeHome.jsx) produces the
// same office-facing delta warning a texted-in day would.
export function computeSubmissionTiming(timeIn, statedTimeOut, lunchMinutes, totalHours) {
  if (!timeIn || !(totalHours > 0)) return { calculated_time_out: null, delta_minutes: null }
  const [h, m] = timeIn.split(':').map(Number)
  const outMins = h * 60 + m + Math.round(totalHours * 60) + (Number(lunchMinutes) || 0)
  const oh = Math.floor(outMins / 60) % 24
  const om = outMins % 60
  const calculated_time_out = `${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}`
  let delta_minutes = null
  if (statedTimeOut) {
    const [sh, sm] = statedTimeOut.split(':').map(Number)
    delta_minutes = (sh * 60 + sm) - outMins
  }
  return { calculated_time_out, delta_minutes }
}

// Submit a manually-typed entry (or set of entries) for one employee/day as
// an sms_submissions row — the same review gate a text goes through —
// instead of writing timesheet_entries directly. An admin typing hours in is
// not itself Niki's approval; before 2026-08-26 it was treated as one (see
// AdminDashboard's old saveManualEntry/saveNewJobToTimesheet), and a manual
// entry for an employee landed live and fully approved with nobody having
// reviewed it. Used for both a brand-new day (AdminDashboard's Add Entry
// form) and adding one more job to an existing day.
export async function submitManualEntry(supabase, {
  employeeId, workDate, timeIn, statedTimeOut, lunchMinutes, hasPerDiem,
  entries, supplies = [], adminName,
}) {
  const totalHours = entries.reduce((s, e) => s + e.hours, 0)
  const { calculated_time_out, delta_minutes } = computeSubmissionTiming(timeIn, statedTimeOut, lunchMinutes, totalHours)
  return cores(supabase).from('sms_submissions').insert({
    from_phone:         'admin-manual',
    employee_id:        employeeId,
    work_date:          workDate,
    time_in:            timeIn || null,
    stated_time_out:    statedTimeOut || null,
    lunch_minutes:      lunchMinutes === '' || lunchMinutes == null ? null : Number(lunchMinutes),
    per_diem_location:  hasPerDiem ? 'Office entry' : 'none',
    entries, supplies,
    status:             'submitted',
    calculated_time_out, delta_minutes,
    admin_note:         adminName ? `Entered manually by ${adminName}` : null,
  })
}
