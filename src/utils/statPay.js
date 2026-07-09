import { supabase } from '../supabaseClient'

const cores = () => supabase.schema('Cores')

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Pay week runs Thu–Wed
export function payWeekRange(ymd) {
  const start = new Date(ymd + 'T12:00:00')
  start.setDate(start.getDate() - ((start.getDay() - 4 + 7) % 7))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return [toYMD(start), toYMD(end)]
}

// Any hours worked on a stat holiday are OT from the first minute
export async function isStatHoliday(ymd) {
  const { data } = await cores().from('stat_holidays').select('holiday_date').eq('holiday_date', ymd)
  return (data || []).length > 0
}

// Grant the automatic 8-hr stat entry for every stat holiday in the pay week
// containing workDate — but only if the employee actually worked that week.
// Idempotent: skips stat days the employee already has a stat-pay entry for.
// Called after every path that creates or edits timesheet entries.
export async function ensureStatPay(employeeId, workDate) {
  if (!employeeId || !workDate) return
  const [weekStart, weekEnd] = payWeekRange(workDate)

  const { data: stats } = await cores().from('stat_holidays')
    .select('holiday_date, name')
    .gte('holiday_date', weekStart).lte('holiday_date', weekEnd)
  if (!stats || stats.length === 0) return

  // Eligibility: at least one real (non-stat-pay) entry in the pay week
  const { data: worked } = await cores().from('timesheet_entries')
    .select('id')
    .eq('employee_id', employeeId).eq('is_stat_pay', false)
    .gte('work_date', weekStart).lte('work_date', weekEnd)
    .limit(1)
  if (!worked || worked.length === 0) return

  for (const stat of stats) {
    const { data: existing } = await cores().from('timesheet_entries')
      .select('id')
      .eq('employee_id', employeeId).eq('work_date', stat.holiday_date).eq('is_stat_pay', true)
      .limit(1)
    if (existing && existing.length > 0) continue

    const { error } = await cores().from('timesheet_entries').insert({
      employee_id: employeeId,
      work_date: stat.holiday_date,
      job_id: null,            // stat pay isn't charged to a job
      hours: 8,
      ot_hours: 0,
      description: `Stat pay — ${stat.name}`,
      per_diem: 0,
      sort_order: 0,           // list ahead of worked jobs on that day
      is_stat_pay: true,
    })
    if (error) console.error(`Stat pay grant failed for ${stat.holiday_date}: ${error.message}`)
  }
}

// Counterpart to ensureStatPay: if the employee no longer has any real
// (non-stat-pay) entries in the pay week containing workDate, the automatic
// stat entries in that week are unearned — remove them. Called after deletes
// and after edits that move an entry's date out of a week.
export async function cleanupStatPay(employeeId, workDate) {
  if (!employeeId || !workDate) return
  const [weekStart, weekEnd] = payWeekRange(workDate)

  const { data: worked } = await cores().from('timesheet_entries')
    .select('id')
    .eq('employee_id', employeeId).eq('is_stat_pay', false)
    .gte('work_date', weekStart).lte('work_date', weekEnd)
    .limit(1)
  if (worked && worked.length > 0) return

  const { error } = await cores().from('timesheet_entries')
    .delete()
    .eq('employee_id', employeeId).eq('is_stat_pay', true)
    .gte('work_date', weekStart).lte('work_date', weekEnd)
  if (error) console.error(`Stat pay cleanup failed for week of ${workDate}: ${error.message}`)
}
