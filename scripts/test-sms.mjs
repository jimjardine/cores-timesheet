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

// Mirror the edge function's Atlantic-time date handling so date scenarios
// ("yesterday") can assert the exact date string in the confirmation.
function atlanticDate(offsetDays = 0) {
  const d = new Date(Date.now() - 4 * 60 * 60 * 1000 - offsetDays * 86400000)
  return d.toISOString().split('T')[0]
}
function friendlyDate(dstr) {
  const [y, mo, day] = dstr.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dt = new Date(Date.UTC(y, mo - 1, day))
  return `${dow[dt.getUTCDay()]} ${months[mo - 1]} ${day}`
}

const TEST_TECH_ID = 'e3044c0c-9628-46e0-9837-2526240b63c3'

async function deleteSubmissions(fromPhone) {
  // Content-Profile routes the DELETE to the Cores schema (tables moved out of public)
  await fetch(`${SUPABASE_URL}/rest/v1/sms_submissions?from_phone=eq.${fromPhone}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Profile': 'Cores' },
  })
}

async function cleanupTestTech() {
  // Delete ALL of Test Tech's submissions regardless of date.
  // Without this, "This is Test" in scenario N finds the submission from scenario N-1
  // via the employee_id lookup. No date filter in case Claude parses an ambiguous time
  // expression as a future date rather than today.
  await fetch(
    `${SUPABASE_URL}/rest/v1/sms_submissions?employee_id=eq.${TEST_TECH_ID}`,
    { method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Profile': 'Cores' } }
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

// ── rough-language scenarios ───────────────────────────────────────────────
// Simulating how different techs actually text: lowercase, typos, run-ons,
// slang, military time, spelled-out numbers, rambling. All map to Test Tech.

// 13. All lowercase, zero punctuation
await cleanupTestTech()
await scenario('lowercase no punctuation', phone(13), [
  ['this is test worked 4760 8 hrs in at 7 out at 330 half hour lunch no pd', [
    'Done Test',
    '4760: 8hrs reg',
    'lunch 30min',
    'No per diem',
    '7am',
  ]],
])

// 14. Typos everywhere
await cleanupTestTech()
await scenario('typos', phone(14), [
  ['This is Test. wrked on 4760 8hrs, startd 7am, dun at 330, lnch 30, no pd', [
    'Done Test',
    '4760: 8hrs reg',
    'lunch 30min',
    'No per diem',
  ]],
])

// 15. Military time
await cleanupTestTech()
await scenario('military time', phone(15), [
  ['This is Test. 0700 to 1530, 4760 8hrs valve job, lunch 30, no per diem', [
    'Done Test',
    '7am',
    '3:30pm',
    '4760: 8hrs reg',
  ]],
])

// 16. Decimal hours across two jobs
await cleanupTestTech()
await scenario('decimal hours', phone(16), [
  ['This is Test. 4760 6.5hrs hyd pump, 4862 1.5hrs, in 7, lunch 30, no PD', [
    'Done Test',
    '4760: 6.5hrs reg',
    '4862: 1.5hrs reg',
    'Total: 8hrs reg',
  ]],
])

// 17. "worked thru lunch" + "going home" as no-lunch / no-PD, with OT
await cleanupTestTech()
await scenario('worked thru lunch', phone(17), [
  ['This is Test. in at 6, 4760 10hrs gearbox teardown, worked thru lunch, going home after', [
    'Done Test',
    /4760: 8hrs reg \+ 2hrs OT/,
    'no lunch',
    'No per diem',
  ]],
])

// 18. "its [name]" identification form (no apostrophe)
await cleanupTestTech()
await scenario('its name form', phone(18), [
  ['its test, 4760 8hrs, in 8, out 430, lunch 30, no pd', [
    'Done Test',
    '4760: 8hrs reg',
    '8am',
  ]],
])

// 19. Forgot to send yesterday — date resolves to yesterday
await cleanupTestTech()
await scenario('yesterday', phone(19), [
  ['This is Test. forgot to send yesterday - 4760 8hrs engine work, in 7, out 330, lunch 30, no pd', [
    'Done Test',
    friendlyDate(atlanticDate(1)),
    '4760: 8hrs reg',
  ]],
])

// 20. Spelled-out numbers ("eight hours", "started at seven")
await cleanupTestTech()
await scenario('spelled out numbers', phone(20), [
  ['This is Test. eight hours on 4760 today, started at seven, lunch 30, no PD', [
    'Done Test',
    '4760: 8hrs reg',
    '7am',
  ]],
])

// 21. Run-on: three jobs, bare numbers, no "hrs" anywhere
await cleanupTestTech()
await scenario('run-on three jobs', phone(21), [
  ['this is test 4760 3 4862 3 4901 2 in 7 lunch 30 no pd', [
    'Done Test',
    '4760: 3hrs reg',
    '4862: 3hrs reg',
    '4901: 2hrs reg',
    'Total: 8hrs reg',
  ]],
])

// 22. Rambling with filler words, casual hotel mention, OT
await cleanupTestTech()
await scenario('rambling with hotel', phone(22), [
  ['hey its test here, long day lol. did the engine swap on 4760, took me like 9 hrs. got in at 630. grabbed a quick half hr lunch. crashing at the comfort inn in sydney tonight', [
    'Done Test',
    /4760: 8hrs reg \+ 1hrs OT/,
    'lunch 30min',
    /PD: .*[Cc]omfort/,
  ]],
])

// 23. Newline-separated fragments, terse
await cleanupTestTech()
await scenario('newline fragments', phone(23), [
  ['This is Test\n4760 8hrs\nin 7 out 3\nno lunch\nno pd', [
    'Done Test',
    '4760: 8hrs reg',
    'no lunch',
    'No per diem',
  ]],
])

// 24. Multi-turn with casual follow-up answers ("took a half hour, heading home")
await cleanupTestTech()
await scenario('casual follow-up answers', phone(24), [
  ['yo its test, put in 8 on 4760 today doing exhaust work, started at 7', [
    'lunch?',
    'per diem',
  ]],
  ['took a half hour, heading home', [
    'Done Test',
    'lunch 30min',
    'No per diem',
  ]],
])

// 25. ALL CAPS
await cleanupTestTech()
await scenario('all caps', phone(25), [
  ['THIS IS TEST 4760 8HRS IN 7 OUT 330 LUNCH 30 NO PD', [
    'Done Test',
    '4760: 8hrs reg',
    'No per diem',
  ]],
])

// 26. Casual per diem hotel phrasing ("im at the wandlyn inn tonight")
await cleanupTestTech()
await scenario('casual hotel phrasing', phone(26), [
  ['this is test. 8 hrs on 4862 electrical, in at 7, out at 330, 30 min lunch, im at the wandlyn inn tonight', [
    'Done Test',
    '4862: 8hrs reg',
    /PD: .*[Ww]andlyn/,
  ]],
])

// ── summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`)
if (failed > 0) {
  console.log(`  Note: test submissions remain in DB (phones contain RUN_ID ${RUN_ID})`)
  process.exit(1)
}
