import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Handles both SMS (via Twilio) and WhatsApp (via Twilio Messaging API)
// Webhook payload is identical for both; Twilio routes based on channel config

// Top-level HELP is a short menu; "HELP <topic>" (or "? <topic>") drills into one
// of these for the full detail — keeps the default reply short while still having
// the detail available on request.
const HELP_TEXT = `Cores Timesheets — commands:
• Just text your hours (e.g. "4760 6hrs bearings")
• HOURS — full format guide
• JOBS — job list
• PHONE# — phone directory
• PHOTO — gear photos
• SUPPLIES — log parts used
• OTHER — using someone else's phone

Reply HELP + a word above for details (e.g. "HELP jobs").

💬 Use WhatsApp or SMS — works both ways.`

const HELP_TOPICS: Record<string, string> = {
  hours: `HOURS — format guide

Send jobs as you finish them:
"4760, 6hrs — rebuilt port engine bearings, replaced seals on forward pump"

Start your day with your in-time:
"In 7:30, 4760 6hrs — engine work"

Wrap up with out time and lunch:
"Out 4:30, lunch 30, staying at Delta Halifax"

Or send it all at once:
"In 7:30, 4760 6hrs bearings, 4862 2hrs fuel lines, lunch 30, no PD"`,

  format: '', // alias, filled in below
  jobs: `JOBS — job list

Text JOBS for the full open job list.
Text JOBS + boat name for just that boat's jobs (e.g. "JOBS nanaimo").`,

  phone: `PHONE# — phone directory

Text PHONE# for everyone's number.
Text PHONE# + a name for just theirs (e.g. "PHONE# joey").`,

  photo: `PHOTO — gear photos

Text a photo with the ship name or job # (e.g. photo + "Wave Master" or photo + "4760").
No caption? It'll ask which ship or job before saving it.`,

  photos: '', // alias, filled in below

  supplies: `SUPPLIES — log parts used

Add them to your hours text or on their own:
"supplies brake cleaner x1, wire brushes x2 Job 4358"

No job number given? It's attributed to the first job in that text.`,

  other: `USING SOMEONE ELSE'S PHONE

Start your text with: "This is Joey" so the hours land on their timesheet, not yours.`,
}
HELP_TOPICS.format = HELP_TOPICS.hours
HELP_TOPICS.photos = HELP_TOPICS.photo

function helpReply(topicRaw: string | undefined): string {
  const topic = (topicRaw || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return (topic && HELP_TOPICS[topic]) || HELP_TEXT
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

function extractExifData(_jpegBuffer: ArrayBuffer): { lat?: number; lng?: number; timestamp?: string } {
  // Disabled: piexifjs (npm:piexifjs@0.1.12) isn't a real published version and pulling
  // in a real one broke boot in the edge runtime. Re-enable once a working, edge-compatible
  // EXIF library is confirmed via a real deploy test.
  return {}
}

// Resolves a ship_or_job string to a real job, when it happens to be a job number —
// ship-name-only tags (no matching job_number) correctly resolve to null.
async function lookupJobId(supabase: any, shipOrJob: string | null): Promise<string | null> {
  if (!shipOrJob) return null
  const { data } = await supabase.from('jobs').select('id').ilike('job_number', shipOrJob.trim()).limit(1).maybeSingle()
  return data?.id || null
}

async function savePhotoToStorage(
  supabase: any,
  mediaUrl: string,
  employeeId: string | null,
  fromPhone: string,
  workDate: string,
  shipOrJob: string | null = null,
  jobId: string | null = null
): Promise<{ path: string; size: number; id: string } | null> {
  const t0 = Date.now()
  try {
    // Download photo from Twilio — media URLs (SMS/MMS and WhatsApp alike) require
    // Basic Auth with the account's own credentials; an unauthenticated fetch gets a 401.
    // Twilio itself only waits ~15s for our whole webhook response before it gives up
    // (Error 11200), so there's no point letting a stalled download run any longer than
    // that — cap it well under Twilio's own patience and fail fast instead of hanging.
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const token = Deno.env.get('TWILIO_AUTH_TOKEN')
    const photoRes = await fetch(mediaUrl, {
      headers: sid && token ? { 'Authorization': 'Basic ' + btoa(`${sid}:${token}`) } : {},
      signal: AbortSignal.timeout(8000),
    })
    console.error(`Photo download took ${Date.now() - t0}ms, status ${photoRes.status}`)
    if (!photoRes.ok) {
      console.error('Photo download failed:', photoRes.status, mediaUrl)
      return null
    }
    const photoBlob = await photoRes.arrayBuffer()
    const photoSize = photoBlob.byteLength

    // Determine file extension from content-type
    const contentType = photoRes.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg'

    // Store in Supabase Storage: gear-photos/YYYY-MM-DD/employee_id/timestamp.ext
    // or gear-photos/YYYY-MM-DD/phone/timestamp.ext if no employee match
    const ts = Date.now()
    const subdir = employeeId || fromPhone
    const filename = `${ts}.${ext}`
    const path = `${workDate}/${subdir}/${filename}`

    const { error: uploadError } = await supabase.storage
      .from('gear-photos')
      .upload(path, new Uint8Array(photoBlob), { contentType })

    console.error(`Photo upload took ${Date.now() - t0}ms total, size ${photoSize}b`)
    if (uploadError) {
      console.error('Photo upload error:', uploadError.message)
      return null
    }

    // Extract EXIF data (GPS, timestamp)
    const exifData = extractExifData(photoBlob)

    // Save metadata to gear_photos table
    const { data: inserted, error: insertError } = await supabase.from('gear_photos').insert({
      employee_id: employeeId,
      work_date: workDate,
      from_phone: fromPhone,
      storage_path: path,
      file_size_bytes: photoSize,
      ship_or_job: shipOrJob,
      job_id: jobId,
      pending_context: !shipOrJob,
      photo_latitude: exifData.lat || null,
      photo_longitude: exifData.lng || null,
      photo_timestamp: exifData.timestamp || null,
    }).select('id').single()

    if (insertError || !inserted) {
      console.error('Photo metadata save error:', insertError?.message)
      return null
    }

    return { path, size: photoSize, id: inserted.id }
  } catch (err: any) {
    console.error(`Photo save error after ${Date.now() - t0}ms:`, err.name, err.message)
    return null
  }
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

// Proactive outbound send — everything else in this file only replies within
// an inbound Twilio webhook request (TwiML). This is the one path that pushes
// a message unprompted (used for manual-entry confirmation requests).
async function sendTwilioSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return { ok: false, error: 'Twilio credentials not configured' }

  const from = '+19024046969' // existing Cores Twilio number
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `Twilio send failed (${res.status}): ${detail.slice(0, 200)}` }
  }
  return { ok: true }
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
  "supplies": [],
  "is_help_request": false
}

