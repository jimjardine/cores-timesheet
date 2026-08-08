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
  await cores(supabase).from('job_supplies').delete().eq('employee_id', employeeId).eq('work_date', workDate)

  const validSupplies = (supplies || []).filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
  if (validSupplies.length === 0) return { error: null }

  const { error } = await cores(supabase).from('job_supplies').insert(validSupplies.map(s => ({
    job_id: s.job_id, employee_id: employeeId, work_date: workDate,
    supply_name: s.supply_name, quantity: Number(s.quantity),
  })))
  return { error }
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
