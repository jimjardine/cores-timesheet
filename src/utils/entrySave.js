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

// Add one more job line to a day that already has entries (or start a new
// day with a single job). Used for "add another job" on an existing
// timesheet. ot_hours is left null — see note above — so computeOTMap
// correctly reg/OT-splits it (including stat/weekend and weekly threshold)
// alongside the day's other entries wherever it's displayed.
export async function addJobToDay(supabase, { employeeId, workDate, jobId, hours, description, entrySource, confirmationStatus, sortOrder = 999 }) {
  return cores(supabase).from('timesheet_entries').insert({
    employee_id: employeeId,
    work_date: workDate,
    job_id: jobId,
    hours: Number(hours),
    description: description || '',
    ot_hours: null,
    per_diem: 0,
    sort_order: sortOrder,
    entry_source: entrySource,
    confirmation_status: confirmationStatus,
  })
}