Rules:
- Workers text casually: expect ALL CAPS, all lowercase, typos, and run-on sentences. Match all phrases below case-insensitively.
- name_override: first name string if they said "this is [name]", "it's [name]", "for [name]" (any casing — "THIS IS JOEY" counts) — else null
- work_date: "YYYY-MM-DD" if a date is mentioned (resolve "yesterday", day names, "June 30", etc.) — else null
- time_in: "HH:MM" 24-hour if a start time is mentioned anywhere in the message — else null. A time range on a job ("4709 9 to 5") counts as mentioning the shift's start time even without an "in"/"started" keyword — extract the first time as time_in.
- stated_time_out: "HH:MM" 24-hour if they said when they finished/left anywhere in the message — else null. A time range on a job ("4709 9 to 5") counts here too — extract the second time as stated_time_out, the same way "worked 4760 all day, in 7 out 5" would.
- lunch_minutes: integer minutes if lunch mentioned ("lunch 30" → 30, "half hour lunch" → 30, "1/2 hour" → 30), 0 if explicitly no lunch ("no lunch", "worked through", "no break") — null if not mentioned at all
- per_diem_location: hotel/location string if staying overnight, "none" if explicitly no per diem ("no PD", "no per diem", "going home", "nope", "no", "worked in the shop", "at the shop", "local", "not staying") — null if not mentioned at all
- entries: [{job_number:"4-digit string or SHOP", hours:number|null, description:"verbatim from message"}] — only real job work. Internal shop work with no customer job ("shop", "job shop", "shop work", "in the shop doing X") gets job_number "SHOP" (always uppercase). hours: the number ONLY if the worker explicitly stated hours for that specific job as a duration ("4760 6hrs", "3.5 hours on 4862") — otherwise null. A time range attached to a job ("4709 9 to 5", "4760 from 8 to 4") is NOT explicit hours — leave hours null even though it looks computable; do not subtract or compute anything yourself. Never estimate, guess, or split a shift total across jobs yourself, even if you know time_in/stated_time_out — the app does that math from the overall time bounds and lunch after parsing.
- supplies: [{job_number:"4-digit string", supply_name:string, quantity:number}] — materials/consumables used on a job, e.g. "supplies brake cleaner x1, wire brushes x2 Job 4358" or mixed in with hours ("4760 6hrs bearings, used 2 cans brake cleaner"). Quantity from "x2", "2 cans", "two rolls" etc — default 1 if just named. supply_name is the item without the quantity ("brake cleaner", not "brake cleaner x1"). If no job number is given with the supplies, use the job from the same message; empty string if no job mentioned at all. Supplies are NOT job work — never create an entries item from a supplies phrase.
- is_help_request: true only if the entire message is a help request

