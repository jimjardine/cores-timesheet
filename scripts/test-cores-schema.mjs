/**
 * Cores Schema Test Suite — REAL tests, no theater.
 * Exercises the exact client syntax the app uses: supabase.schema('Cores').from(...)
 *
 * Usage: node scripts/test-cores-schema.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wgjuflwbkmgirhqoqfgp.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnanVmbHdia21naXJocW9xZmdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDc0NDUsImV4cCI6MjA5MzE4MzQ0NX0.f-rMGgTZhnlCPhvNTKFU6TzWsVM-d298tfShHte1Nk4'

const supabase = createClient(SUPABASE_URL, ANON_KEY)
const cores = supabase.schema('Cores')

const green = s => `\x1b[32m${s}\x1b[0m`
const red = s => `\x1b[31m${s}\x1b[0m`
const cyan = s => `\x1b[36m${s}\x1b[0m`

let passed = 0, failed = 0
const failures = []

async function test(name, fn) {
  try {
    const detail = await fn()
    passed++
    console.log(green(`  ✓ ${name}`) + (detail ? ` — ${detail}` : ''))
  } catch (e) {
    failed++
    failures.push(name)
    console.log(red(`  ✗ ${name}`))
    console.log(red(`    ${e.message || e}`))
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg) }

// Expected row counts from the pre-migration sanity check
const EXPECTED_COUNTS = {
  employees: 24, customers: 18, vessels: 29, jobs: 75, job_tasks: 19,
  timesheet_entries: 13, payroll_config: 5, stat_holidays: 9,
  job_status_logs: 6, vessel_contacts: 1, sms_submissions: 7, job_supplies: 2,
}

async function run() {
  console.log(cyan('\n━━━ 1. READ ACCESS: every Cores table, exact row counts ━━━'))
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    await test(`Cores.${table} readable with expected rows`, async () => {
      const { count, error } = await cores.from(table).select('*', { count: 'exact', head: true })
      expect(!error, error?.message)
      expect(count >= expected, `expected >= ${expected} rows, got ${count}`)
      return `${count} rows`
    })
  }

  console.log(cyan('\n━━━ 2. RELATIONSHIP JOINS (what the app actually runs) ━━━'))
  await test('timesheet_entries joins employees + jobs (Reports.jsx query)', async () => {
    const { data, error } = await cores.from('timesheet_entries')
      .select('*, employees(id, name), jobs(id, job_number, description, status, customers(name), vessels(name))')
      .order('work_date', { ascending: false })
    expect(!error, error?.message)
    expect(data.length > 0, 'no entries returned')
    const withEmp = data.filter(d => d.employee_id)
    expect(withEmp.every(d => d.employees?.name), 'entry with employee_id missing joined employee')
    return `${data.length} entries, joins resolve`
  })

  await test('jobs joins customers + vessels (AdminPanel.jsx query)', async () => {
    const { data, error } = await cores.from('jobs')
      .select('*, customers(name), vessels(name)').order('job_number')
    expect(!error, error?.message)
    expect(data.length >= 75, `expected >= 75 jobs, got ${data.length}`)
    return `${data.length} jobs, joins resolve`
  })

  await test('vessels joins customers (AdminPanel.jsx query)', async () => {
    const { data, error } = await cores.from('vessels').select('*, customers(name)').order('name')
    expect(!error, error?.message)
    return `${data.length} vessels`
  })

  await test('job_supplies joins employees (Reports.jsx query)', async () => {
    const { data, error } = await cores.from('job_supplies')
      .select('*, employees(id, name)').order('work_date', { ascending: false })
    expect(!error, error?.message)
    return `${data.length} supply rows`
  })

  console.log(cyan('\n━━━ 3. FILTERS & ORDERING ━━━'))
  await test('.eq() filter — active employees', async () => {
    const { data, error } = await cores.from('employees').select('id, name').eq('active', true)
    expect(!error, error?.message)
    expect(data.length > 0, 'no active employees')
    return `${data.length} active`
  })

  await test('.eq() filter — open jobs', async () => {
    const { data, error } = await cores.from('jobs')
      .select('id, job_number, description').eq('status', 'open')
    expect(!error, error?.message)
    return `${data.length} open jobs`
  })

  await test('payroll_config key lookup (.single())', async () => {
    const { data, error } = await cores.from('payroll_config')
      .select('value').eq('key', 'daily_ot_threshold').single()
    expect(!error, error?.message)
    expect(Number(data.value) > 0, 'daily_ot_threshold not a positive number')
    return `daily_ot_threshold = ${data.value}`
  })

  console.log(cyan('\n━━━ 4. OLD PATHS ARE DEAD (public schema) ━━━'))
  for (const table of ['employees', 'jobs', 'timesheet_entries', 'sms_submissions']) {
    await test(`public.${table} no longer reachable`, async () => {
      const { error } = await supabase.from(table).select('*').limit(1)
      expect(error, `public.${table} still answers queries — app could silently hit the wrong schema`)
      return 'correctly 404s'
    })
  }

  console.log(cyan('\n━━━ 5. FULL CRUD ROUND-TRIP (anon key, like the app) ━━━'))
  let entryId = null
  let empId = null, jobId = null

  await test('INSERT timesheet entry', async () => {
    const { data: emp } = await cores.from('employees').select('id').eq('name', 'Test Tech').maybeSingle()
    empId = emp?.id
    if (!empId) {
      const { data: anyEmp, error: e1 } = await cores.from('employees').select('id').limit(1).single()
      expect(!e1, e1?.message)
      empId = anyEmp.id
    }
    const { data: job, error: e2 } = await cores.from('jobs').select('id').limit(1).single()
    expect(!e2, e2?.message)
    jobId = job.id

    const { data, error } = await cores.from('timesheet_entries').insert({
      employee_id: empId, job_id: jobId,
      work_date: '2026-01-01', hours: 1.5,
      description: 'CORES SCHEMA TEST ROW — safe to delete',
    }).select().single()
    expect(!error, error?.message)
    entryId = data.id
    return `id ${entryId.slice(0, 8)}…`
  })

  await test('SELECT it back with joins', async () => {
    expect(entryId, 'skipped — insert failed')
    const { data, error } = await cores.from('timesheet_entries')
      .select('*, employees(name), jobs(job_number)').eq('id', entryId).single()
    expect(!error, error?.message)
    expect(Number(data.hours) === 1.5, `hours mismatch: ${data.hours}`)
    expect(data.employees?.name, 'employee join missing')
    return `joined employee: ${data.employees.name}`
  })

  await test('UPDATE it', async () => {
    expect(entryId, 'skipped — insert failed')
    // hours is numeric(4,1) — half-hour increments only
    const { data, error } = await cores.from('timesheet_entries')
      .update({ hours: 2.5 }).eq('id', entryId).select().single()
    expect(!error, error?.message)
    expect(Number(data.hours) === 2.5, `hours after update: ${data.hours}`)
    return 'hours 1.5 → 2.5'
  })

  await test('DELETE it and confirm gone', async () => {
    expect(entryId, 'skipped — insert failed')
    const { error } = await cores.from('timesheet_entries').delete().eq('id', entryId)
    expect(!error, error?.message)
    const { data } = await cores.from('timesheet_entries').select('id').eq('id', entryId)
    expect(data.length === 0, 'row still exists after delete')
    return 'verified gone'
  })

  console.log(cyan('\n━━━ 6. CRUD on job_supplies (SmsReview approve path) ━━━'))
  let supplyId = null
  await test('INSERT + DELETE job_supplies row', async () => {
    const { data, error } = await cores.from('job_supplies').insert({
      job_id: jobId, employee_id: empId, work_date: '2026-01-01',
      supply_name: 'TEST SUPPLY — safe to delete', quantity: 3,
    }).select().single()
    expect(!error, error?.message)
    supplyId = data.id
    const { error: delErr } = await cores.from('job_supplies').delete().eq('id', supplyId)
    expect(!delErr, delErr?.message)
    return 'insert + delete OK'
  })

  // ── Summary ──
  console.log(cyan('\n━━━━━━━━━━━━━━━━━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━'))
  console.log(green(`  Passed: ${passed}`))
  if (failed > 0) {
    console.log(red(`  Failed: ${failed}`))
    failures.forEach(f => console.log(red(`    • ${f}`)))
    process.exit(1)
  }
  console.log(green('\n  All real tests passed — Cores schema is live and working.\n'))
}

run().catch(e => { console.error(red(`Fatal: ${e.message}`)); process.exit(1) })
