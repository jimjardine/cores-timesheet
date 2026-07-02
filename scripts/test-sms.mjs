/**
 * SMS Timesheet integration tests
 * Sends JSON directly to the edge function — no real SMS, no Twilio needed.
 *
 * Usage:
 *   node scripts/test-sms.mjs              # run all scenarios
 *   node scripts/test-sms.mjs overtime     # run one scenario by name (partial match)
 *
 * Employee recognition tests use a fixed test employee "Test Tech" (phone 9990000099)
 * who has no real timesheet entries, so OT math starts clean every run.
 *
 * Each scenario uses a unique timestamp-suffixed phone so multi-turn scenarios
 * build state correctly and runs never interfere with each other.
 */

const EDGE_URL      = 'https://wgjuflwbkmgirhqoqfgp.supabase.co/functions/v1/sms-timesheet'
const SUPABASE_URL  = 'https://wgjuflwbkmgirhqoqfgp.supabase.co'
const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnanVmbHdia21naXJocW9xZmdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MDc0NDUsImV4cCI6MjA5MzE4MzQ0NX0.f-rMGgTZhnlCPhvNTKFU6TzWsVM-d298tfShHte1Nk4'
const TEST_PHONE    = '9990000099'  // "Test Tech" — seeded in employees table, role=technician
const RUN_ID        = Date.now().toString().slice(-6)  // unique per run for multi-scenario isolation

// ── helpers ────────────────────────────────────────────────────────────────

function phone(n) {
  // Unique phone per scenario so submissions don't cross-contaminate.
  // Multi-turn steps within one scenario reuse the same phone.
  // normalizePhone in the edge function takes the last 10 digits.
  return String(1000000000 + (Number(RUN_ID) * 20) + n).slice(-10)
}

async function sms(fromPhone, body) {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_phone: fromPhone, body }),
  })
  return (await res.json()).reply ?? ''
}

const delay = ms => new Promise(r => setTimeout(r, ms))

const TEST_TECH_ID = 'e3044c0c-9628-46e0-9837-2526240b63c3'

