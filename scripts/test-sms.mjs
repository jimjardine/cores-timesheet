/**
 * SMS Timesheet integration tests
 * Sends JSON directly to the edge function — no real SMS, no Twilio needed.
 *
 * Usage:
 *   node scripts/test-sms.mjs              # run all scenarios
 *   node scripts/test-sms.mjs overtime     # run one scenario by name (partial match)
 *   node scripts/test-sms.mjs typos,caps   # comma-separates multiple partial matches
 *
 * Employee recognition tests use a fixed test employee "Test Tech" (phone 9990000099)
 * who has no real timesheet entries, so OT math starts clean every run.
 *
 * Each scenario uses a unique timestamp-suffixed phone so multi-turn scenarios
 * build state correctly and runs never interfere with each other.
 *
 * Since 2026-07-17 the bot records quietly: it never asks about lunch/PD/supplies
 * (they default to 0 / none), texts without a job number attach to the day's last
 * job, same-job texts merge into one entry, and "TS [day]" shows the day's record.
 * The only question left is the job question, and only when no job is known at
 * all. Most scenarios are single-turn; a full run is a few minutes (13s between
 * Claude calls for the free-tier rate limit).
 *
 * The "photo" scenario needs outbound network to a public image host and storage
 * write access — filter it out with a name filter if it gets flaky.
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

async function sms(fromPhone, body, mediaUrls = null) {
  // Long runs occasionally hit a transient ECONNRESET — retry rather than
  // abandoning a long run near the end.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_phone: fromPhone, body, ...(mediaUrls ? { media_urls: mediaUrls } : {}) }),
      })
      return (await res.json()).reply ?? ''
    } catch (err) {
      if (attempt >= 5) throw err
      console.log(`  (network error "${err.cause?.code || err.message}" — retrying)`)
      await delay(15000)
    }
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms))

// Mirror the edge function's Atlantic-time date handling so date scenarios
// ("yesterday") can assert the exact date string in the TS view.
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
const filters = process.argv[2]?.toLowerCase().split(',').map(s => s.trim()).filter(Boolean)

async function scenario(name, fromPhone, steps) {
  if (filters && !filters.some(f => name.toLowerCase().includes(f))) return
  console.log(`\n▶ ${name}`)

  let stepNum = 0
  for (const step of steps) {
    const [msg, expects, mediaUrls] = step
    stepNum++
    const reply = await sms(fromPhone, msg, mediaUrls)
    const checks = Array.isArray(expects) ? expects : [expects]
    let ok = true

    for (const check of checks) {
      // string → must appear; regex → must match; {absent: 'x'} → must NOT appear
      const pass = typeof check === 'string' ? reply.includes(check)
                 : check instanceof RegExp   ? check.test(reply)
                 : !reply.includes(check.absent)
      if (!pass) {
        if (ok) {
          console.log(`  Step ${stepNum}:`)
          console.log(`    SEND:  ${msg}`)
          console.log(`    REPLY: ${reply}`)
        }
        console.log(`    ✗ expected: ${typeof check === 'object' && check.absent ? `NOT to contain "${check.absent}"` : check}`)
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

// No question should ever mention these — the bot doesn't ask about them anymore.
const NO_NAG = [{ absent: 'lunch?' }, { absent: 'per diem tonight' }, { absent: 'supplies used' }]

// ── scenarios ──────────────────────────────────────────────────────────────

// 1. Unknown number gets saved for Nicki to match manually
await scenario('unknown number', phone(1), [
  ['4760 6hrs engine work', ['Nicki will match']],
])

// 2. HELP reply returns the help text
await scenario('help request', phone(2), [
  ['HELP', ['Cores Timesheets', 'TIMESHEET', 'Reply HELP']],
])

// 3. All-in-one: jobs + times + lunch + PD in one message, one quiet ack back
await cleanupTestTech()
await scenario('all in one by phone', TEST_PHONE, [
  ['In 7:30, 4760 6hrs engine work, 4862 2hrs fuel lines, lunch 30, no PD', [
    'Got it Test',
    '4760: 6hrs',
    '4862: 2hrs',
    'Total 8hrs',
    ...NO_NAG,
  ]],
])

// 4. Day-start in-time only: acknowledged, never asks which job
await cleanupTestTech()
await scenario('in time only no questions', phone(4), [
  ['This is Test. In 7:30', [
    'Got it Test',
    'in 7:30am',
    { absent: 'Which job' },
    ...NO_NAG,
  ]],
])

// 5. Defaults: nothing said about lunch/PD → lunch 0 / no PD, visible in TS view.
// With lunch defaulting to 0, the 7–3:30 bounds recompute the single job to 8.5hrs
// (span minus no lunch) — the tech sees it in the ack and can text "lunch 30" to fix.
await cleanupTestTech()
await scenario('silent defaults', phone(5), [
  ['This is Test. 4760 8hrs engine work, in 7, out 330', ['Got it Test', '4760: 8.5hrs', ...NO_NAG]],
  ['ts', ['4760: 8.5hrs', 'No per diem', { absent: 'lunch' }]],
])

// 6. Assume last job: a later text with no job number lands on the day's job
await cleanupTestTech()
await scenario('assume last job description', phone(6), [
  ['This is Test. 4900 2hrs on a pump', ['Got it Test', '4900: 2hrs']],
  ['fixed the head', ['4900: 2hrs', 'head', { absent: 'Which job' }]],
])

// 7. Assume last job with hours: "another 2 hrs" adds to the same job line
await cleanupTestTech()
await scenario('assume last job hours add', phone(7), [
  ['This is Test. 4900 2hrs pump work', ['4900: 2hrs']],
  ['another 2 hrs on it', ['4900: 4hrs', { absent: 'Which job' }]],
])

// 8. Same job texted twice merges into ONE line, hours summed
await cleanupTestTech()
await scenario('merge same job', phone(8), [
  ['This is Test. 4760 2hrs pump', ['4760: 2hrs']],
  ['4760 1hr head gasket', ['4760: 3hrs', { absent: '4760: 2hrs' }, { absent: '4760: 1hr' }]],
])

// 9. Hours correction replaces instead of summing
await cleanupTestTech()
await scenario('hours correction replaces', phone(9), [
  ['This is Test. 4760 2hrs pump', ['4760: 2hrs']],
  ['actually that was 3hrs', ['4760: 3hrs', { absent: '5hrs' }]],
])

// 10. No job known at all → the ONE remaining question, answered with a bare number
await cleanupTestTech()
await scenario('no job yet asks once', phone(10), [
  ['This is Test. spent the morning fixing the head', ['Which job']],
  ['4900', ['Got it Test', '4900:', 'head']],
])

// 11. Out-time correction after submitting — latest value wins, no re-asks
await cleanupTestTech()
await scenario('out time correction', phone(11), [
  ['This is Test. in 7, 4760 8hrs engine work, out 330, lunch 30', ['4760: 8hrs']],
  ['actually I finished at 6', ['Got it Test', ...NO_NAG]],
  ['ts', ['Out 6pm', 'lunch 30min']],
])

// 12. Lunch correction after submitting — hours recompute from the bounds with
// the corrected lunch (7–3:30 minus 60 = 7.5hrs; minus 30 = 8hrs)
await cleanupTestTech()
await scenario('lunch correction', phone(12), [
  ['This is Test. Started 7am, 4760 8hrs, til 3:30, lunch 60', ['4760: 7.5hrs']],
  ['This is Test. Actually lunch was only 30 min', ['Got it Test', '4760: 8hrs', ...NO_NAG]],
  ['ts', ['lunch 30min', { absent: 'lunch 60min' }]],
])

// 13. TS view: full day summary on demand, including per diem location
await cleanupTestTech()
await scenario('timesheet view', phone(13), [
  ['This is Test. 4760 8hrs, in 7, out 330, lunch 30, staying at Delta Halifax', ['4760: 8hrs']],
  ['timesheet', [friendlyDate(atlanticDate(0)), '4760: 8hrs', 'In 7am', 'PD: Delta Halifax']],
  ['ts', ['4760: 8hrs']],
])

// 14. TS view: nothing submitted yet
await scenario('timesheet empty', phone(14), [
  ['ts', ['Nothing submitted for']],
  ['ts blah', ["Didn't catch that day"]],
])

// 15. Backdated report + "ts yesterday"
await cleanupTestTech()
await scenario('yesterday', phone(15), [
  ['This is Test. forgot to send yesterday - 4760 8hrs engine work, in 7, out 330, lunch 30, no pd', ['Got it Test', '4760: 8hrs']],
  ['ts yesterday', [friendlyDate(atlanticDate(1)), '4760: 8hrs']],
])

// 16. Overtime shows in the running total
await cleanupTestTech()
await scenario('overtime', phone(16), [
  ['This is Test. Started 7am, 4760 10hrs engine work, no lunch, no PD', [
    '4760: 10hrs',
    'Total 10hrs (2 OT)',
  ]],
])

// 17. Split day across two jobs with OT
await cleanupTestTech()
await scenario('split day OT', phone(17), [
  ['This is Test. Started 7am, 4760 6hrs bearings, 4862 4hrs fuel lines, lunch 30, no PD', [
    '4760: 6hrs',
    '4862: 4hrs',
    'Total 10hrs (2 OT)',
  ]],
])

// 18. Hours inferred from time bounds when "all day" used
await cleanupTestTech()
await scenario('all day inference', phone(18), [
  ['This is Test. Worked all day on 4760, started 7am, til 3:30, lunch 30, no PD', [
    'Got it Test',
    '4760: 8hrs',
  ]],
])

// 19. Supplies mixed into an hours text are captured (visible in TS view)
await cleanupTestTech()
await scenario('supplies inline', phone(19), [
  ['This is Test. 4760 6hrs bearings, used 2 cans of brake cleaner, in 7, lunch 30', ['4760: 6hrs']],
  ['ts', ['Supplies:', 'brake cleaner x2']],
])

// 20. A job's work description is not a supply — "4hrs seals" stays out of supplies
await cleanupTestTech()
await scenario('work description is not a supply', phone(20), [
  ['This is Test. 4760 4hrs seals, in 8, lunch 30, no pd', ['4760: 4hrs']],
  ['ts', [{ absent: 'Supplies:' }]],
])

// ── rough-language scenarios ───────────────────────────────────────────────
// Simulating how different techs actually text: lowercase, typos, run-ons,
// slang, military time, spelled-out numbers, rambling. All map to Test Tech.

// 21. All lowercase, zero punctuation
await cleanupTestTech()
await scenario('lowercase no punctuation', phone(21), [
  ['this is test worked 4760 8 hrs in at 7 out at 330 half hour lunch no pd', ['Got it Test', '4760: 8hrs', ...NO_NAG]],
])

// 22. Typos everywhere
await cleanupTestTech()
await scenario('typos', phone(22), [
  ['This is Test. wrked on 4760 8hrs, startd 7am, dun at 330, lnch 30, no pd', ['Got it Test', '4760: 8hrs']],
])

// 23. Military time — times land correctly (checked via TS view)
await cleanupTestTech()
await scenario('military time', phone(23), [
  ['This is Test. 0700 to 1530, 4760 8hrs valve job, lunch 30, no per diem', ['4760: 8hrs']],
  ['ts', ['In 7am', '3:30pm']],
])

// 24. Decimal hours across two jobs
await cleanupTestTech()
await scenario('decimal hours', phone(24), [
  ['This is Test. 4760 6.5hrs hyd pump, 4862 1.5hrs, in 7, lunch 30, no PD', [
    '4760: 6.5hrs',
    '4862: 1.5hrs',
    'Total 8hrs',
  ]],
])

// 25. "worked thru lunch" + "going home" with OT
await cleanupTestTech()
await scenario('worked thru lunch', phone(25), [
  ['This is Test. in at 6, 4760 10hrs gearbox teardown, worked thru lunch, going home after', [
    '4760: 10hrs',
    'Total 10hrs (2 OT)',
  ]],
])

// 26. "its [name]" identification form (no apostrophe)
await cleanupTestTech()
await scenario('its name form', phone(26), [
  ['its test, 4760 8hrs, in 8, out 430, lunch 30, no pd', ['Got it Test', '4760: 8hrs']],
])

// 27. Spelled-out numbers ("eight hours", "started at seven")
await cleanupTestTech()
await scenario('spelled out numbers', phone(27), [
  ['This is Test. eight hours on 4760 today, started at seven, lunch 30, no PD', ['4760: 8hrs']],
])

// 28. Run-on: three jobs, bare numbers, no "hrs" anywhere
await cleanupTestTech()
await scenario('run-on three jobs', phone(28), [
  ['this is test 4760 3 4862 3 4901 2 in 7 lunch 30 no pd', [
    '4760: 3hrs',
    '4862: 3hrs',
    '4901: 2hrs',
    'Total 8hrs',
  ]],
])

// 29. Rambling with filler words, casual hotel mention, OT
await cleanupTestTech()
await scenario('rambling with hotel', phone(29), [
  ['hey its test here, long day lol. did the engine swap on 4760, took me like 9 hrs. got in at 630. grabbed a quick half hr lunch. crashing at the comfort inn in sydney tonight', [
    '4760: 9hrs',
    'Total 9hrs (1 OT)',
    ...NO_NAG,
  ]],
  ['ts', [/PD: .*[Cc]omfort/]],
])

// 30. ALL CAPS
await cleanupTestTech()
await scenario('all caps', phone(30), [
  ['THIS IS TEST 4760 8HRS IN 7 OUT 330 LUNCH 30 NO PD', ['Got it Test', '4760: 8hrs']],
])

// 31. Newline-separated fragments, terse
await cleanupTestTech()
await scenario('newline fragments', phone(31), [
  ['This is Test\n4760 8hrs\nin 7 out 3\nno lunch\nno pd', ['Got it Test', '4760: 8hrs', ...NO_NAG]],
])

// ── photo scenarios (need outbound network + storage writes; filter out if flaky) ──

const TEST_IMAGE = 'https://placehold.co/60x60.jpg'

// 32. Photo with a job # caption tags directly; uncaptioned photo assumes the
//     day's job; a comment after a photo never triggers the job question
await cleanupTestTech()
await scenario('photo tagging', phone(32), [
  ['This is Test. 4760 2hrs pump seals', ['4760: 2hrs']],
  ['', ['Got the photo', 'logged to 4760'], [TEST_IMAGE]],
  ['old card clips, looking for a spare', [{ absent: 'Which job' }, { absent: 'job number' }]],
])

// ── summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`  Passed: ${passed}   Failed: ${failed}   Total: ${passed + failed}`)
if (failed > 0) {
  console.log(`  Note: test submissions remain in DB (phones contain RUN_ID ${RUN_ID})`)
  process.exit(1)
}