Job numbers are 4-digit numbers. Hours can be decimal (6.5, 4.25). Quantities can be decimal (0.5).`

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: msgBody }]
  })
  const headers = {
    'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }

  let res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: payload })
  for (const waitMs of [4000, 10000]) {
    if (res.status !== 429 && res.status !== 529) break
    await new Promise(r => setTimeout(r, waitMs))
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: payload })
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in Claude response (${res.status}): ${text}`)
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
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'Cores' } }
  )

  // ── Parse incoming request (Twilio form or test JSON) ──
  let fromPhone = ''
  let msgBody = ''
  let mediaUrls: string[] = []
  const isTwilio = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')

  try {
    if (isTwilio) {
      const form = await req.formData()
      fromPhone = normalizePhone(form.get('From') as string || '')
      msgBody = (form.get('Body') as string || '').trim()
      // Collect media URLs from MMS (MediaUrl0, MediaUrl1, etc)
      const numMedia = Number(form.get('NumMedia') || 0)
      for (let i = 0; i < numMedia; i++) {
        const url = form.get(`MediaUrl${i}`)
        if (url) mediaUrls.push(url as string)
      }
    } else {
      const json = await req.json()

      // App-triggered action (not a Twilio webhook) — request an employee's
      // confirmation of a manual entry Nicki just typed in
      if (json.action === 'request_confirmation') {
        const { data: employee } = await supabase
          .from('employees').select('id, name, phone').eq('id', json.employee_id).single()
        if (!employee?.phone) {
          return jsonReply({ ok: false, error: 'No phone number on file for this employee' })
        }

        const { data: pending } = await supabase
          .from('timesheet_entries')
          .select('hours, jobs(job_number)')
          .eq('employee_id', json.employee_id)
          .eq('work_date', json.work_date)
          .eq('entry_source', 'manual')
          .eq('confirmation_status', 'pending')
        if (!pending || pending.length === 0) {
          return jsonReply({ ok: false, error: 'No pending manual entries found for that day' })
        }

        const summary = pending.map((e: any) => `${e.jobs?.job_number || 'job'} ${Number(e.hours)}hrs`).join(', ')
        const msg = `Nicki logged your timesheet for ${friendlyDate(json.work_date)}: ${summary}. Reply to this text to confirm.`
        const sendResult = await sendTwilioSms(employee.phone, msg)

        await supabase
          .from('timesheet_entries')
          .update({ confirmation_requested_at: new Date().toISOString() })
          .eq('employee_id', json.employee_id)
          .eq('work_date', json.work_date)
          .eq('entry_source', 'manual')
          .eq('confirmation_status', 'pending')

        return jsonReply(sendResult)
      }

      fromPhone = normalizePhone(json.from_phone || '')
      msgBody = (json.body || '').trim()
      mediaUrls = json.media_urls || []
    }
  } catch {
    const r = 'Error reading message.'
    return isTwilio ? twiML(r) : jsonReply({ error: r }, 400)
  }

  if (!msgBody && mediaUrls.length === 0) {
    const r = 'Got an empty message. Reply HELP for tips.'
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  const today = atlanticToday()
  const msgLower = msgBody.toLowerCase().trim()

  const helpMatch = msgBody.match(/^(?:help|\?)\s*(.*)$/i)
  if (helpMatch) {
    const r = helpReply(helpMatch[1])
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Employee lookup by phone (name-override, if any, is applied further down once
  // Claude has parsed the message — but photos short-circuit before that point, so this
  // phone-based match needs to happen up here to get attributed to gear photos too). ──
  let employeeId: string | null = null
  let employeeName: string | null = null
  if (fromPhone) {
    const { data: byPhone } = await supabase
      .from('employees')
      .select('id, name, phone, whatsapp_phone, active')
    const match = (byPhone || []).find((e: any) =>
      (e.phone && normalizePhone(e.phone) === fromPhone) || (e.whatsapp_phone && normalizePhone(e.whatsapp_phone) === fromPhone))
    if (match) { employeeId = match.id; employeeName = match.name }
  }

  // ── Check for pending photos awaiting context (ship/job) ──
  const { data: pendingPhotos } = await supabase
    .from('gear_photos')
    .select('id, ship_or_job')
    .eq('from_phone', fromPhone)
    .eq('work_date', today)
    .eq('pending_context', true)
    .order('created_at', { ascending: false })

  // Only treat this as a context reply for an EARLIER pending photo when the current
  // message carries no photos of its own and actually has text — otherwise a second
  // photo arriving in the same batch (its own empty caption trivially satisfies
  // "short reply") gets misread as context for the first, and its own image is never
  // saved at all (Twilio delivers each image in a multi-photo send as a separate,
  // independent webhook call, not one request with several attachments).
  const isNonAnswer = /^(unknown|idk|i\s*don'?t\s*know|not\s*sure|no\s*idea|n\/?a|dunno)\.?$/i.test(msgBody.trim())
  if (pendingPhotos && pendingPhotos.length > 0 && mediaUrls.length === 0 && isNonAnswer) {
    // Don't accept a non-answer as if it were real context — it would otherwise get
    // stamped onto every currently-pending photo for this phone/day and silently drop
    // out of the "needs ship/job" queue despite still not actually being tagged.
    const reply = `No worries — I'll leave it flagged for Nicki. A ship name works too if you don't have the job number.`
    return isTwilio ? twiML(reply) : jsonReply({ reply })
  }

  if (pendingPhotos && pendingPhotos.length > 0 && mediaUrls.length === 0 && msgBody.trim().length > 0 && msgBody.length < 100) {
    // Short response likely to be ship/job context — update pending photos. Also backfill
    // employee_id: these were saved before identity could be resolved (no caption yet).
    const jobId = await lookupJobId(supabase, msgBody.trim())
    const { error: updateError } = await supabase
      .from('gear_photos')
      .update({
        ship_or_job: msgBody.trim(),
        job_id: jobId,
        pending_context: false,
        ...(employeeId ? { employee_id: employeeId } : {}),
      })
      .eq('from_phone', fromPhone)
      .eq('work_date', today)
      .eq('pending_context', true)

    if (!updateError) {
      const reply = `Got it — photo context saved.`
      return isTwilio ? twiML(reply) : jsonReply({ reply })
    }
  }

  // ── Phone directory request ──
  // Accept "phone"/"phones", "phonenum"/"phonenums", "phone#", "phone #", optionally
  // followed by a name filter — the exact "phone#" string was too strict and easy to
  // miss (no "#" key on some phones, easy to forget), so a plain "phone" fell through
  // to the normal timesheet parser instead of ever reaching this check. Same story for
  // the natural variants "phones" and "phonenum(s)".
  const phoneReqMatch = msgLower.match(/^phone(?:nums?|s)?\s*#?(?:\s+(.*))?$/)
  const isPhoneRequest = !!phoneReqMatch
  if (isPhoneRequest) {
    const nameFilter = phoneReqMatch[1]?.trim() || null

    const { data: employees } = await supabase
      .from('employees')
      .select('name, phone')
      .eq('active', true)
      .order('name')

    if (!employees || employees.length === 0) {
      const r = 'No active employees found.'
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    const filtered = nameFilter
      ? employees.filter((e: any) => e.name && e.phone && e.name.toLowerCase().includes(nameFilter))
      : employees.filter((e: any) => e.name && e.phone)

    if (filtered.length === 0) {
      const r = nameFilter ? `No match for "${nameFilter}".` : 'No employees with phone numbers.'
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    const lines = filtered.map((e: any) => `${e.name}: ${e.phone}`).join('\n')
    const r = nameFilter
      ? lines
      : `Phone directory:\n\n${lines}`
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Check for photo submission and context ──
  const hasPhotos = mediaUrls.length > 0
  let photoContext: string | null = null
  if (hasPhotos) {
    // Try to spot a job or ship mention in the caption. Check deterministically first —
    // a bare job number ("4847") has no hours attached, so the full timesheet parser
    // (which only extracts entries that look like real logged time) sees no entry at
    // all and would wrongly conclude there's no context.
    let hasJobContext = false
    const jobNumberMatch = msgBody.match(/\b(\d{4})\b/)
    if (jobNumberMatch) {
      photoContext = jobNumberMatch[1]
      hasJobContext = true
    } else if (/wave|nanaimo|ship|boat/i.test(msgBody)) {
      photoContext = msgBody.trim().substring(0, 50)
      hasJobContext = true
    } else if (msgBody) {
      // Caption doesn't match either simple pattern — fall back to the full parser
      // in case it's phrased as a normal timesheet entry ("4847 6hrs bearings").
      try {
        const testParse = await parseWithClaude(msgBody, today)
        const candidate = testParse.entries?.[0]?.job_number
        // Only trust it if it actually looks like a job number — Claude can otherwise
        // echo back nonsense captions ("I don't know") verbatim as a "job_number".
        if (candidate && /^(\d{4}|SHOP)$/i.test(candidate)) {
          photoContext = candidate
          hasJobContext = true
        }
      } catch {
        // no-op — hasJobContext stays false, photo gets saved pending context
      }
    }

    if (!hasJobContext) {
      // Save photos without context, then prompt for it
      const saved = await Promise.all(
        mediaUrls.map(url => savePhotoToStorage(supabase, url, employeeId, fromPhone, today, null))
      )
      const firstName = (employeeName || '').split(' ')[0] || ''
      const reply = saved.some(r => r !== null)
        ? `Got the photo${firstName ? ' ' + firstName : ''}. Which ship or job?`
        : `Couldn't save that photo${firstName ? ' ' + firstName : ''} — try texting it again, or contact Nicki if it keeps failing.`
      return isTwilio ? twiML(reply) : jsonReply({ reply })
    }

    // Save photos with context and stop — a photo is never also treated as an hours
    // submission, even when the caption is long/descriptive enough to look like one.
    // (Previously fell through into the normal timesheet flow for captions 10+ chars,
    // which meant a photo captioned with a real description ended up triggering the
    // full lunch/PD/supplies follow-up question meant for actual logged hours.)
    let anyPhotoSaved = false
    if (photoContext) {
      const jobId = await lookupJobId(supabase, photoContext)
      const saved = await Promise.all(
        mediaUrls.map(url => savePhotoToStorage(supabase, url, employeeId, fromPhone, today, photoContext, jobId))
      )
      anyPhotoSaved = saved.some(r => r !== null)
    }

    const firstName = (employeeName || '').split(' ')[0] || ''
    const reply = anyPhotoSaved
      ? `Got the photo${firstName ? ' ' + firstName : ''} — logged to ${photoContext}.`
      : `Couldn't save that photo${firstName ? ' ' + firstName : ''} — try texting it again, or contact Nicki if it keeps failing.`
    return isTwilio ? twiML(reply) : jsonReply({ reply })
  }

  // ── Jobs list request (before the Claude parse — deterministic keyword) ──
  const isJobsRequest = msgLower === 'jobs' || msgLower.startsWith('jobs ')
  if (isJobsRequest) {
    // Extract vessel name filter if present (e.g., "jobs wave master")
    const vesselFilter = msgLower === 'jobs' ? null : msgLower.slice(5).trim()

    // vessel name lives on the vessels table — join it (inner join when filtering so
    // non-matching and no-vessel jobs drop out)
    let query = supabase
      .from('jobs')
      .select(vesselFilter ? 'job_number, description, vessels!inner(name)' : 'job_number, description, vessels(name)')
      .eq('status', 'open')

    if (vesselFilter) {
      query = query.ilike('vessels.name', `%${vesselFilter}%`)
    }

    const { data: openJobs } = await query.order('job_number')

    if (openJobs && openJobs.length > 0) {
      let r: string
      if (vesselFilter) {
        // JOBS <boat>: one job per line with its description
        const boatName = openJobs[0]?.vessels?.name || vesselFilter
        const detail = openJobs
          .map((j: any) => {
            const d = j.description ? j.description.replace(/\s+/g, ' ').trim() : ''
            return `${j.job_number}${d ? ' — ' + d : ''}`
          })
          .join('\n')
        r = `${boatName} jobs:\n${detail}`
      } else {
        // bare JOBS: numbers grouped by boat, one line each, Shop last
        const groups: Record<string, string[]> = {}
        for (const j of openJobs as any[]) {
          const v = j.vessels?.name || 'Shop'
          ;(groups[v] ||= []).push(j.job_number)
        }
        const names = Object.keys(groups).filter((n) => n !== 'Shop').sort((a, b) => a.localeCompare(b))
        if (groups['Shop']) names.push('Shop')
        const lines = names.map((n) => `${n}: ${groups[n].join(', ')}`).join('\n')
        r = `Open jobs by boat:\n\n${lines}\n\nText JOBS + boat for details.`
      }
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    } else {
      const r = vesselFilter ? `No open jobs found for ${vesselFilter}.` : 'No open jobs right now.'
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }
  }

  // ── Reply to a pending manual-entry confirmation ──
  // Deterministic check before Claude parsing so a plain "yes" never gets
  // fed to the parser. Skipped if there's an active collecting/submitted
  // conversation so we don't hijack a normal in-progress submission.
  if (fromPhone) {
    const { data: byPhone } = await supabase.from('employees').select('id, name, phone, whatsapp_phone')
    const phoneMatch = (byPhone || []).find((e: any) =>
      (e.phone && normalizePhone(e.phone) === fromPhone) || (e.whatsapp_phone && normalizePhone(e.whatsapp_phone) === fromPhone))

    if (phoneMatch) {
      const { data: activeConvo } = await supabase
        .from('sms_submissions').select('id')
        .eq('from_phone', fromPhone).in('status', ['collecting', 'submitted']).limit(1)

      if (!activeConvo || activeConvo.length === 0) {
        const { data: pendingConfirm } = await supabase
          .from('timesheet_entries').select('id')
          .eq('employee_id', phoneMatch.id).eq('confirmation_status', 'pending')

        if (pendingConfirm && pendingConfirm.length > 0) {
          await supabase
            .from('timesheet_entries')
            .update({ confirmation_status: 'confirmed', confirmed_at: new Date().toISOString(), confirmation_reply_text: msgBody })
            .eq('employee_id', phoneMatch.id).eq('confirmation_status', 'pending')

          const r = 'Thanks, got it — logged as confirmed.'
          return isTwilio ? twiML(r) : jsonReply({ reply: r })
        }
      }
    }
  }

  // ── Parse with Claude ──
  let parsed: any = {
    entries: [], supplies: [], name_override: null, work_date: null,
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

  // ── Employee name override ──
  // employeeId/employeeName were already resolved by phone further up (see above, needed
  // early for gear-photo attribution). An explicit "This is X" always wins over that phone
  // guess — tracked separately since a guess must not clobber an existing conversation's
  // already-established identity (see mergedEmployeeId), but an explicit override should.
  let employeeIdFromNameOverride = false
  if (parsed.name_override) {
    const { data: byName } = await supabase
      .from('employees')
      .select('id, name')
      .ilike('name', `%${parsed.name_override}%`)
      .eq('active', true)
      .eq('role', 'technician')
      .limit(1)
    if (byName?.length) { employeeId = byName[0].id; employeeName = byName[0].name; employeeIdFromNameOverride = true }
  }

  // ── Work date ──
  const workDate = parsed.work_date || today

  // ── Find existing submission ──
  // A 'collecting' conversation is a question still awaiting this exact reply — there's only
  // ever one truly in-progress per phone, so match on phone alone, not work_date, for the
  // phone-based lookup specifically. A follow-up reply ("no supplies", "no pd") often doesn't
  // repeat whatever date the original report was for, so requiring work_date to match today
  // would miss a backdated report's open question entirely and start a brand new (wrongly-
  // attributed) submission instead.
  //
  // The employee-id fallback (different phone, same person — e.g. borrowed someone else's
  // phone) stays scoped to work_date: without that, two genuinely unrelated conversations that
  // happen to share the same "This is X" name on different days/phones would incorrectly merge.
  let submission: any = null
  {
    const { data: byPhone } = await supabase
      .from('sms_submissions').select('*')
      .eq('from_phone', fromPhone).eq('status', 'collecting')
      .order('created_at', { ascending: false }).limit(1)
    if (byPhone?.length) submission = byPhone[0]
    else if (employeeId) {
      const { data: byEmp } = await supabase
        .from('sms_submissions').select('*')
        .eq('employee_id', employeeId).eq('work_date', workDate).eq('status', 'collecting')
        .order('created_at', { ascending: false }).limit(1)
      if (byEmp?.length) submission = byEmp[0]
    }
  }

  // A 'submitted' conversation (correction/reopen flow) does need to match the specific day —
  // "actually I finished at 6" should correct that day's record, not some other day's.
  if (!submission) {
    const { data: byPhone } = await supabase
      .from('sms_submissions').select('*')
      .eq('from_phone', fromPhone).eq('work_date', workDate).eq('status', 'submitted')
      .order('created_at', { ascending: false }).limit(1)
    if (byPhone?.length) submission = byPhone[0]
    else if (employeeId) {
      const { data: byEmp } = await supabase
        .from('sms_submissions').select('*')
        .eq('employee_id', employeeId).eq('work_date', workDate).eq('status', 'submitted')
        .order('created_at', { ascending: false }).limit(1)
      if (byEmp?.length) submission = byEmp[0]
    }
  }

  // Whether this is a follow-up reply to our question
  const isFollowUp = !!(submission && (submission.pending_questions || []).length > 0)
  // Whether we re-opened a previously submitted record (correction flow)
  const isCorrection = !!(submission && submission.status === 'submitted' && !isFollowUp)

  // For follow-ups, Claude sees a one-word reply with no context about what was asked.
  // If the pending question was about per diem / lunch and the reply is a simple negative,
  // override Claude's null so we don't keep re-asking.
  if (isFollowUp) {
    const pendQ = (submission?.pending_questions || []).join(' ').toLowerCase()
    const isNegative = /^(no|nope|nah|none|n\/a|not tonight|going home|in the shop|at the shop|local|worked in the shop)$/i.test(msgBody.trim())
    if (pendQ.includes('per diem') && parsed.per_diem_location == null && isNegative) {
      parsed.per_diem_location = 'none'
    }
    if (pendQ.includes('lunch') && parsed.lunch_minutes == null && isNegative) {
      parsed.lunch_minutes = 0
    }
  }

  // ── Merge fields ──
  // Corrections override existing values; follow-ups and new entries preserve them.
  const prevEntries: any[] = submission?.entries || []
  let allEntries: any[] = isCorrection && parsed.entries?.length
    ? [...prevEntries, ...(parsed.entries || [])]
    : [...prevEntries, ...(parsed.entries || [])]

  // Supplies accumulate across texts the same way entries do. If no job number was
  // given with a supply, attribute it to the first job we know about for the day.
  const prevSupplies: any[] = submission?.supplies || []
  const fallbackJob = allEntries[0]?.job_number || ''
  const newSupplies = (parsed.supplies || [])
    .filter((s: any) => s.supply_name && String(s.supply_name).trim())
    .map((s: any) => ({
      job_number:  s.job_number || fallbackJob,
      supply_name: String(s.supply_name).trim(),
      quantity:    Number(s.quantity) > 0 ? Number(s.quantity) : 1,
    }))
  const allSupplies = [...prevSupplies, ...newSupplies]

  const mergedTimeIn    = (isCorrection && parsed.time_in)            ? parsed.time_in
                        : submission?.time_in                          ? submission.time_in.substring(0, 5)
                        : parsed.time_in
  const mergedStatedOut = (isCorrection && parsed.stated_time_out)    ? parsed.stated_time_out
                        : submission?.stated_time_out                  ? submission.stated_time_out.substring(0, 5)
                        : parsed.stated_time_out
  const mergedLunch     = (isCorrection && parsed.lunch_minutes != null) ? parsed.lunch_minutes
                        : (submission?.lunch_minutes != null)           ? submission.lunch_minutes
                        : parsed.lunch_minutes
  const mergedPerDiem   = (isCorrection && parsed.per_diem_location != null) ? parsed.per_diem_location
                        : (submission?.per_diem_location != null)       ? submission.per_diem_location
                        : parsed.per_diem_location
  // An explicit "This is X" this turn always wins (it's a deliberate statement, possibly a
  // correction). Otherwise, prefer whichever employee the conversation already belongs to —
  // a follow-up reply like "no pd" has no name override, so without this the phone-fallback
  // lookup above would silently reattribute the whole submission to whoever's phone sent it,
  // even though "This is Andrew" already established it belongs to Andrew.
  const mergedEmployeeId = employeeIdFromNameOverride ? employeeId : (submission?.employee_id || employeeId || null)

  // employeeName must describe whoever mergedEmployeeId actually is. On a follow-up with no
  // name override, the phone-fallback lookup above may have set employeeName to the phone
  // owner (e.g. Jim) even though mergedEmployeeId correctly stayed Andrew's — re-resolve
  // whenever mergedEmployeeId isn't the identity this turn's own lookups landed on.
  if (mergedEmployeeId && mergedEmployeeId !== employeeId) {
    const { data: empRow } = await supabase.from('employees').select('name').eq('id', mergedEmployeeId).single()
    if (empRow) employeeName = empRow.name
  }

  // If any entry has no hours but we have start + end times, infer hours from the time bounds.
  // Common case: "worked on 4760 all day" — hours are null but times tell us how long.
  const nullHoursEntries = allEntries.filter((e: any) => !e.hours || Number(e.hours) === 0)
  if (nullHoursEntries.length > 0 && mergedTimeIn && mergedStatedOut) {
    const boundedHours = (timeToMins(mergedStatedOut) - timeToMins(mergedTimeIn) - (mergedLunch || 0)) / 60
    const knownHours   = allEntries.reduce((s: number, e: any) => { const h = Number(e.hours); return h > 0 ? s + h : s }, 0)
    const remaining    = Math.max(0, Math.round((boundedHours - knownHours) * 100) / 100)
    const each         = Math.round((remaining / nullHoursEntries.length) * 100) / 100
    allEntries = allEntries.map((e: any) =>
      (!e.hours || Number(e.hours) === 0) ? { ...e, hours: each } : e
    )
  }

  // Single job for the whole day + known shift bounds: the job's hours MUST equal the
  // bounded elapsed time. Claude sometimes fills entries[].hours from a bare time range on
  // the job itself ("4709 9 to 5" -> hours: 8, the raw span) despite being told not to —
  // recompute from the bounds rather than trust that number, since there's no ambiguity
  // to preserve when there's only one job.
  if (allEntries.length === 1 && mergedTimeIn && mergedStatedOut) {
    const boundedHours = Math.round(((timeToMins(mergedStatedOut) - timeToMins(mergedTimeIn) - (mergedLunch || 0)) / 60) * 100) / 100
    if (boundedHours > 0) allEntries = [{ ...allEntries[0], hours: boundedHours }]
  }

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
  const [{ data: otCfg }, { data: priorEntries }, { data: statRows }] = await Promise.all([
    supabase.from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single(),
    mergedEmployeeId
      ? supabase.from('timesheet_entries').select('hours').eq('employee_id', mergedEmployeeId).eq('work_date', workDate).eq('is_stat_pay', false)
      : Promise.resolve({ data: [] }),
    supabase.from('stat_holidays').select('holiday_date').eq('holiday_date', workDate),
  ])
  // Work on a stat holiday is all OT — the 8 reg hrs come from the auto stat-pay entry
  const isStatDay = (statRows || []).length > 0
  const dailyOTThreshold = isStatDay ? 0 : (otCfg ? Number(otCfg.value) : 8)
  const alreadyWorkedHours = (priorEntries || []).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
  const allEntriesWithOT = calcOTBreakdown(allEntries, dailyOTThreshold, alreadyWorkedHours)
  const totalOTHours = allEntriesWithOT.reduce((s: number, e: any) => s + (e.ot_hours || 0), 0)
  const totalTodayHours = alreadyWorkedHours + totalHours

  // ── Determine what's missing ──
  const missingEmployee = !mergedEmployeeId
  const missingEntries  = allEntries.length === 0
  const missingLunch    = mergedLunch == null
  const missingPerDiem  = mergedPerDiem == null

  // Ask about supplies the same way lunch/per diem are asked about — every time,
  // if none were mentioned in the original text.
  const missingSupplies = allSupplies.length === 0
  // "I used shop supplies, I took a picture of them" has no itemized name/qty to log, so it
  // otherwise looks identical to not having answered at all — but the tech DID answer, just
  // via the gear-photos flow instead of naming an item in text. Don't keep asking.
  const suppliesNotedViaPhoto = missingSupplies && /\b(pic|pics|picture|pictures|photo|photos)\b/i.test(msgBody)

  // Fields Nicki will need to fill in (shown in review screen)
  const flags: string[] = []
  if (!mergedTimeIn) flags.push('start time missing')

  // ── One-question logic ──
  // Max one exchange with the worker. On follow-up, submit regardless.
  let reply = ''
  let nextStatus = 'collecting'
  let pendingQuestions: string[] = []
  const firstName = (employeeName || '').split(' ')[0] || ''

  if (missingEmployee) {
    // Employee couldn't be identified (unknown phone or unmatched name).
    // Save immediately for Nicki instead of asking for follow-up.
    reply = `Got it. Nicki will match this to you and get it into the system.`
    nextStatus = 'submitted'
    flags.push('employee not identified — needs manual assignment')

  } else if (missingEntries && !isFollowUp) {
    reply = `Got it${firstName ? ' ' + firstName : ''}. Which job(s) did you work on?\n(e.g. "4760 6hrs port engine work")`
    pendingQuestions = ['Job entries?']

  } else if (missingEntries && isFollowUp) {
    reply = `Got it${firstName ? ' ' + firstName : ''} — Nicki will follow up on the job details.`
    nextStatus = 'submitted'
    flags.push('no job entries — needs manual entry')

  } else if (missingLunch || missingPerDiem || missingSupplies) {
    // Ask for missing fields. On the first ask we bundle both; on subsequent asks we only
    // re-ask fields that were the sole pending question last time (i.e. we already gave them
    // one full round dedicated to that field — now just submit).
    const prevPendingQuestions: string[] = submission?.pending_questions || []
    const pdWasAloneLastTime  = prevPendingQuestions.length === 1 && prevPendingQuestions[0].toLowerCase().includes('per diem')
    const lunchWasAloneLastTime = prevPendingQuestions.length === 1 && prevPendingQuestions[0].toLowerCase().includes('lunch')
    const suppliesWasAloneLastTime = prevPendingQuestions.length === 1 && prevPendingQuestions[0].toLowerCase().includes('supplies')
    const shouldAskPD       = missingPerDiem   && !pdWasAloneLastTime
    const shouldAskLunch    = missingLunch     && !lunchWasAloneLastTime
    const shouldAskSupplies = missingSupplies  && !suppliesWasAloneLastTime && !suppliesNotedViaPhoto

    if (shouldAskLunch || shouldAskPD || shouldAskSupplies) {
      const qs: string[] = []
      if (shouldAskLunch)    qs.push('lunch? ("lunch 30" or "no lunch")')
      if (shouldAskPD)       qs.push('per diem tonight? (location or "no PD")')
      if (shouldAskSupplies) qs.push('any shop supplies used? (e.g. "brake cleaner x1") or "none"')
      const entrySummary = allEntriesWithOT.map((e: any) => `${e.job_number} ${e.hours}hrs`).join(', ')
      reply = isFollowUp
        ? `Question: ${qs.join(' | ')}`
        : `Got it ${firstName} — ${entrySummary}\n\nQuestion: ${qs.join(' | ')}`
      pendingQuestions = qs
    } else {
      // Already asked those questions individually — accept what we have
      nextStatus = 'submitted'
      if (missingLunch)    flags.push('lunch unknown')
      if (missingPerDiem)  flags.push('per diem unknown')
      if (missingSupplies) flags.push(suppliesNotedViaPhoto ? 'supplies used — see gear photo, not itemized by text' : 'supplies unknown')
    }
  }

  if (!reply) nextStatus = 'submitted'

  if (nextStatus === 'submitted' && !reply) {
    const date     = friendlyDate(workDate)
    const inFmt    = mergedTimeIn ? friendlyTime(mergedTimeIn) : '?'
    const outFmt   = mergedStatedOut ? friendlyTime(mergedStatedOut) : (calcOut ? friendlyTime(calcOut) : '?')
    const lunchFmt = mergedLunch  ? `lunch ${mergedLunch}min`  : (mergedLunch === 0 ? 'no lunch' : '')
    const pdLine   = mergedPerDiem === 'none' ? 'No per diem'
                   : mergedPerDiem            ? `PD: ${mergedPerDiem}`
                   : ''
    const flagLine = flags.length ? `\n(Nicki will check: ${flags.join(', ')})` : ''

    // Per-job OT breakdown lines
    const entryLines = allEntriesWithOT
      .filter((e: any) => Number(e.hours) > 0)
      .map((e: any) => {
        if (e.ot_hours > 0) return `${e.job_number}: ${e.reg_hours}hrs reg + ${e.ot_hours}hrs OT`
        return `${e.job_number}: ${e.hours}hrs reg`
      }).join('\n')

    const totalOTToday  = Math.max(0, totalTodayHours - dailyOTThreshold)
    const totalLine = alreadyWorkedHours > 0
      ? `Today total: ${totalTodayHours}hrs (${Math.min(totalTodayHours, dailyOTThreshold)}reg + ${totalOTToday > 0 ? totalOTToday + 'OT' : '0OT'}) — ${alreadyWorkedHours}hrs already logged`
      : totalOTHours > 0
        ? `Total: ${totalHours}hrs (${(totalHours - totalOTHours).toFixed(2).replace(/\.?0+$/, '')}reg + ${totalOTHours}OT)`
        : `Total: ${totalHours}hrs reg`

    const supplyLine = allSupplies.length
      ? 'Supplies: ' + allSupplies.map((s: any) =>
          `${s.supply_name} x${s.quantity}${s.job_number ? ` (${s.job_number})` : ''}`).join(', ')
      : ''

    reply = [
      `Done ${firstName} ✓ ${date} | ${inFmt}–${outFmt}${lunchFmt ? ' | ' + lunchFmt : ''}`,
      entryLines,
      totalLine,
      supplyLine,
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
    supplies:           allSupplies,
    pending_questions:  pendingQuestions,
    raw_messages:       allMsgs,
    status:             nextStatus,
    updated_at:         new Date().toISOString(),
  }

  const { error: saveError } = submission
    ? await supabase.from('sms_submissions').update(record).eq('id', submission.id)
    : await supabase.from('sms_submissions').insert(record)

  if (saveError) {
    console.error('sms_submissions save failed:', saveError.message)
    const r = "Something went wrong saving that — text Nicki directly so it doesn't get lost."
    return isTwilio ? twiML(r) : jsonReply({ reply: r, error: saveError.message }, 500)
  }

  return isTwilio ? twiML(reply) : jsonReply({ reply, status: nextStatus, flags })
})