async function deleteSubmissions(fromPhone) {
  await fetch(`${SUPABASE_URL}/rest/v1/sms_submissions?from_phone=eq.${fromPhone}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
}

async function cleanupTestTech() {
  // Delete ALL of Test Tech's submissions regardless of date.
  // Without this, "This is Test" in scenario N finds the submission from scenario N-1
  // via the employee_id lookup. No date filter in case Claude parses an ambiguous time
  // expression as a future date rather than today.
  await fetch(
    `${SUPABASE_URL}/rest/v1/sms_submissions?employee_id=eq.${TEST_TECH_ID}`,
    { method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
  )
}

let passed = 0
let failed = 0
const filter = process.argv[2]?.toLowerCase()

async function scenario(name, fromPhone, steps) {
  if (filter && !name.toLowerCase().includes(filter)) return
  console.log(`\n▶ ${name}`)

  let stepNum = 0
  for (const [msg, expects] of steps) {
    stepNum++
    const reply = await sms(fromPhone, msg)
    const checks = Array.isArray(expects) ? expects : [expects]
    let ok = true

    for (const check of checks) {
      const pass = typeof check === 'string' ? reply.includes(check) : check.test(reply)
      if (!pass) {
        if (ok) {
          console.log(`  Step ${stepNum}:`)
          console.log(`    SEND:  ${msg}`)
          console.log(`    REPLY: ${reply}`)
        }
        console.log(`    ✗ expected: ${check}`)
        ok = false
      }
    }

    if (!ok) { failed++; return }
    if (stepNum < steps.length) await delay(13000)  // 5 RPM on free Anthropic tier = 12s between calls
  }
  await delay(13000)  // pause between scenarios

  console.log(`  ✓ passed`)
  passed++
}

// ── scenarios ──────────────────────────────────────────────────────────────

// 1. Unknown number gets prompted for their name
await scenario('unknown number', phone(1), [
  ['4760 6hrs engine work', ["Couldn't match", 'This is [your name]']],
])

// 2. HELP reply returns the help text
await scenario('help request', phone(2), [
  ['HELP', ['Cores Timesheets', 'Reply HELP']],
])

// 3. All-in-one: jobs + times + lunch + PD in one message (phone auto-lookup via TEST_PHONE)
await cleanupTestTech()
await scenario('all in one by phone', TEST_PHONE, [
  ['In 7:30, 4760 6hrs engine work, 4862 2hrs fuel lines, lunch 30, no PD', [
    'Done Test',
    '4760: 6hrs reg',
    '4862: 2hrs reg',
    'Total: 8hrs reg',
    'No per diem',
    '7:30am',
  ]],
])

// 4. Multi-turn: jobs first, then follow-up answers lunch + PD
await cleanupTestTech()
await scenario('multi-turn follow-up', phone(4), [
  ['This is Test. Started 7am, 4760 6hrs bearings, 4862 2hrs, til 4', [
    'Got it Test',
    'lunch?',
    'per diem',
  ]],
  ['Lunch 30, no PD', [
    'Done Test',
    'lunch 30min',
    'No per diem',
    '7am',
  ]],
])

// 5. "Nope" accepted as no per diem (context-free one-word follow-up)
await cleanupTestTech()
await scenario('nope = no per diem', phone(5), [
  ['This is Test. 4760 8hrs engine work, started 7am, til 3:30, lunch 30', ['per diem']],
  ['Nope', ['No per diem', 'Done Test']],
])

// 6. "No lunch" accepted for zero-minute lunch
await cleanupTestTech()
await scenario('no lunch', phone(6), [
  ['This is Test. 4760 8hrs, started 7am, til 3:30, no PD', ['lunch?']],
  ['No lunch', ['no lunch', 'Done Test']],
])

// 7. Hours inferred from time bounds when "all day" used
await cleanupTestTech()
await scenario('all day inference', phone(7), [
  ['This is Test. Worked all day on 4760, started 7am, til 3:30, lunch 30, no PD', [
    'Done Test',
    '4760:',
    'No per diem',
  ]],
])

// 8. OT kicks in after 8 regular hours (single job)
await cleanupTestTech()
await scenario('overtime', phone(8), [
  ['This is Test. Started 7am, 4760 10hrs engine work, no lunch, no PD', [
    'Done Test',
    /4760: 8hrs reg \+ 2hrs OT/,
    /Total: 10hrs/,
  ]],
])

// 9. Split day: OT attributed to the second job
await cleanupTestTech()
await scenario('split day OT', phone(9), [
  ['This is Test. Started 7am, 4760 6hrs bearings, 4862 4hrs fuel lines, lunch 30, no PD', [
    'Done Test',
    '4760: 6hrs reg',
    /4862: 2hrs reg \+ 2hrs OT/,
    /Total: 10hrs/,
  ]],
])

// 10. Same-day second text merges into existing record
await cleanupTestTech()
await scenario('same day second text', phone(10), [
  ['This is Test. Started 7am, 4760 4hrs bearings, lunch 30, no PD', ['Done Test', '4760: 4hrs reg']],
  ['This is Test. Also 4862 2hrs fuel lines', [
    'Done Test',
    '4760',
    '4862',
  ]],
])

// 11. Correction: updating lunch after submission re-reads stored values
await cleanupTestTech()
await scenario('lunch correction', phone(11), [
  ['This is Test. Started 7am, 4760 8hrs, til 3:30, lunch 60, no PD', ['Done Test', 'lunch 60min']],
  ['This is Test. Actually lunch was only 30 min', ['Done Test', 'lunch 30min']],
])

// 12. Per diem location is captured and echoed back
await cleanupTestTech()
await scenario('per diem with location', phone(12), [
  ['This is Test. 4760 8hrs, started 7am, til 3:30, lunch 30, staying at Delta Halifax', [
    'Done Test',
    'PD: Delta Halifax',
  ]],
])

// ── summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`)
if (failed > 0) {
  console.log(`  Note: test submissions remain in DB (phones contain RUN_ID ${RUN_ID})`)
  process.exit(1)
}
