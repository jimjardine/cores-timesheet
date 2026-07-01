import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const HELP_TEXT = `Cores Timesheets

Send jobs as you finish them:
"4760, 6hrs — rebuilt port engine bearings, replaced seals on forward pump"

Start your day with your in-time:
"In 7:30, 4760 6hrs — engine work"

Wrap up with out time and lunch:
"Out 4:30, lunch 30, staying at Delta Halifax"

Or send it all at once:
"In 7:30, 4760 6hrs bearings, 4862 2hrs fuel lines, lunch 30, no PD"

Using someone else's phone?
Start with: "This is Joey"

Reply HELP anytime.`

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

function twiML(msg: string): Response {
  const safe = msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

function jsonReply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
}

// Atlantic Time (UTC-4 summer / UTC-3.5 NS — using -4 as safe approximation)
function atlanticToday(): string {
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000)
  return now.toISOString().split('T')[0]
}

function timeToMins(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + (m || 0)
}

function minsToTime(mins: number): string {
  const clamped = ((mins % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function friendlyTime(t: string): string {
  const total = timeToMins(t)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}

function friendlyDate(d: string): string {
  const [y, mo, day] = d.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const dt = new Date(Date.UTC(y, mo - 1, day))
  return `${dow[dt.getUTCDay()]} ${months[mo - 1]} ${day}`
}

function calcOTBreakdown(entries: any[], dailyThreshold: number, alreadyWorked = 0): any[] {
  let regLeft = Math.max(0, dailyThreshold - alreadyWorked)
  return entries.map(e => {
    const hours = Math.round((Number(e.hours) || 0) * 100) / 100
    const reg   = Math.round(Math.min(hours, Math.max(0, regLeft)) * 100) / 100
    const ot    = Math.round((hours - reg) * 100) / 100
    regLeft     = Math.max(0, regLeft - hours)
    return { ...e, reg_hours: reg, ot_hours: ot }
  })
}

// ── Claude parser ─────────────────────────────────────────────────────────────

async function parseWithClaude(msgBody: string, today: string): Promise<any> {
  const system = `You are a timesheet parser for a marine engineering company in Nova Scotia, Canada.
Extract timesheet data from the worker's text and return ONLY valid JSON with no explanation or markdown.

Today's date is ${today}.

Return exactly this JSON structure (all fields required, use null when absent):
{
  "name_override": null,
  "work_date": null,
  "time_in": null,
  "stated_time_out": null,
  "lunch_minutes": null,
  "per_diem_location": null,
  "entries": [],
  "is_help_request": false
}

Rules:
- name_override: first name string if they said "this is [name]", "it's [name]", "for [name]" — else null
- work_date: "YYYY-MM-DD" if a date is mentioned (resolve "yesterday", day names, "June 30", etc.) — else null
- time_in: "HH:MM" 24-hour if a start time is mentioned — else null
- stated_time_out: "HH:MM" 24-hour only if they explicitly said when they finished/left — else null
- lunch_minutes: integer minutes if lunch mentioned ("lunch 30" → 30), 0 if explicitly no lunch ("no lunch", "worked through") — null if not mentioned at all
- per_diem_location: hotel/location string if staying overnight, "none" if explicitly no per diem ("no PD", "no per diem", "going home") — null if not mentioned at all
- entries: [{job_number:"4-digit string", hours:number, description:"verbatim from message"}] — only real job work
- is_help_request: true only if the entire message is a help request

Job numbers are 4-digit numbers. Hours can be decimal (6.5, 4.25).`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: msgBody }]
    })
  })

  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in Claude response: ${text}`)
  return JSON.parse(jsonMatch[0])
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Parse incoming request (Twilio form or test JSON) ──
  let fromPhone = ''
  let msgBody = ''
  const isTwilio = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')

  try {
    if (isTwilio) {
      const form = await req.formData()
      fromPhone = normalizePhone(form.get('From') as string || '')
      msgBody = (form.get('Body') as string || '').trim()
    } else {
      const json = await req.json()
      fromPhone = normalizePhone(json.from_phone || '')
      msgBody = (json.body || '').trim()
    }
  } catch {
    const r = 'Error reading message.'
    return isTwilio ? twiML(r) : jsonReply({ error: r }, 400)
  }

  if (!msgBody) {
    const r = 'Got an empty message. Reply HELP for tips.'
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  if (/^(help|\?)$/i.test(msgBody)) {
    return isTwilio ? twiML(HELP_TEXT) : jsonReply({ reply: HELP_TEXT })
  }

  const today = atlanticToday()

  // ── Parse with Claude ──
  let parsed: any = {
    entries: [], name_override: null, work_date: null,
    time_in: null, stated_time_out: null,
    lunch_minutes: null, per_diem_location: null,
    is_help_request: false
  }

  try {
    parsed = await parseWithClaude(msgBody, today)
  } catch (_e) {
    const r = "Couldn't read that one. Reply HELP for the format, or text Nicki directly."
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  if (parsed.is_help_request) {
    return isTwilio ? twiML(HELP_TEXT) : jsonReply({ reply: HELP_TEXT })
  }

  // ── Employee lookup (name override → phone) ──
  let employeeId: string | null = null
  let employeeName: string | null = null

  if (parsed.name_override) {
    const { data: byName } = await supabase
      .from('employees')
      .select('id, name')
      .ilike('name', `%${parsed.name_override}%`)
      .eq('active', true)
      .limit(1)
    if (byName?.length) { employeeId = byName[0].id; employeeName = byName[0].name }
  }

  if (!employeeId && fromPhone) {
    const { data: allEmps } = await supabase.from('employees').select('id, name, phone').eq('active', true)
    const match = (allEmps || []).find((e: any) => e.phone && normalizePhone(e.phone) === fromPhone)
    if (match) { employeeId = match.id; employeeName = match.name }
  }

  // ── Work date ──
  const workDate = parsed.work_date || today

  // ── Find existing collecting submission ──
  let submission: any = null
  const { data: byPhone } = await supabase
    .from('sms_submissions')
    .select('*')
    .eq('from_phone', fromPhone)
    .eq('work_date', workDate)
    .eq('status', 'collecting')
    .order('created_at', { ascending: false })
    .limit(1)
  if (byPhone?.length) submission = byPhone[0]

  if (!submission && employeeId) {
    const { data: byEmp } = await supabase
      .from('sms_submissions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .eq('status', 'collecting')
      .order('created_at', { ascending: false })
      .limit(1)
    if (byEmp?.length) submission = byEmp[0]
  }

  // Whether this is a follow-up reply to our question
  const isFollowUp = !!(submission && (submission.pending_questions || []).length > 0)

  // ── Merge fields ──
  const prevEntries: any[] = submission?.entries || []
  const allEntries = [...prevEntries, ...(parsed.entries || [])]

  const mergedTimeIn      = submission?.time_in        ? submission.time_in.substring(0, 5) : parsed.time_in
  const mergedStatedOut   = submission?.stated_time_out ? submission.stated_time_out.substring(0, 5) : parsed.stated_time_out
  const mergedLunch       = (submission?.lunch_minutes != null)    ? submission.lunch_minutes    : parsed.lunch_minutes
  const mergedPerDiem     = (submission?.per_diem_location != null) ? submission.per_diem_location : parsed.per_diem_location
  const mergedEmployeeId  = employeeId || submission?.employee_id || null

  // ── Calculate time_out from hours + lunch ──
  const totalHours = allEntries.reduce((s: number, e: any) => s + (Number(e.hours) || 0), 0)
  let calcOut: string | null = null
  let deltaMinutes: number | null = null

  if (mergedTimeIn && totalHours > 0) {
    const lunchMins = mergedLunch || 0
    calcOut = minsToTime(timeToMins(mergedTimeIn) + Math.round(totalHours * 60) + lunchMins)
    if (mergedStatedOut) {
      deltaMinutes = timeToMins(mergedStatedOut) - timeToMins(calcOut)
    }
  }

  // ── OT breakdown ──
  // Fetch daily threshold + any hours already approved for this employee today
  // so second/third texts in a day get correct OT attribution
  const [{ data: otCfg }, { data: priorEntries }] = await Promise.all([
    supabase.from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single(),
    mergedEmployeeId
      ? supabase.from('timesheet_entries').select('hours').eq('employee_id', mergedEmployeeId).eq('work_date', workDate)
      : Promise.resolve({ data: [] }),
  ])
  const dailyOTThreshold = otCfg ? Number(otCfg.value) : 8
  const alreadyWorkedHours = (priorEntries || []).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const allEntriesWithOT = calcOTBreakdown(allEntries, dailyOTThreshold, alreadyWorkedHours)
  const totalOTHours = allEntriesWithOT.reduce((s: number, e: any) => s + (e.ot_hours || 0), 0)
  const totalTodayHours = alreadyWorkedHours + totalHours

  // ── Determine what's missing ──
  const missingEmployee = !mergedEmployeeId
  const missingEntries  = allEntries.length === 0
  const missingLunch    = mergedLunch == null
  const missingPerDiem  = mergedPerDiem == null

  // Fields Nicki will need to fill in (shown in review screen)
  const flags: string[] = []
  if (!mergedTimeIn)              flags.push('start time missing')
  if (missingLunch && isFollowUp) flags.push('lunch unknown')
  if (missingPerDiem && isFollowUp) flags.push('per diem unknown')

  // ── One-question logic ──
  // Max one exchange with the worker. On follow-up, submit regardless.
  let reply = ''
  let nextStatus = 'collecting'
  let pendingQuestions: string[] = []
  const firstName = (employeeName || '').split(' ')[0] || ''

  if (missingEmployee && !isFollowUp) {
    reply = `Hi! Couldn't match your number to an employee.\nReply: "This is [your name]"`
    pendingQuestions = ['Who is this?']

  } else if (missingEmployee && isFollowUp) {
    // Still can't identify them — hold for Nicki
    reply = `Couldn't find "${parsed.name_override || 'that name'}" in the system. Nicki will sort it out.`
    nextStatus = 'submitted'
    flags.push('employee not identified — needs manual assignment')

  } else if (missingEntries && !isFollowUp) {
    reply = `Got it${firstName ? ' ' + firstName : ''}. Which job(s) did you work on?\n(e.g. "4760 6hrs port engine work")`
    pendingQuestions = ['Job entries?']

  } else if (missingEntries && isFollowUp) {
    reply = `Got it${firstName ? ' ' + firstName : ''} — Nicki will follow up on the job details.`
    nextStatus = 'submitted'
    flags.push('no job entries — needs manual entry')

  } else if ((missingLunch || missingPerDiem) && !isFollowUp) {
    // Ask both missing pieces in one message
    const entrySummary = allEntriesWithOT.map((e: any) => `${e.job_number} ${e.hours}hrs`).join(', ')
    const qs: string[] = []
    if (missingLunch)   qs.push('lunch? ("lunch 30" or "no lunch")')
    if (missingPerDiem) qs.push('per diem tonight? (location or "no PD")')
    reply = `Got it ${firstName} — ${entrySummary}\n\nQuick: ${qs.join(' | ')}`
    pendingQuestions = qs

  } else {
    // All present, or follow-up — submit with what we have
    nextStatus = 'submitted'
    const date     = friendlyDate(workDate)
    const inFmt    = mergedTimeIn ? friendlyTime(mergedTimeIn) : '?'
    const outFmt   = calcOut      ? friendlyTime(calcOut)      : (mergedStatedOut ? friendlyTime(mergedStatedOut) : '?')
    const lunchFmt = mergedLunch  ? `lunch ${mergedLunch}min`  : (mergedLunch === 0 ? 'no lunch' : '')
    const pdLine   = mergedPerDiem === 'none' ? 'No per diem'
                   : mergedPerDiem            ? `PD: ${mergedPerDiem}`
                   : ''
    const flagLine = flags.length ? `\n(Nicki will check: ${flags.join(', ')})` : ''

    // Per-job OT breakdown lines
    const entryLines = allEntriesWithOT.map((e: any) => {
      if (e.ot_hours > 0) return `${e.job_number}: ${e.reg_hours}hrs reg + ${e.ot_hours}hrs OT`
      return `${e.job_number}: ${e.hours}hrs reg`
    }).join('\n')

    const totalRegToday = totalTodayHours - (alreadyWorkedHours > dailyOTThreshold ? alreadyWorkedHours - dailyOTThreshold : 0) - totalOTHours
    const totalOTToday  = Math.max(0, totalTodayHours - dailyOTThreshold)
    const totalLine = alreadyWorkedHours > 0
      ? `Today total: ${totalTodayHours}hrs (${Math.min(totalTodayHours, dailyOTThreshold)}reg + ${totalOTToday > 0 ? totalOTToday + 'OT' : '0OT'}) — ${alreadyWorkedHours}hrs already logged`
      : totalOTHours > 0
        ? `Total: ${totalHours}hrs (${(totalHours - totalOTHours).toFixed(2).replace(/\.?0+$/, '')}reg + ${totalOTHours}OT)`
        : `Total: ${totalHours}hrs reg`

    reply = [
      `Done ${firstName} ✓ ${date} | ${inFmt}–${outFmt}${lunchFmt ? ' | ' + lunchFmt : ''}`,
      entryLines,
      totalLine,
      pdLine,
      `Nicki has it.${flagLine}`
    ].filter(Boolean).join('\n')
  }

  // ── Save/update submission ──
  const prevMsgs: any[] = submission?.raw_messages || []
  const allMsgs = [
    ...prevMsgs,
    { text: msgBody, direction: 'in',  ts: new Date().toISOString() },
    { text: reply,   direction: 'out', ts: new Date().toISOString() },
  ]

  const record: any = {
    from_phone:         fromPhone,
    employee_id:        mergedEmployeeId,
    work_date:          workDate,
    time_in:            mergedTimeIn || null,
    stated_time_out:    mergedStatedOut || null,
    lunch_minutes:      mergedLunch,
    per_diem_location:  mergedPerDiem,
    calculated_time_out: calcOut,
    delta_minutes:      deltaMinutes,
    entries:            allEntriesWithOT,
    pending_questions:  pendingQuestions,
    raw_messages:       allMsgs,
    status:             nextStatus,
    updated_at:         new Date().toISOString(),
  }

  if (submission) {
    await supabase.from('sms_submissions').update(record).eq('id', submission.id)
  } else {
    await supabase.from('sms_submissions').insert(record)
  }

  return isTwilio ? twiML(reply) : jsonReply({ reply, status: nextStatus, flags })
})
