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
• TEMPLATE — fill-in-the-blank text
• JOBS — job list
• PHONE# — phone directory
• PHOTO — gear photos
• TIMESHEET — what's logged for a day
• DAY OFF — mark today as off
• REJECT — delete today's entry
• NOTE — leave a note not tied to a job
• SUPPLIES — log parts used
• MOBILE — link to your mobile timesheet
• MAIN — link to the main site
• OTHER — using someone else's phone

Reply HELP + a word above for details (e.g. "HELP jobs").

💬 Use WhatsApp or SMS — works both ways.`

// The tech-facing mobile self-service site — check your week, fix a self-added
// entry, or add a job you forgot to mention. Kept as one constant since it's
// sent back verbatim by both the MOBILE command and HELP_TOPICS.mobile.
const MOBILE_URL = 'https://jimjardine.github.io/cores-timesheet/#/my'

// The main site (Job Reports / Admin dashboard) — password-gated, mostly
// office use, but the phone number is shared by techs and office staff alike
// so it gets a command too, same as MOBILE.
const MAIN_URL = 'https://jimjardine.github.io/cores-timesheet/'

// Sent back verbatim when a tech texts TEMPLATE — kept in sync with the
// "Copy-paste template" section of public/SMS_CHEAT_SHEET.md.
// Nothing here but what's meant to go back to the bot — a tech doing a
// select-all-and-copy on the reply shouldn't have to strip out instructions
// first. Usage guidance lives in HELP_TOPICS.template and the cheat sheet instead.
const TEMPLATE_TEXT = `In: [time]
Job [job#]: [hours]hrs - [task]
Job [job#]: [hours]hrs - [task]
Out: [time]
Lunch: [minutes]
PD: [y/n]
Supplies: [product + part #] x[qty]`

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

Text a photo any time. Caption with the job # or ship if you want ("4760") —
no caption and it's filed under the job you've been texting about today.
Anything else in the caption is saved as a note on the photo.`,

  photos: '', // alias, filled in below

  timesheet: `TIMESHEET — day summary

Text TIMESHEET (or TS) to see everything logged for today.
Add a day for another date: "TS yesterday", "TS monday".`,

  ts: '', // alias, filled in below

  template: '', // alias, filled in below

  dayoff: `DAY OFF — mark today as off

Text "day off" and today's marked as intentionally not worked — no hours,
no job, nothing for the office to review. Keeps it from showing up as a
missed report. Only covers today; text it again on another day you're off.`,

  reject: `REJECT — delete an entry

Totally botched a day's text? Reply REJECT and it wipes today's entry so
you can start over. Add a day for another date: "REJECT yesterday".
Only works before the office approves it — after that, they'll need to fix
or delete it on their end.`,

  note: `NOTE — leave a note not tied to a job

For anything the office should know that isn't work on a job:
"NOTE: took the truck home tonight"

Always attaches to today. Doesn't affect your hours or job entries.`,

  supplies: `SUPPLIES — log parts used

"SUPPLIES" or "PARTS" both work. Add them to your hours text, on their own, or one per line:
"supplies brake cleaner x1, wire brush PN4521 x2 Job 4358"
"parts 2 wire brushes"

Include the part number if there is one — it helps the office match the exact part.

No job number given? It's attributed to the first job in that text.`,

  other: `USING SOMEONE ELSE'S PHONE

Start your text with: "This is Joey" so the hours land on their timesheet, not yours.`,

  mobile: `MOBILE — check your week

Text MOBILE any time for the link to your mobile timesheet:
${MOBILE_URL}

Log in with your phone number. First time in, you'll set a 4-digit PIN after we text you a one-time code.`,

  main: `MAIN — the main site

Text MAIN any time for the link to the main site (Job Reports / Admin):
${MAIN_URL}

Password-gated — mostly for office use.`,
}
HELP_TOPICS.format = HELP_TOPICS.hours
HELP_TOPICS.photos = HELP_TOPICS.photo
HELP_TOPICS.ts = HELP_TOPICS.timesheet
HELP_TOPICS.app = HELP_TOPICS.mobile
HELP_TOPICS.parts = HELP_TOPICS.supplies
HELP_TOPICS.supply = HELP_TOPICS.supplies
HELP_TOPICS.template = `TEMPLATE — fill-in-the-blank text

Text TEMPLATE any time for a copy-paste starting point:

${TEMPLATE_TEXT}

Fill in the blanks, delete any lines you don't need, add more Job lines if you worked more than two, then send it back. Double-tap a [bracketed] word to select and replace it in one go.`

function helpReply(topicRaw: string | undefined): string {
  const topic = (topicRaw || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return (topic && HELP_TOPICS[topic]) || HELP_TEXT
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

// normalizePhone() always truncates to the last 10 digits, which would silently
// strip a real country code off an overseas number before outbound send could
// tell it was there. A stored number with exactly 10 digits has no country code
// on file, so +1 is the right default there; anything longer already carries a
// country code and should go out as-is. Mirrors employee-auth/index.ts's helper
// of the same name (each edge function is self-contained, no shared module).
function toWhatsAppE164(raw: string): string {
  const trimmed = (raw || '').trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  return digits.length === 10 ? `+1${digits}` : `+${digits}`
}

// Twilio's request-signing algorithm: sort POST params by key, append each
// key+value (no delimiter) directly onto the URL string, then HMAC-SHA1 with
// the Auth Token and base64-encode. See
// https://www.twilio.com/docs/usage/security#validating-requests
async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) data += key + params[key]
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

// Phase 1 (current): LOG ONLY — computes the expected signature against both a
// fixed canonical URL (the one registered in Twilio Console) and whatever req.url
// looks like from inside the edge function, and logs whether either matches the
// incoming X-Twilio-Signature header. Supabase's proxy can alter the URL Twilio
// actually signed against, so this never rejects a request yet — once real traffic
// confirms which URL variant matches consistently, promote that check to actually
// reject on mismatch (see todo #2).
async function logTwilioSignatureCheck(req: Request, params: Record<string, string>): Promise<void> {
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const header = req.headers.get('X-Twilio-Signature')
  if (!authToken || !header) {
    console.log(`[twilio-sig] skipped — authToken present: ${!!authToken}, header present: ${!!header}`)
    return
  }
  const canonicalUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sms-timesheet`
  const [sigCanonical, sigReqUrl] = await Promise.all([
    computeTwilioSignature(authToken, canonicalUrl, params),
    computeTwilioSignature(authToken, req.url, params),
  ])
  console.log(`[twilio-sig] header=${header} canonical=${sigCanonical} (match=${sigCanonical === header}) url=${canonicalUrl} | reqUrl=${sigReqUrl} (match=${sigReqUrl === header}) url=${req.url}`)
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
  jobId: string | null = null,
  note: string | null = null,
  photoType: string | null = null
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

    // Determine file extension from content-type — covers video/* now too
    // (gear-photos bucket accepts mp4/quicktime/webm/3gpp as of 2026-08-18),
    // not just the image types this used to assume everything was.
    const contentType = photoRes.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('gif') ? 'gif'
      : contentType.includes('webm') ? 'webm'
      : contentType.includes('quicktime') ? 'mov'
      : contentType.includes('3gpp') ? '3gp'
      : contentType.includes('mp4') ? 'mp4'
      : 'jpg'

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
      note: note,
      photo_type: photoType,
      // No longer a "we'll ask" marker — just flags the photo as untagged so it
      // shows under "Needs ship/job" in the Gear Photos tab for the office. Also
      // flags a job-number-shaped tag that didn't resolve (e.g. a typo'd job #)
      // — that used to silently save with job_id null and never surface anywhere
      // (see Aug 7 2026 incident: "4688" typo'd for "4866" vanished from reports).
      pending_context: !shipOrJob || (!jobId && /^(\d{4}|SHOP)$/i.test(shipOrJob.trim())),
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

// No <Message> verb — tells Twilio the webhook's handled without sending anything
// back. Used for a detected retry (see the MessageSid dedup check below): the
// original delivery already got a real reply, so replying again here would just
// double (or triple) text the tech with conflicting numbers.
function emptyTwiML(): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

function jsonReply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
}

// Sends via the WhatsApp Sandbox (not the SMS number) — both To and From need
// the whatsapp: prefix or Twilio delivers it as a plain SMS instead.
async function sendTwilioWhatsApp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return { ok: false, error: 'Twilio credentials not configured' }

  const from = 'whatsapp:+14155238886' // Twilio WhatsApp Sandbox shared number
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: `whatsapp:${to}`, From: from, Body: body }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `Twilio send failed (${res.status}): ${detail.slice(0, 200)}` }
  }
  return { ok: true }
}

// Sends via the main SMS line (not the WhatsApp Sandbox) — plain SMS, so
// neither To nor From gets the whatsapp: prefix.
async function sendTwilioSMS(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return { ok: false, error: 'Twilio credentials not configured' }

  const from = '+15064046969' // main Cores Timesheets SMS line
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

// bluelightgin.com is a verified Resend sending domain (as of 2026-08-11) —
// the shared onboarding@resend.dev sender only ever delivers to the Resend
// account's own address, so alerts to anyone else (e.g. Tracy) silently
// never arrived. https://resend.com/docs/api-reference/emails/send-email
async function sendResendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Cores Timesheets <alerts@bluelightgin.com>',
      to: [to],
      subject,
      text,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `Resend send failed (${res.status}): ${detail.slice(0, 200)}` }
  }
  return { ok: true }
}

// ── Low-stock alerts ──────────────────────────────────────────────────────
// Fire-and-forget notification, not persisted anywhere — the office acts on
// the text itself rather than a tracked list. Called for both the Claude-
// parsed text path and the deterministic photo-caption path. Recipients are
// controlled entirely from the admin panel (Employees > Low-Stock Alert
// Recipients), not hardcoded — an active employee with an email and
// low_stock_alert_recipient=true gets every alert. Testing safely just means
// making sure only your own record is flagged there.
// "Test Tech" — the disposable fixture scripts/test-sms.mjs uses (phone 9990000099).
// A test run reporting "last can of brake cleaner" must never page a real employee —
// this fired for real on 2026-08-26 (several full-suite runs each sent a genuine
// low-stock email to everyone with the alert flag on, Tracy included) because nothing
// distinguished a test-fixture report from a real one before sending.
const TEST_TECH_ID = 'e3044c0c-9628-46e0-9837-2526240b63c3'

async function sendLowStockAlert(supabase: any, item: string, jobRef: string | null, reporterFirstName: string, photoUrl: string | null, reporterEmployeeId: string | null = null): Promise<void> {
  if (reporterEmployeeId === TEST_TECH_ID) {
    console.log(`Low-stock alert suppressed — reported by Test Tech fixture (${item})`)
    return
  }
  const jobPart = jobRef ? ` (Job ${jobRef})` : ''
  const reporter = reporterFirstName || 'a tech'
  const photoPart = photoUrl ? `\n${photoUrl}` : ''
  const msg = `🔴 Low stock: ${item}${jobPart} — reported by ${reporter}.${photoPart}`

  // Best-effort — a send hiccup here must never break timesheet processing.
  try {
    const { data: recipients } = await supabase
      .from('employees')
      .select('email')
      .eq('low_stock_alert_recipient', true)
      .eq('active', true)
      .not('email', 'is', null)

    const emails: string[] = (recipients || []).map((r: any) => r.email).filter(Boolean)
    if (emails.length === 0) {
      console.error('Low-stock alert: no recipients configured (Admin > Employees > Low-Stock Alert Recipients)')
      return
    }

    const results = await Promise.all(emails.map(email => sendResendEmail(email, `Low stock: ${item}`, msg)))
    results.forEach((r, i) => { if (!r.ok) console.error(`Low-stock email to ${emails[i]} failed:`, r.error) })
  } catch (err: any) {
    console.error('Low-stock alert send failed:', err.message)
  }
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

// The day's "current job": the job this tech mentioned most recently, used to
// attach job-less texts ("fixed the head") and uncaptioned photos to the right
// work without asking. Primary source: the day's submission entries (greatest
// last_mentioned_at stamp; legacy rows without stamps fall back to array order).
// Fallback: the newest job-tagged gear photo — a photo captioned "4900" that
// morning establishes the day's job before any hours text arrives.
async function getLastJobForDay(supabase: any, fromPhone: string, workDate: string, submission: any = null, employeeId: string | null = null): Promise<string> {
  // Some techs (e.g. Greg) move between jobs often enough that "assume he's
  // still on the last one" guesses wrong more than it guesses right — for
  // them, no job stated means no job inferred at all, same/cross-day alike,
  // so the day saves against the real "Unknown" job (job_number "Unknown",
  // "This is for work that there is no job# yet" — an actual row in jobs,
  // not a placeholder string) for the office to reassign, instead of a
  // silent wrong guess.
  if (employeeId) {
    const { data: emp } = await supabase
      .from('employees').select('job_inference_exempt').eq('id', employeeId).single()
    if (emp?.job_inference_exempt) return 'Unknown'
  }
  let sub = submission
  if (!sub) {
    const { data } = await supabase
      .from('sms_submissions').select('entries, employee_id')
      .eq('from_phone', fromPhone).eq('work_date', workDate)
      .in('status', ['collecting', 'submitted'])
      .order('updated_at', { ascending: false }).limit(1)
    // Same guard as the caller's own submission lookup — a phone-matched row
    // only tells us about THIS employee's last job if it's actually theirs.
    // Without this, "for X" on a phone that already has its own open/recent
    // conversation would carry the phone owner's job onto X's job-less report
    // (see the 2026-08-21 incident this whole guard exists for).
    if (data?.length && (!employeeId || !data[0].employee_id || data[0].employee_id === employeeId)) {
      sub = data[0]
    }
  }
  const entries: any[] = (sub?.entries || []).filter((e: any) => e.job_number)
  if (entries.length > 0) {
    const stamped = entries.filter((e: any) => e.last_mentioned_at)
    if (stamped.length > 0) {
      stamped.sort((a: any, b: any) => String(a.last_mentioned_at).localeCompare(String(b.last_mentioned_at)))
      return stamped[stamped.length - 1].job_number
    }
    return entries[entries.length - 1].job_number
  }
  // Same phone-vs-employee guard as above — a photo this phone sent for
  // itself shouldn't hand its job to a "for X" report on the same phone.
  const { data: photos } = await supabase
    .from('gear_photos').select('ship_or_job, employee_id')
    .eq('from_phone', fromPhone).eq('work_date', workDate)
    .not('ship_or_job', 'is', null)
    .order('created_at', { ascending: false }).limit(5)
  const ownPhotos = (photos || []).filter((p: any) => !employeeId || !p.employee_id || p.employee_id === employeeId)
  const tagged = ownPhotos.find((p: any) => /^(\d{4}|SHOP)$/i.test((p.ship_or_job || '').trim()))
  if (tagged) return tagged.ship_or_job.trim()

  // Nothing logged today yet — techs usually stay on one job for days at a stretch,
  // so fall back to whatever job this employee last reported on a prior day rather
  // than asking. Most recent submission wins regardless of review status: even an
  // unapproved or later-rejected text still tells us what job they were on.
  if (employeeId) {
    const { data: recent } = await supabase
      .from('sms_submissions').select('entries')
      .eq('employee_id', employeeId).lt('work_date', workDate)
      .order('work_date', { ascending: false }).limit(5)
    for (const row of recent || []) {
      const withJob = (row.entries || []).filter((e: any) => e.job_number)
      if (withJob.length > 0) return withJob[withJob.length - 1].job_number
    }
  }
  // Genuinely nothing to go on (first-ever text, no job history at all,
  // nothing today) — same real "Unknown" job as the exemption case above,
  // rather than leaving job_number null. Null entries don't show up in any
  // job-scoped view (Reports, Job Reports, billing) at all; "Unknown" does,
  // which is the whole reason that job exists.
  return 'Unknown'
}

// Accumulate a day's texts into ONE entry per job: hours add (or replace, when
// the parser marked the mention as a correction), descriptions join with "; ".
// New entries with no job number inherit lastJob; if there's no job to inherit,
// they're kept with job_number null and folded into the day's job as soon as
// one is named (the "Which job?" answer, or a later text that names one).
// Every entry touched this message gets a last_mentioned_at stamp — the source
// of truth for getLastJobForDay. The parser-only replace_hours key never makes
// it into the result (entries are rebuilt field-by-field).
function mergeEntries(prevEntries: any[], newEntries: any[], lastJob: string | null, now: string): any[] {
  const merged: any[] = prevEntries.map((e: any) => ({ ...e }))

  const foldInto = (target: any, hours: number | null, desc: string, replaceHours: boolean) => {
    if (hours != null) {
      target.hours = replaceHours || !(Number(target.hours) > 0)
        ? hours
        : Math.round((Number(target.hours) + hours) * 100) / 100
    }
    const existingDesc = String(target.description || '').trim()
    if (desc && !existingDesc.toLowerCase().includes(desc.toLowerCase())) {
      target.description = existingDesc ? `${existingDesc}; ${desc}` : desc
    }
    target.last_mentioned_at = now
  }

  for (const raw of newEntries) {
    // A job-number correction renames the existing entry rather than adding a
    // second one under the new number — "actually that was 4760, not 9999".
    const correctsFrom = String(raw.corrects_job_number || '').trim()
    if (correctsFrom) {
      const oldEntry = merged.find((e: any) => String(e.job_number || '').toLowerCase() === correctsFrom.toLowerCase())
      if (oldEntry) {
        const newJobNum = String(raw.job_number || '').trim()
        const hours = Number(raw.hours) > 0 ? Number(raw.hours) : null
        const desc = String(raw.description || '').replace(/\s+/g, ' ').trim()
        // A real entry may already exist under the corrected number (e.g. the tech
        // separately texted 4760 earlier) — fold the mistyped one into it rather
        // than leaving two rows for what's really one job.
        const target = newJobNum
          ? merged.find((e: any) => e !== oldEntry && String(e.job_number || '').toLowerCase() === newJobNum.toLowerCase())
          : null
        if (target) {
          foldInto(target, Number(oldEntry.hours) > 0 ? Number(oldEntry.hours) : null, String(oldEntry.description || '').trim(), false)
          merged.splice(merged.indexOf(oldEntry), 1)
          foldInto(target, hours, desc, !!raw.replace_hours)
        } else {
          if (newJobNum) oldEntry.job_number = newJobNum
          foldInto(oldEntry, hours, desc, !!raw.replace_hours)
        }
        continue
      }
      // The "old" number wasn't found (e.g. from a prior day) — fall through so
      // the new job number still gets recorded instead of silently dropped.
    }

    const jobNum = (raw.job_number || '').trim() || lastJob
    const hours = Number(raw.hours) > 0 ? Number(raw.hours) : null
    const desc = String(raw.description || '').replace(/\s+/g, ' ').trim()
    const existing = jobNum
      ? merged.find((e: any) => String(e.job_number || '').toLowerCase() === String(jobNum).toLowerCase())
      : null
    if (existing) {
      foldInto(existing, hours, desc, !!raw.replace_hours)
    } else {
      merged.push({ job_number: jobNum || null, hours, description: desc, last_mentioned_at: now })
    }
  }

  // ── Safety net: collapse any duplicate job numbers into one entry ──
  // A job number can land on an entry several ways (direct match, a correction,
  // an occasional LLM parsing quirk) — however it happens, two rows for the same
  // job is never correct. Always combine down to one before doing anything else.
  const byJob = new Map<string, any>()
  const deduped: any[] = []
  for (const e of merged) {
    const key = e.job_number ? String(e.job_number).toLowerCase() : null
    const prior = key ? byJob.get(key) : null
    if (prior) {
      foldInto(prior, Number(e.hours) > 0 ? Number(e.hours) : null, String(e.description || '').trim(), false)
      if (String(e.last_mentioned_at || '') > String(prior.last_mentioned_at || '')) prior.last_mentioned_at = e.last_mentioned_at
    } else {
      deduped.push(e)
      if (key) byJob.set(key, e)
    }
  }

  // Fold still-unattributed work into the most recently mentioned job, if any —
  // this is what turns yesterday's stored "fixed the head" plus today's "4900"
  // answer into a single 4900 entry.
  const withJob = deduped.filter((e: any) => e.job_number)
  if (withJob.length > 0) {
    const anchor = [...withJob].sort((a: any, b: any) =>
      String(a.last_mentioned_at || '').localeCompare(String(b.last_mentioned_at || '')))[withJob.length - 1]
    for (const orphan of deduped.filter((e: any) => !e.job_number)) {
      foldInto(anchor, Number(orphan.hours) > 0 ? Number(orphan.hours) : null, String(orphan.description || '').trim(), false)
    }
    return withJob
  }

  return deduped
}

// Short ack + running day total — the reply for every accepted text now that the
// bot never asks questions: "Got it Jim — 4900: 4hrs — pump; fixed the head".
// Only confirms what THIS message touched, not the whole day — the tech already
// knows what they've already sent; "TS" is there if they want the full picture.
function daySummaryReply(
  firstName: string, touchedEntries: any[], totalHours: number, totalOTHours: number,
  timeIn: string | null, flags: string[], unknownJobs: string[] = [], dayJobCount: number = touchedEntries.length,
  deltaMinutes: number | null = null
): string {
  const jobLines = touchedEntries.map((e: any) => {
    const desc = String(e.description || '').replace(/\s+/g, ' ').trim()
    const descFmt = desc ? ` — ${desc.length > 60 ? desc.slice(0, 57) + '…' : desc}` : ''
    const ot = Number(e.ot_hours) || 0
    const hrs = !(Number(e.hours) > 0) ? 'hrs TBD'
      : ot > 0 ? `${e.reg_hours}hrs reg, ${ot}hrs OT` : `${e.hours}hrs`
    return `Job# ${e.job_number || '?'}: ${hrs}${descFmt}`
  })
  const greeting = `Got it${firstName ? ' ' + firstName : ''}`
  const totalRegHours = Math.round((totalHours - totalOTHours) * 100) / 100
  const totalLine = totalHours > 0 && (dayJobCount > 1 || totalOTHours > 0)
    ? `Total ${totalOTHours > 0 ? `${totalRegHours}hrs reg, ${totalOTHours}hrs OT` : `${totalHours}hrs`}`
    : ''
  const flagLine = flags.length ? `(the office will check: ${flags.join(', ')})` : ''
  const unknownJobLine = unknownJobs.length
    ? `Didn't recognize Job# ${unknownJobs.join(', ')} — text JOBS for the list, or the office will check.`
    : ''
  // Your in/out span (minus lunch) vs. the sum of job hours — a mismatch usually
  // means a job's hours or a time got missed. Same >15min threshold the office
  // review screen already flags on, just surfaced here instead of staying silent.
  const deltaLine = deltaMinutes != null && Math.abs(deltaMinutes) > 15
    ? `Heads up — your times and job hours are off by ${Math.abs(deltaMinutes)}min. Text a fix, or the office will check.`
    : ''
  // Only worth the extra line when this reply has nothing of its own to show —
  // once it already lists real job entries, repeating "text TS" on every single
  // message throughout the day is just noise on top of info the tech already has.
  const tsHintLine = jobLines.length === 0 && dayJobCount > jobLines.length ? `Text TS to see the day's progress.` : ''

  if (jobLines.length === 0) {
    return [`${greeting}.`, totalLine, unknownJobLine, deltaLine, flagLine, tsHintLine].filter(Boolean).join('\n')
  }
  return [greeting, jobLines.join('\n\n'), totalLine, unknownJobLine, deltaLine, flagLine, tsHintLine].filter(Boolean).join('\n')
}

// "timesheet"/"ts" day argument → YYYY-MM-DD. Empty/today → today; "yesterday" →
// one back; a weekday name/abbreviation → the most recent occurrence (today counts).
// Unrecognized → null (caller replies with a usage hint).
function resolveDayArg(argRaw: string, today: string): string | null {
  const arg = (argRaw || '').trim().toLowerCase()
  if (!arg || arg === 'today') return today
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  if (arg === 'yesterday') {
    base.setUTCDate(base.getUTCDate() - 1)
    return base.toISOString().split('T')[0]
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const idx = days.findIndex((dn) => dn === arg || dn.slice(0, 3) === arg)
  if (idx >= 0) {
    const delta = (base.getUTCDay() - idx + 7) % 7
    base.setUTCDate(base.getUTCDate() - delta)
    return base.toISOString().split('T')[0]
  }
  return null
}

// ── Claude parser ─────────────────────────────────────────────────────────────

async function parseWithClaude(msgBody: string, today: string, askedQuestions: string[] = []): Promise<any> {
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
  "low_stock": [],
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
- entries: [{job_number:"4-digit string or SHOP"|null, hours:number|null, description:"verbatim from message", replace_hours:boolean, corrects_job_number:"4-digit string"|null}] — only real job work. corrects_job_number: set this ONLY when the message says a job number already reported today was WRONG and gives the correct one ("actually that was 4760, not 9999", "wrong job, it's 4762 not 4761", "change 9999 to 4760", "meant 4760 not 9999") — corrects_job_number is the OLD/wrong number being replaced, job_number is the NEW/correct number. Leave hours and description null unless the message also restates new work/hours alongside the correction. Otherwise always null. If the message clearly describes work done but names NO job ("fixed the head this afternoon", "another 2 hours on the pump"), still return the entry with job_number null — the app attaches it to the day's current job. If the message names a job number but gives no work description and no hours ("job 4949", "end time 3:30 job 4949", "4760" on its own), still return an entry for that job_number with hours and description null — never drop a job-number mention just because nothing else came with it; the office fills in the rest. Only a message with NEITHER a job number NOR a work description — just times/lunch/PD, like "In 7:30" or "no lunch, no PD" — returns entries: []. replace_hours: true when the message restates the TOTAL/FINAL hours for a job already reported today, rather than describing more work done — this includes "actually that was 3hrs", "make that 6", "not 2, 3 hours", "I only worked 7hrs on 4760", "only 2hrs for 4862", "it was really 5", "should only be 4", "total was 6". The word "only" or a flat restated number tied to a specific job almost always means a correction, not new work. replace_hours: false ONLY for messages that clearly describe additional new work on top of what's already logged ("another 2 hrs", "plus 2 more on it", "did 2 more hours this afternoon"). Internal shop work with no customer job ("shop", "job shop", "shop work", "in the shop doing X") gets job_number "SHOP" (always uppercase). hours: the number ONLY if the worker explicitly stated hours for that specific job as a duration ("4760 6hrs", "3.5 hours on 4862") — otherwise null. A time range attached to a job ("4709 9 to 5", "4760 from 8 to 4") is NOT explicit hours — leave hours null even though it looks computable; do not subtract or compute anything yourself. Never estimate, guess, or split a shift total across jobs yourself, even if you know time_in/stated_time_out — the app does that math from the overall time bounds and lunch after parsing.
- supplies: [{job_number:"4-digit string", supply_name:string, quantity:number}] — materials/consumables used on a job. Trigger words are "supplies", "parts", or "supply" (any of these, plus obvious misspellings like "supplys"/"suplies"/"parts used" — this is a text message, expect typos), either as its own line/message or as a lead-in word before a list of items: "supplies brake cleaner x1, wire brushes x2 Job 4358", "parts 2 wire brushes", "PARTS: brake cleaner x1", or mixed in with hours ("4760 6hrs bearings, used 2 cans brake cleaner"). One item per line works exactly the same as several comma-separated on one line — parse every line that starts with a trigger word, and every comma-separated item after it, the same way. Quantity comes ONLY from an explicit count word/pattern at the item's edge — "x2", "2 cans", "two rolls", a bare leading count ("2 wire brushes") — default 1 if no count is given. supply_name is the item's full name MINUS only that count — keep everything else, including any part/model/catalog number, brand, spec, or color ("wire brush PN 4521", "3M 5200 sealant", "#44 red", "1/2 inch hose", "wire brushes 43622") verbatim, even if it's a number, EVEN IF it happens to look like a job number. A trailing/leading alphanumeric code stuck directly onto the item is a part number, not a quantity and not a job number — never drop it, never move it into job_number, and never truncate/reshape it to fit any format. E.g. "wire brush PN4521 x2" → supply_name "wire brush PN4521", quantity 2. "2 wire brushes" → supply_name "wire brushes", quantity 2. "2 Wire brushes 43622" → supply_name "wire brushes 43622", quantity 2, job_number "" (the trailing number isn't labeled as a job, so it stays part of the item — never invent or reshape a job_number from it). job_number is set ONLY when the message explicitly marks a number as the job — "Job 4358", "for 4760", "on job 4862" — a bare number with no such marker is part of the item name, full stop. If no job number is given with the supplies, use the job from the same message; empty string if no job mentioned at all (the app then falls back to whatever job the day's already on). Supplies are NOT job work — never create an entries item from a supplies phrase. The reverse also holds: a job's work description is not a supply. "4760 2hrs seals" or "6hrs bearings" describes the work done — extract supplies ONLY when the text presents them as materials used/consumed ("used 2 cans of brake cleaner", "supplies: wire brush x2", "grabbed a roll of tape"), never from a bare work description.
- low_stock: [{item:string, job_number:"4-digit string"|null}] — set ONLY when the message signals an item is nearly or fully depleted: "last one/can/box/roll/tube/bottle/pair/bag", "running low", "almost out", "getting low", "down to the last one", "need to order more X". This is independent of whether the same item also appears in supplies (used X — supplies can be reported without being low, and a low item might not be phrased as "used" at all — e.g. "heads up, brake cleaner is down to one can" gets low_stock even though nothing was consumed just now). item is the item name, same style as supply_name (keep part/catalog numbers attached, strip only an explicit count). job_number only if explicitly marked as job for that message ("Job 4358") — otherwise null, never guessed.
- is_help_request: true only if the entire message is a help request

Job numbers are 4-digit numbers. Hours can be decimal (6.5, 4.25). Quantities can be decimal (0.5).${askedQuestions.includes('Lunch?') ? `

CONTEXT: Earlier in this conversation we asked the worker if they took a lunch. If this message reads as a direct answer to that — a bare number of minutes ("30", "45 min"), "half hour"/"1/2 hour" (→30), or "none"/"no"/"worked through"/"nope" (→0) — set lunch_minutes accordingly even without the word "lunch" anywhere in the message. Never invent data the message does not contain.` : ''}${askedQuestions.includes('Consumables?') ? `

CONTEXT: Earlier in this conversation we asked the worker what consumables/supplies they used today. If this message reads as a direct answer to that, treat any items listed as supplies (job_number empty string unless a job is explicitly named in this reply) even without "used"/"supplies:" phrasing — e.g. "2 rags, roll of tape" counts as supplies, not job work. If they say there weren't any ("none", "nothing", "no", "nope"), return supplies: [] and don't invent anything.` : ''}`

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
  if (!jsonMatch) throw new Error(`No JSON in Claude response (${res.status}): ${text || JSON.stringify(data)}`)
  return JSON.parse(jsonMatch[0])
}

// Condenses a job's raw timesheet-entry descriptions (which repeat themselves
// constantly — "clean liners" logged by three different people across three
// days) into a deduplicated bullet list for the Job Reports "What Was Done"
// summary. Dates are given to Claude for its own ordering/context only — the
// instruction is explicit that the OUTPUT must not include dates or names,
// since the report already shows those separately.
async function summarizeJobWork(descriptions: { date: string; text: string }[]): Promise<string> {
  const system = `You summarize marine engineering shop work logs for an internal job report.

You'll be given a list of dated, raw text entries — informal notes texted in by different crew members about work done on one job, in chronological order. Multiple entries often describe the same ongoing task (e.g. "clean liners" logged three separate times as different people worked on it).

Write one or two short paragraphs of flowing prose describing the work performed on this job, in the voice of a professional technician writing a job report — factual, technical, matter-of-fact, no fluff or marketing language. Merge duplicate/overlapping entries so each distinct task is described once, in the rough order the work progressed. Do NOT include dates, times, or who did the work — just what was done, written as continuous prose (not a bullet list, not a numbered list). Do not add commentary, headers, or a preamble — return only the paragraph(s) themselves.`

  const userContent = descriptions.map(d => `[${d.date}] ${d.text}`).join('\n')

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userContent }]
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
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Claude summarize failed (${res.status}): ${detail.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()
  if (!text) throw new Error('Empty response from Claude')
  return text
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
  let messageSid = ''
  const isTwilio = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')

  try {
    if (isTwilio) {
      const form = await req.formData()
      const formParams: Record<string, string> = {}
      for (const [k, v] of form.entries()) formParams[k] = String(v)
      // Log-only for now — see logTwilioSignatureCheck's comment for the enforcement plan.
      await logTwilioSignatureCheck(req, formParams)

      fromPhone = normalizePhone(form.get('From') as string || '')
      msgBody = (form.get('Body') as string || '').trim()
      // Twilio's own id for this exact delivery attempt — SmsMessageSid is the
      // older field name for the same value, kept as a fallback for whichever
      // webhook format sends which. Used below to detect a retried delivery.
      messageSid = (form.get('MessageSid') as string || form.get('SmsMessageSid') as string || '')
      // Collect media URLs from MMS (MediaUrl0, MediaUrl1, etc)
      const numMedia = Number(form.get('NumMedia') || 0)
      for (let i = 0; i < numMedia; i++) {
        const url = form.get(`MediaUrl${i}`)
        if (url) mediaUrls.push(url as string)
      }
    } else {
      const json = await req.json()

      // App-triggered action (not a Twilio webhook) — a pg_cron job pings this
      // every ~72h to keep the WhatsApp Sandbox session from expiring while
      // Jim's real WhatsApp sender is still pending. Shared-secret gated since
      // this function runs with verify_jwt disabled (required for Twilio).
      if (json.action === 'whatsapp_keepalive') {
        const expected = Deno.env.get('WHATSAPP_KEEPALIVE_SECRET')
        if (!expected || json.secret !== expected) {
          return jsonReply({ ok: false, error: 'unauthorized' }, 401)
        }
        const to = Deno.env.get('WHATSAPP_KEEPALIVE_TO_PHONE')
        if (!to) return jsonReply({ ok: false, error: 'WHATSAPP_KEEPALIVE_TO_PHONE not configured' })

        const sendResult = await sendTwilioWhatsApp(to, 'join cookies-could')
        return jsonReply(sendResult)
      }

      // App-triggered action (not a Twilio webhook) — request an employee's
      // confirmation of a manual entry the office just typed in
      if (json.action === 'request_confirmation') {
        const { data: employee } = await supabase
          .from('employees').select('id, name, phone, whatsapp_phone').eq('id', json.employee_id).eq('active', true).single()
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
        const msg = `The office logged your timesheet for ${friendlyDate(json.work_date)}: ${summary}. Reply to this text to confirm.`

        // Same routing as send_admin_note: prefer WhatsApp when the employee
        // has a whatsapp_phone on file, otherwise the main SMS line.
        const sendResult = employee.whatsapp_phone
          ? await sendTwilioWhatsApp(toWhatsAppE164(employee.whatsapp_phone), msg)
          : await sendTwilioSMS(toWhatsAppE164(employee.phone), msg)
        if (!sendResult.ok) {
          return jsonReply(sendResult)
        }

        await supabase
          .from('timesheet_entries')
          .update({ confirmation_requested_at: new Date().toISOString() })
          .eq('employee_id', json.employee_id)
          .eq('work_date', json.work_date)
          .eq('entry_source', 'manual')
          .eq('confirmation_status', 'pending')

        return jsonReply(sendResult)
      }

      // App-triggered action (not a Twilio webhook) — the office texts an employee
      // a note about one of their SMS submissions (e.g. missing detail) straight
      // from the SMS Review page. Reopens the submission as 'collecting' with a
      // pending question, so the employee's reply merges back into this same
      // submission via the existing follow-up mechanism (see openQuestionDate
      // below) instead of landing as a disconnected new message. The hourly
      // auto_close_stale_sms_conversations() cron job auto-closes it back to
      // 'submitted' if the employee never replies.
      if (json.action === 'send_admin_note') {
        const { data: submissionRow, error: subError } = await supabase
          .from('sms_submissions')
          .select('*, employees(name, phone, whatsapp_phone)')
          .eq('id', json.submission_id)
          .single()
        if (subError || !submissionRow) {
          return jsonReply({ ok: false, error: 'Submission not found' })
        }
        const empPhone = submissionRow.employees?.whatsapp_phone || submissionRow.employees?.phone
        if (!submissionRow.employee_id || !empPhone) {
          return jsonReply({ ok: false, error: 'No phone number on file for this employee' })
        }

        const workDateStr = String(submissionRow.work_date).substring(0, 10)
        const noteBody = `Office note re: your ${friendlyDate(workDateStr)} timesheet — ${json.note}`
        // Prefer WhatsApp when the employee has a whatsapp_phone on file — some
        // employees' regular `phone` isn't reliably theirs for SMS (e.g. no
        // Canadian SIM), so whatsapp_phone being set is a deliberate signal to
        // route outbound messages there instead.
        const sendResult = submissionRow.employees?.whatsapp_phone
          ? await sendTwilioWhatsApp(toWhatsAppE164(submissionRow.employees.whatsapp_phone), noteBody)
          : await sendTwilioSMS(toWhatsAppE164(submissionRow.employees.phone), noteBody)
        if (!sendResult.ok) {
          return jsonReply({ ok: false, error: sendResult.error })
        }

        const prevMsgs: any[] = submissionRow.raw_messages || []
        const { error: updateError } = await supabase
          .from('sms_submissions')
          .update({
            status:             'collecting',
            pending_questions:  ['Office note reply'],
            asked_questions:    Array.from(new Set([...(submissionRow.asked_questions || []), 'Office note reply'])),
            // admin_note is reserved for what the employee texts in via the NOTE:
            // command / mobile note field — the office's own outbound question
            // stays in raw_messages (the Conversation thread) only, so the two
            // never get mixed together in the Notes box.
            raw_messages:       [...prevMsgs, { text: noteBody, direction: 'out', ts: new Date().toISOString() }],
            updated_at:         new Date().toISOString(),
          })
          .eq('id', submissionRow.id)
        if (updateError) {
          return jsonReply({ ok: false, error: updateError.message })
        }

        return jsonReply({ ok: true })
      }

      // App-triggered action — Job Reports' "What Was Done" section asks for a
      // fresh Claude-condensed summary of a job's timesheet_entries descriptions.
      // Caches the result on the job row (work_summary + the entry count it was
      // generated from) so the caller can skip regenerating when nothing's
      // changed; this action always generates fresh when called.
      if (json.action === 'summarize_job') {
        const { data: entryRows, error: entriesError } = await supabase
          .from('timesheet_entries')
          .select('work_date, description')
          .eq('job_id', json.job_id)
          .order('work_date', { ascending: true })
        if (entriesError) return jsonReply({ ok: false, error: entriesError.message })

        const descriptions = (entryRows || [])
          .filter((e: any) => e.description?.trim())
          .map((e: any) => ({ date: String(e.work_date).substring(0, 10), text: e.description.trim() }))
        if (descriptions.length === 0) {
          return jsonReply({ ok: false, error: 'No work descriptions logged for this job yet' })
        }

        let summary: string
        try {
          summary = await summarizeJobWork(descriptions)
        } catch (err: any) {
          return jsonReply({ ok: false, error: err.message })
        }

        const { error: updateError } = await supabase
          .from('jobs')
          .update({ work_summary: summary, work_summary_entry_count: entryRows.length })
          .eq('id', json.job_id)
        if (updateError) return jsonReply({ ok: false, error: updateError.message })

        return jsonReply({ ok: true, summary, entry_count: entryRows.length })
      }

      fromPhone = normalizePhone(json.from_phone || '')
      msgBody = (json.body || '').trim()
      mediaUrls = json.media_urls || []
    }
  } catch {
    const r = 'Error reading message.'
    return isTwilio ? twiML(r) : jsonReply({ error: r }, 400)
  }

  // ── Twilio retry dedup ──
  // Twilio resends the identical webhook (same MessageSid) if it doesn't get a
  // fast enough response — under real load (a slow Claude parse, the save-retry
  // loop below) our response time can exceed Twilio's timeout, and every retry
  // was being processed as a brand-new message, silently duplicating whatever
  // it reported. Confirmed live: Gage's Aug 20 2026 timesheet, one text landed
  // on our side 3 times ~0.3s apart (tripling his hours on job 4866) while his
  // own phone only ever showed it sent once — the duplication was entirely
  // server-side. Claiming the SID via a unique-constraint insert is atomic even
  // if two retries race each other; whichever loses the race gets the dupError
  // and bails before doing any real work. No messageSid on the JSON test/app
  // path (Twilio-only field), so this is a no-op there.
  if (messageSid) {
    const { error: dupError } = await supabase
      .from('processed_message_sids')
      .insert({ message_sid: messageSid })
    if (dupError) {
      // Already handled — ack without replying again (a second reply would
      // double-text the tech with a now-stale hours count).
      return isTwilio ? emptyTwiML() : jsonReply({ reply: '' })
    }
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
      .eq('active', true)
    const match = (byPhone || []).find((e: any) =>
      (e.phone && normalizePhone(e.phone) === fromPhone) || (e.whatsapp_phone && normalizePhone(e.whatsapp_phone) === fromPhone))
    if (match) { employeeId = match.id; employeeName = match.name }
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

  // ── Fill-in-the-blank template request ──
  if (msgLower === 'template' && mediaUrls.length === 0) {
    return isTwilio ? twiML(TEMPLATE_TEXT) : jsonReply({ reply: TEMPLATE_TEXT })
  }

  // ── Mobile site link request ──
  if ((msgLower === 'mobile' || msgLower === 'app') && mediaUrls.length === 0) {
    const r = `Check your week here: ${MOBILE_URL}\nLog in with your phone number.`
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Main site link request ──
  if (msgLower === 'main' && mediaUrls.length === 0) {
    const r = `Main site: ${MAIN_URL}`
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Timesheet view request ("timesheet" / "ts", optional day) ──
  // Deterministic keyword, no Claude call. Guarded on no-media so a photo whose
  // caption happens to say "timesheet" still gets saved as a photo below.
  const tsMatch = msgLower.match(/^(?:timesheets?|ts)(?:\s+(.+))?$/)
  if (tsMatch && mediaUrls.length === 0) {
    const tsDate = resolveDayArg(tsMatch[1] || '', today)
    if (!tsDate) {
      const r = `Didn't catch that day. Try "TS", "TS yesterday" or "TS monday".`
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    let tsSub: any = null
    {
      const { data: byPhone } = await supabase
        .from('sms_submissions').select('*')
        .eq('from_phone', fromPhone).eq('work_date', tsDate).neq('status', 'rejected')
        .order('updated_at', { ascending: false }).limit(1)
      if (byPhone?.length) tsSub = byPhone[0]
      else if (employeeId) {
        const { data: byEmp } = await supabase
          .from('sms_submissions').select('*')
          .eq('employee_id', employeeId).eq('work_date', tsDate).neq('status', 'rejected')
          .order('updated_at', { ascending: false }).limit(1)
        if (byEmp?.length) tsSub = byEmp[0]
      }
    }
    const { count: photoCount } = await supabase
      .from('gear_photos').select('id', { count: 'exact', head: true })
      .eq('from_phone', fromPhone).eq('work_date', tsDate)

    if (!tsSub && !photoCount) {
      // The lookup above deliberately skips rejected rows, so a rejected-only day would
      // otherwise look identical to "never submitted" — tell the tech what actually happened.
      let wasRejected = false
      {
        const { data } = await supabase
          .from('sms_submissions').select('id')
          .eq('from_phone', fromPhone).eq('work_date', tsDate).eq('status', 'rejected')
          .limit(1)
        wasRejected = !!data?.length
        if (!wasRejected && employeeId) {
          const { data: byEmp } = await supabase
            .from('sms_submissions').select('id')
            .eq('employee_id', employeeId).eq('work_date', tsDate).eq('status', 'rejected')
            .limit(1)
          wasRejected = !!byEmp?.length
        }
      }
      const r = wasRejected
        ? `Your ${friendlyDate(tsDate)} submission was deleted. Please resubmit or contact the office.`
        : `Nothing submitted for ${friendlyDate(tsDate)} yet.`
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    const lines: string[] = [`${friendlyDate(tsDate)}${employeeName ? ' — ' + employeeName.split(' ')[0] : ''}`]
    if (tsSub?.time_in || tsSub?.stated_time_out || tsSub?.lunch_minutes) {
      const inFmt  = tsSub.time_in ? friendlyTime(tsSub.time_in.substring(0, 5)) : '??'
      const outFmt = tsSub.stated_time_out ? friendlyTime(tsSub.stated_time_out.substring(0, 5))
                   : tsSub.calculated_time_out ? friendlyTime(tsSub.calculated_time_out.substring(0, 5)) : '??'
      const lunchFmt = tsSub.lunch_minutes ? ` | lunch ${tsSub.lunch_minutes}min` : ' | no lunch'
      lines.push(`In ${inFmt} – Out ${outFmt}${lunchFmt}`)
    }
    const tsEntries = tsSub?.entries || []
    const jobBlocks = tsEntries.map((e: any) => {
      const desc = String(e.description || '').replace(/\s+/g, ' ').trim()
      const ot = Number(e.ot_hours) || 0
      const hrs = !(Number(e.hours) > 0) ? 'hrs TBD'
        : ot > 0 ? `${e.reg_hours}hrs reg, ${ot}hrs OT` : `${e.hours}hrs`
      return `Job# ${e.job_number || '?'}: ${hrs}` + (desc ? `\n   ${desc}` : '')
    })
    if (jobBlocks.length) {
      lines.push('')
      lines.push(jobBlocks.join('\n\n'))
    }

    const tsTotalHours = tsEntries.reduce((s: number, e: any) => s + (Number(e.hours) || 0), 0)
    const tsTotalOT = tsEntries.reduce((s: number, e: any) => s + (Number(e.ot_hours) || 0), 0)
    const tsTotalReg = Math.round((tsTotalHours - tsTotalOT) * 100) / 100
    if (tsTotalHours > 0 && (tsEntries.length > 1 || tsTotalOT > 0)) {
      lines.push('')
      lines.push(`Total ${tsTotalOT > 0 ? `${tsTotalReg}hrs reg, ${tsTotalOT}hrs OT` : `${tsTotalHours}hrs`}`)
    }

    if (tsSub?.delta_minutes != null && Math.abs(tsSub.delta_minutes) > 15) {
      lines.push(`Heads up — your times and job hours are off by ${Math.abs(tsSub.delta_minutes)}min.`)
    }
    if (tsSub?.stated_time_out && Number(tsSub.stated_time_out.slice(0, 2)) < 6) {
      lines.push(`Heads up — your out time (${friendlyTime(tsSub.stated_time_out.substring(0, 5))}) is after midnight. Did you mean pm?`)
    }

    if (tsSub) {
      lines.push(tsSub.per_diem_location && tsSub.per_diem_location.trim().toLowerCase() !== 'none'
        ? `PD: ${tsSub.per_diem_location}` : 'No per diem')
    }
    if ((tsSub?.supplies || []).length > 0) {
      lines.push('Supplies: ' + tsSub.supplies.map((s: any) =>
        `${s.supply_name} x${s.quantity}${s.job_number ? ` (${s.job_number})` : ''}`).join(', '))
    }
    if (photoCount) lines.push(`Photos: ${photoCount}`)

    const r = lines.join('\n')
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Day off ("day off") ──
  // Deterministic keyword, no Claude call, no office review needed — there's
  // nothing to check (no hours, no job). A positive "I'm intentionally not
  // working today" signal instead of silence, so it doesn't read as a missed
  // report in Submission Status. Guarded on no-media so a photo captioned
  // "day off" still gets saved as a photo below, and on a known employee —
  // an unrecognized number still needs a human to match it, same as any
  // other text from that number.
  if (msgLower === 'day off' && mediaUrls.length === 0 && employeeId) {
    const { data: existing } = await supabase
      .from('timesheet_entries').select('id')
      .eq('employee_id', employeeId).eq('work_date', today).eq('is_day_off', true)
      .limit(1)
    let r: string
    if (existing && existing.length > 0) {
      r = `Already marked ${friendlyDate(today)} as a day off${employeeName ? ', ' + employeeName.split(' ')[0] : ''}.`
    } else {
      const { error } = await supabase.from('timesheet_entries').insert({
        employee_id: employeeId, work_date: today, job_id: null,
        hours: 0, ot_hours: 0, description: 'Day off',
        per_diem: 0, is_day_off: true, entry_source: 'sms',
      })
      r = error
        // Unique index race (see migration) reads as a duplicate-key error —
        // someone else's concurrent "day off" already landed, which is fine.
        ? (error.message?.includes('duplicate key')
            ? `Already marked ${friendlyDate(today)} as a day off${employeeName ? ', ' + employeeName.split(' ')[0] : ''}.`
            : `Couldn't save that — contact the office if this keeps happening.`)
        : `Got it${employeeName ? ' ' + employeeName.split(' ')[0] : ''} — marked ${friendlyDate(today)} as a day off.`
    }
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Self-service delete ("reject", optional day) ──
  // A tech who completely botched a day's entry can wipe it themselves, as long
  // as the office hasn't approved it yet — once approved it's real payroll data
  // and has to go through the office (Timesheets tab → Delete) instead.
  const rejectMatch = msgLower.match(/^reject(?:\s+(.+))?$/)
  if (rejectMatch && mediaUrls.length === 0) {
    const rejectDate = resolveDayArg(rejectMatch[1] || '', today)
    if (!rejectDate) {
      const r = `Didn't catch that day. Try "reject", "reject yesterday" or "reject monday".`
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    let target: any = null
    {
      const { data: byPhone } = await supabase
        .from('sms_submissions').select('*')
        .eq('from_phone', fromPhone).eq('work_date', rejectDate)
        .order('updated_at', { ascending: false }).limit(1)
      if (byPhone?.length) target = byPhone[0]
      else if (employeeId) {
        const { data: byEmp } = await supabase
          .from('sms_submissions').select('*')
          .eq('employee_id', employeeId).eq('work_date', rejectDate)
          .order('updated_at', { ascending: false }).limit(1)
        if (byEmp?.length) target = byEmp[0]
      }
    }

    if (!target) {
      const r = `Nothing submitted for ${friendlyDate(rejectDate)} to delete.`
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }
    if (target.status === 'approved') {
      const r = `Your ${friendlyDate(rejectDate)} entry's already been approved by the office — contact them directly to fix it.`
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }

    const { error: deleteError } = await supabase.from('sms_submissions').delete().eq('id', target.id)
    const r = deleteError
      ? `Something went wrong deleting that — contact the office directly.`
      : `Deleted your ${friendlyDate(rejectDate)} entry. Text your hours again whenever you're ready.`
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── General day note (not tied to any job) ──
  // "NOTE: <text>" is a deterministic command like REJECT/JOBS — skips Claude
  // parsing entirely, always attaches to today. Appended with a timestamp
  // (not overwritten) to admin_note — reserved exclusively for what the
  // employee texts/enters this way (see send_admin_note above, which
  // deliberately does NOT write here, so the office's own outbound questions
  // never mix into it). Reuses today's in-progress/submitted row if one
  // already exists rather than creating a phantom duplicate; creates one
  // (with no job entries) if this is the first text of the day.
  const noteMatch = msgBody.match(/^note:?\s+(.+)$/i)
  if (noteMatch && mediaUrls.length === 0 && employeeId) {
    const noteText = noteMatch[1].trim()
    const firstName = (employeeName || '').split(' ')[0] || ''
    const stamp = `[${friendlyDate(today)}${firstName ? ' ' + firstName : ''}]`
    const newNoteLine = `${stamp} ${noteText}`

    let noteSubmission: any = null
    {
      const { data } = await supabase.from('sms_submissions').select('*')
        .eq('employee_id', employeeId).eq('work_date', today)
        .in('status', ['collecting', 'submitted'])
        .order('updated_at', { ascending: false }).limit(1)
      if (data?.length) noteSubmission = data[0]
    }

    const combinedNote = noteSubmission?.admin_note ? `${noteSubmission.admin_note}\n${newNoteLine}` : newNoteLine
    const prevMsgs: any[] = noteSubmission?.raw_messages || []
    const allMsgs = [...prevMsgs, { text: msgBody, direction: 'in', ts: new Date().toISOString() }]

    if (noteSubmission) {
      await supabase.from('sms_submissions').update({
        admin_note: combinedNote, raw_messages: allMsgs, updated_at: new Date().toISOString(),
      }).eq('id', noteSubmission.id)
    } else {
      await supabase.from('sms_submissions').insert({
        from_phone: fromPhone, employee_id: employeeId, work_date: today,
        entries: [], status: 'submitted', admin_note: combinedNote, raw_messages: allMsgs,
      })
    }

    const r = `Got it${firstName ? ' ' + firstName : ''} — noted for ${friendlyDate(today)}.`
    return isTwilio ? twiML(r) : jsonReply({ reply: r })
  }

  // ── Photo submission ──
  // Photos are recorded quietly: spot a job/ship in the caption if there is one,
  // otherwise assume the day's current job. Never ask. Photos arriving before any
  // job is known that day stay untagged for the office ("Needs ship/job" in Gear Photos).
  const hasPhotos = mediaUrls.length > 0
  if (hasPhotos) {
    // Deterministic caption checks only — a bare job number or a ship-ish word.
    let photoContext: string | null = null
    let sawExplicitJobNumber = false
    const jobNumberMatch = msgBody.match(/\b(\d{4})\b/)
    if (jobNumberMatch) {
      photoContext = jobNumberMatch[1]
      sawExplicitJobNumber = true
    } else if (/wave|nanaimo|ship|boat/i.test(msgBody)) {
      photoContext = msgBody.trim().substring(0, 50)
    } else {
      photoContext = await getLastJobForDay(supabase, fromPhone, today, null, employeeId)
    }

    const jobId = await lookupJobId(supabase, photoContext)
    // Only warn when the tech explicitly typed a job number that doesn't exist —
    // a ship name or the day's carried-over job not resolving is normal, not a typo.
    const unrecognizedJobNumber = sawExplicitJobNumber && !jobId
    // The full caption is worth keeping either way — "old card clips, looking for
    // a spare" is exactly the note the office needs next to the photo.
    const note = msgBody.trim() || null
    // Deterministic low-stock check — same "never ask, just flag" approach as
    // everything else here; no Claude call for photos, same as job detection above.
    // Computed before the save so a matching photo can be auto-tagged photo_type
    // 'supply' at insert time — the clearest, cheapest signal available without
    // adding a Claude call to this high-volume path. Anything else stays
    // unclassified for a manual sweep in the Gear Photos tab.
    const LOW_STOCK_RE = /\b(last (one|can|box|roll|tube|bottle|pair|bag|couple)|running low|almost out|getting low|down to (the )?last)\b/i
    const isLowStockCaption = LOW_STOCK_RE.test(msgBody)
    // Same idea, same reasoning as the low-stock check — a caption that opens
    // with "supply"/"supplies"/"parts" (same trigger words as the text-report
    // parser, minus the Claude call) is an unambiguous enough signal to
    // auto-tag on its own. Without this, a photo captioned "Supplies: 3
    // disks" saved with photo_type null — invisible under the Supplies filter
    // and never turned into a real job_supplies line — until an admin
    // happened to notice it sitting untagged and fixed it by hand. Confirmed
    // in production: Nicolae Ileshov, 2026-08-27.
    const SUPPLY_CAPTION_RE = /^\s*(supplies?|parts?)\b/i
    const isSupplyCaption = SUPPLY_CAPTION_RE.test(msgBody)
    const saved = await Promise.all(
      mediaUrls.map(url => savePhotoToStorage(supabase, url, employeeId, fromPhone, today, photoContext, jobId, note, (isLowStockCaption || isSupplyCaption) ? 'supply' : null))
    )

    const firstName = (employeeName || '').split(' ')[0] || ''

    if (isLowStockCaption) {
      const firstSaved = saved.find(r => r !== null)
      const photoUrl = firstSaved
        ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/gear-photos/${firstSaved.path}`
        : null
      const itemGuess = note && note.length <= 80 ? note : 'something (see photo)'
      await sendLowStockAlert(supabase, itemGuess, photoContext, firstName, photoUrl, employeeId)
    }

    const anySaved = saved.some(r => r !== null)
    const reply = !anySaved
      ? `Couldn't save that photo${firstName ? ' ' + firstName : ''} — try texting it again, or contact the office if it keeps failing.`
      : unrecognizedJobNumber
      ? `Got the photo${firstName ? ' ' + firstName : ''} — but didn't recognize Job# ${photoContext}. Text JOBS for the list, or the office will check.`
      : photoContext
      ? `Got the photo${firstName ? ' ' + firstName : ''} — logged to ${photoContext}.`
      : `Got the photo${firstName ? ' ' + firstName : ''}.`
    return isTwilio ? twiML(reply) : jsonReply({ reply })
  }

  // ── Jobs list request (before the Claude parse — deterministic keyword) ──
  // "jobs " alone doesn't confirm it's the list command — a normal report
  // can start the same way ("Jobs 4926. 5hrs tech work"), and a vessel name
  // never starts with a digit the way a job number does. Without this guard
  // that exact message got swallowed as "JOBS <vessel filter>" with
  // vesselFilter "4926.  5hrs tech work", matched no vessel, and replied "No
  // open jobs found" — silently dropping the whole report before it ever
  // reached Claude. Confirmed in production, Jim Jardine, 2026-08-27.
  const isJobsRequest = msgLower === 'jobs'
    || (msgLower.startsWith('jobs ') && !/^\d/.test(msgLower.slice(5).trim()))
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
    } else if (!vesselFilter) {
      // Bare "jobs" with genuinely nothing open — a real, valid answer.
      const r = 'No open jobs right now.'
      return isTwilio ? twiML(r) : jsonReply({ reply: r })
    }
    // vesselFilter matched no real vessel — the digit-prefix guard above only
    // catches "jobs 4926...", not every phrasing a report could start with
    // ("Jobs done today, 4760 6hrs...", a typo'd "jobs shop 6hrs..."). Rather
    // than keep enumerating patterns, treat a non-match as proof this was
    // never really a JOBS command and let it fall through to Claude instead
    // of terminating the conversation with "No open jobs found for ...".
  }

  // ── Reply to a pending manual-entry confirmation ──
  // Deterministic check before Claude parsing so a plain "yes" never gets
  // fed to the parser. Skipped if there's an active collecting/submitted
  // conversation so we don't hijack a normal in-progress submission.
  //
  // Two guards keep this from hijacking a real timesheet text (see Aug 7 2026
  // incident: Finn's full end-of-day report was silently swallowed as a
  // "confirmed" reply to unrelated two-week-old manual entries, because he had
  // pending confirmations he was never actually asked about):
  //   1. Only entries with confirmation_requested_at set count — a pending
  //      confirmation the employee was never texted about isn't something
  //      their next message could plausibly be replying to. (Confirmation
  //      request texts are currently paused for everyone but Jim, so without
  //      this guard every other employee's next text was always at risk.)
  //   2. The message itself must look like a short affirmative — a real
  //      timesheet report falls through to normal parsing below instead of
  //      being consumed here.
  const CONFIRMATION_REPLY_RE = /^(y|ya|yea|yeah|yep|yup|yes|correct|confirm(ed)?|ok|okay|k|got it|sounds good|thanks|thank you|good|all good|sure)[.!]?$/i
  if (fromPhone && CONFIRMATION_REPLY_RE.test(msgBody.trim())) {
    const { data: byPhone } = await supabase.from('employees').select('id, name, phone, whatsapp_phone').eq('active', true)
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
          .not('confirmation_requested_at', 'is', null)

        if (pendingConfirm && pendingConfirm.length > 0) {
          await supabase
            .from('timesheet_entries')
            .update({ confirmation_status: 'confirmed', confirmed_at: new Date().toISOString(), confirmation_reply_text: msgBody })
            .eq('employee_id', phoneMatch.id).eq('confirmation_status', 'pending')
            .not('confirmation_requested_at', 'is', null)

          const r = 'Thanks, got it — logged as confirmed.'
          return isTwilio ? twiML(r) : jsonReply({ reply: r })
        }
      }
    }
  }

  // ── Find any in-progress conversation BEFORE parsing ──
  // A 'collecting' conversation is a question still awaiting this exact reply — there's only
  // ever one truly in-progress per phone, so match on phone alone, not work_date. A follow-up
  // reply ("no supplies", "no pd") often doesn't repeat whatever date the original report was
  // for, so requiring work_date to match today would miss a backdated report's open question
  // entirely and start a brand new (wrongly-attributed) submission instead.
  //
  // Fetched before the Claude parse so the parser can be told what we asked: a reply like
  // "Yes 3 cans of #44 red" only parses as supplies if Claude knows a supplies question is
  // what it's answering.
  let submission: any = null
  {
    const { data: byPhone } = await supabase
      .from('sms_submissions').select('*')
      .eq('from_phone', fromPhone).eq('status', 'collecting')
      .order('created_at', { ascending: false }).limit(1)
    if (byPhone?.length) submission = byPhone[0]
  }
  // The only question the bot still asks is the job question — pending_questions
  // is all the context the parser needs.
  const parseContext: string[] = submission?.pending_questions || []

  // ── Parse with Claude ──
  let parsed: any = {
    entries: [], supplies: [], low_stock: [], name_override: null, work_date: null,
    time_in: null, stated_time_out: null,
    lunch_minutes: null, per_diem_location: null,
    is_help_request: false
  }

  try {
    parsed = await parseWithClaude(msgBody, today, parseContext)
  } catch (_e) {
    console.error('parseWithClaude failed:', _e instanceof Error ? _e.message : String(_e))
    const r = "Couldn't read that one. Reply HELP for the format, or text the office directly."
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
  // A follow-up answer ("none", "no pd") to an open question never states a date, so it
  // must inherit the conversation's work_date — falling back to today would silently move
  // a backdated report ("forgot to send yesterday...") to the wrong day when the tech
  // answers the supplies/lunch/PD question. Fresh reports (no open question) still
  // default to today. The record save writes work_date back, so getting this wrong
  // doesn't just mislabel the reply — it re-dates the whole submission.
  const openQuestionDate = (submission?.pending_questions || []).length > 0 && submission?.work_date
    ? String(submission.work_date).substring(0, 10)
    : null
  const workDate = parsed.work_date || openQuestionDate || today

  // ── Find/merge/save submission, retrying on a concurrent write ──
  // Race guard: two texts from the same phone landing close together (e.g. two
  // quick job updates in a row) both read the same pre-update snapshot while
  // Claude parses (1-9s each), so a blind save let whichever finished second
  // silently clobber the first's entry — even though both already got a "Got it"
  // reply confirming they were saved. (See Aug 7 2026 incident: a whole job
  // entry vanished this way, confirmed via WhatsApp read receipts + the bot's
  // own "Got it" reply for a message that never survived to the stored record.)
  // Each attempt re-reads the submission fresh and re-merges against it; the
  // save is conditional on updated_at being unchanged since that read, so a
  // losing attempt retries against the winner's state instead of overwriting it.
  // A generous cap: techs in poor-signal areas queue several messages at once
  // (WhatsApp especially — it holds them locally and fires them all the moment
  // connectivity returns), so a "burst" isn't always just two messages, and each
  // retry here is a cheap DB round trip, not another slow Claude parse.
  let reply = ''
  let nextStatus = 'collecting'
  let flags: string[] = []
  let saved = false
  let saveError: any = null
  const MAX_SAVE_ATTEMPTS = 10

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS && !saved; attempt++) {
    submission = null

    // ── Find existing submission (continued from the pre-parse phone lookup above) ──
    // The employee-id fallback (different phone, same person — e.g. borrowed someone else's
    // phone) stays scoped to work_date: without that, two genuinely unrelated conversations that
    // happen to share the same "This is X" name on different days/phones would incorrectly merge.
    if (!submission && employeeId) {
      const { data: byEmp } = await supabase
        .from('sms_submissions').select('*')
        .eq('employee_id', employeeId).eq('work_date', workDate).eq('status', 'collecting')
        .order('created_at', { ascending: false }).limit(1)
      if (byEmp?.length) submission = byEmp[0]
    }

    // A 'submitted' conversation (correction/reopen flow) does need to match the specific day —
    // "actually I finished at 6" should correct that day's record, not some other day's.
    if (!submission) {
      const { data: byPhone } = await supabase
        .from('sms_submissions').select('*')
        .eq('from_phone', fromPhone).eq('work_date', workDate).eq('status', 'submitted')
        .order('created_at', { ascending: false }).limit(1)
      // Only reuse a phone-matched row if it actually belongs to the person this
      // message is for. A phone can text "for X" to log on someone else's behalf
      // while its own conversation for the day is still sitting 'submitted' — blindly
      // reusing whatever that phone last submitted folds the named-for report into a
      // different employee's entry (see the 2026-08-21 incident: Jim's own 4hrs on
      // job 4954 silently became part of what got labeled Greg's submission, because
      // this lookup matched on phone+date alone with no check against who the
      // message was actually naming). employeeId/byPhone[0].employee_id null is the
      // pre-existing "don't know who yet" case and still falls through as before.
      if (byPhone?.length && (!employeeId || !byPhone[0].employee_id || byPhone[0].employee_id === employeeId)) {
        submission = byPhone[0]
      } else if (employeeId) {
        const { data: byEmp } = await supabase
          .from('sms_submissions').select('*')
          .eq('employee_id', employeeId).eq('work_date', workDate).eq('status', 'submitted')
          .order('created_at', { ascending: false }).limit(1)
        if (byEmp?.length) submission = byEmp[0]
      }
    }

    // Whether this is a follow-up reply to the one question we still ask (the job question)
    const isFollowUp = !!(submission && (submission.pending_questions || []).length > 0)

    // ── Merge entries ──
    // One entry per job per day: hours accumulate (or replace, for corrections),
    // descriptions join. A text with no job number attaches to the day's current job.
    const lastJob = await getLastJobForDay(supabase, fromPhone, workDate, submission, employeeId)
    const prevEntries: any[] = submission?.entries || []
    const mergeStamp = new Date().toISOString()
    let allEntries: any[] = mergeEntries(prevEntries, parsed.entries || [], lastJob, mergeStamp)

    // Supplies accumulate across texts the same way entries do. If no job number was
    // given with a supply, attribute it to the first job we know about for the day.
    const prevSupplies: any[] = submission?.supplies || []
    const fallbackJob = allEntries.find((e: any) => e.job_number)?.job_number || lastJob || ''
    const newSupplies = (parsed.supplies || [])
      .filter((s: any) => s.supply_name && String(s.supply_name).trim())
      .map((s: any) => ({
        job_number:  s.job_number || fallbackJob,
        supply_name: String(s.supply_name).trim(),
        quantity:    Number(s.quantity) > 0 ? Number(s.quantity) : 1,
      }))
    const allSupplies = [...prevSupplies, ...newSupplies]

    // Detect an explicit "none" reply to the end-of-day consumables question (see
    // needsConsumablesAsk below) — Claude returns an empty supplies array both for
    // "none" and for an unrelated message, so the distinction is made here with a
    // deterministic check the same way CONFIRMATION_REPLY_RE is, rather than trusting
    // an LLM-authored boolean.
    const NEGATIVE_REPLY_RE = /^(none|no|nope|nothing|nah|n\/a|na)[.!]?$/i
    const answeringConsumables = isFollowUp && (submission?.pending_questions || []).includes('Consumables?')
    const consumablesAnsweredNone = answeringConsumables && newSupplies.length === 0 && NEGATIVE_REPLY_RE.test(msgBody.trim())

    // Latest non-null parsed value wins — "lunch 30" or "actually I finished at 6"
    // later in the day overrides whatever was stored (or defaulted) earlier.
    // Silent default, same philosophy as lunch/PD — a tech who doesn't mention a
    // start time almost always started around 7; the office corrects the exceptions.
    // Only applies when there's actual work logged for the day — an "off, zero
    // hours" text has no entries at all, and defaulting to 7am there produced a
    // nonsensical "Got it — in 7am" reply for a day the tech said they didn't work.
    const mergedTimeIn    = parsed.time_in
                          ?? (submission?.time_in ? submission.time_in.substring(0, 5) : null)
                          ?? (allEntries.length > 0 ? '07:00' : null)
    const mergedStatedOut = parsed.stated_time_out
                          ?? (submission?.stated_time_out ? submission.stated_time_out.substring(0, 5) : null)
    const mergedLunch     = parsed.lunch_minutes != null ? parsed.lunch_minutes
                          : (submission?.lunch_minutes != null ? submission.lunch_minutes : null)
    // Claude is told to return lowercase "none" but occasionally capitalizes
    // it like normal English ("None") — canonicalize here so every downstream
    // check that compares against the exact string 'none' keeps working,
    // instead of silently treating a capitalized "None" as a real location
    // and granting per diem nobody claimed (confirmed in production against
    // Wade Kenney's and Finn Jones's submissions, 2026-08-27).
    const rawMergedPerDiem = parsed.per_diem_location != null ? parsed.per_diem_location
                          : (submission?.per_diem_location != null ? submission.per_diem_location : null)
    const mergedPerDiem  = rawMergedPerDiem?.trim().toLowerCase() === 'none' ? 'none' : rawMergedPerDiem
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

    // Notify the office immediately when something's flagged low — this doesn't
    // wait for approval like everything else, since reordering is time-sensitive.
    // Only ever fires on the first attempt — low_stock is a fixed property of this
    // message, not of the submission state a retry would be re-merging against, so
    // repeating it on retry would just double up the alert.
    if (attempt === 0 && (parsed.low_stock || []).length > 0) {
      const reporterFirstName = (employeeName || '').split(' ')[0] || ''
      await Promise.all((parsed.low_stock || []).map((ls: any) =>
        sendLowStockAlert(supabase, String(ls.item || '').trim() || 'something', ls.job_number || fallbackJob || null, reporterFirstName, null, mergedEmployeeId)
      ))
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
    //
    // Only allowed to run the FIRST time on an entry the current message didn't just create
    // or touch itself (last_mentioned_at === mergeStamp) — otherwise a later, unrelated
    // message that happens to complete the shift bounds while only one job is known SO FAR
    // (more may still be coming) would silently overwrite that job's already-correct,
    // explicitly-stated hours with the full shift span. Real incident: Cory's "Shop 1hr"
    // silently became "Shop 8hrs" the instant he texted his out-time, before he'd texted his
    // second job — which then showed as all OT once given (2026-08-26).
    //
    // Once an entry HAS been bounds-derived this way, _hours_from_bounds keeps it re-syncing
    // on later bounds-only corrections too ("actually lunch was only 30 min") — that's a real,
    // separate, intended behavior (a lone job's hours track the shift bounds once derived from
    // them) and gating purely on last_mentioned_at would have broken it.
    // Same-message variant of the above: a tech states explicit hours AND full time
    // bounds together in one message and the two don't agree (e.g. "4760 6hrs, in 7,
    // out 3:30" — bounds say 8). Bounds still win here (Claude's stated number is often
    // itself just the raw span, per the note above — there's no reliable way to tell
    // "genuinely stated" from "computed from the range" at this point), but silently
    // trusting bounds with no visibility was the original 2026-08-08 concern — flag a
    // real mismatch to the office instead of swallowing it. Only checked on first touch
    // (this message), not on a later _hours_from_bounds re-sync (e.g. a lunch
    // correction), since that re-sync is intended behavior and would false-positive here.
    let hoursBoundsMismatch: { stated: number; bounds: number } | null = null
    if (allEntries.length === 1 && mergedTimeIn && mergedStatedOut &&
        (allEntries[0].last_mentioned_at === mergeStamp || allEntries[0]._hours_from_bounds)) {
      const firstTouch = allEntries[0].last_mentioned_at === mergeStamp
      const statedHours = Number(allEntries[0].hours) || 0
      const boundedHours = Math.round(((timeToMins(mergedStatedOut) - timeToMins(mergedTimeIn) - (mergedLunch || 0)) / 60) * 100) / 100
      if (boundedHours > 0) {
        if (firstTouch && statedHours > 0 && Math.abs(statedHours - boundedHours) > 0.1) {
          hoursBoundsMismatch = { stated: statedHours, bounds: boundedHours }
        }
        allEntries = [{ ...allEntries[0], hours: boundedHours, _hours_from_bounds: true }]
      }
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

    // A stop time between midnight and early morning is almost always a tech
    // typing the wrong am/pm ("out 3" meant 3pm, parsed as 03:00) — rare enough
    // to occasionally be a real overnight shift, common enough as a slip to be
    // worth a same-message heads-up rather than silently trusting it.
    const statedOutHour = mergedStatedOut ? Number(mergedStatedOut.slice(0, 2)) : null
    const midnightOutWarning = statedOutHour != null && statedOutHour < 6

    // ── OT breakdown ──
    // Fetch daily threshold + any hours already approved for this employee today
    // so second/third texts in a day get correct OT attribution
    const [{ data: otCfg }, { data: priorEntries }, { data: statRows }, { data: empThreshold }] = await Promise.all([
      supabase.from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single(),
      mergedEmployeeId
        ? supabase.from('timesheet_entries').select('hours').eq('employee_id', mergedEmployeeId).eq('work_date', workDate).eq('is_stat_pay', false)
        : Promise.resolve({ data: [] }),
      supabase.from('stat_holidays').select('holiday_date').eq('holiday_date', workDate),
      mergedEmployeeId
        ? supabase.from('employees').select('ot_daily_threshold, ot_friday_threshold').eq('id', mergedEmployeeId).single()
        : Promise.resolve({ data: null }),
    ])
    // Work on a stat holiday or weekend is all OT — for a stat day, the 8 reg
    // hrs come from the auto stat-pay entry instead.
    const isStatDay = (statRows || []).length > 0
    const workDateDOW = new Date(workDate + 'T12:00:00').getDay()
    const isWeekendDay = workDateDOW === 0 || workDateDOW === 6
    const globalDailyOTThreshold = (isStatDay || isWeekendDay) ? 0 : (otCfg ? Number(otCfg.value) : 8)
    const alreadyWorkedHours = (priorEntries || []).reduce((s: number, e: any) => s + Number(e.hours || 0), 0)
    // A per-employee fixed schedule (e.g. Tracy's 8.75/day, 5 on Fridays —
    // see otCalc.js's effectiveDailyThreshold, which this mirrors; the two
    // can't share code across the frontend/Deno boundary, so keep them in
    // sync by hand) only covers a normal day: if today's total (already
    // logged + this text) exceeds it, the whole day reverts to the standard
    // threshold instead of using her personal one as a floor on top of it.
    let dailyOTThreshold = globalDailyOTThreshold
    if (empThreshold && !isStatDay && !isWeekendDay) {
      const isFriday = workDateDOW === 5
      const personal = (isFriday ? empThreshold.ot_friday_threshold : empThreshold.ot_daily_threshold) ?? null
      if (personal != null && (alreadyWorkedHours + totalHours) <= personal) {
        dailyOTThreshold = personal
      }
    }
    const allEntriesWithOT = calcOTBreakdown(allEntries, dailyOTThreshold, alreadyWorkedHours)
    const totalOTHours = allEntriesWithOT.reduce((s: number, e: any) => s + (e.ot_hours || 0), 0)

    // Entries this specific message actually touched — the reply only ever confirms
    // what was just reported, not the whole day (the tech already knows the rest;
    // "TS" is there if they want the full picture).
    const touchedEntriesWithOT = allEntriesWithOT.filter((e: any) => e.last_mentioned_at === mergeStamp)

    // ── Catch a job number that doesn't match any real job (typo or stale number) ──
    // instead of silently storing it for the office to discover during review.
    // Scoped to this message too — don't re-flag an old bad number every reply after.
    const distinctJobNums = Array.from(new Set(
      touchedEntriesWithOT.map((e: any) => e.job_number).filter((j: any) => j && String(j).toUpperCase() !== 'SHOP')
    )) as string[]
    let unknownJobs: string[] = []
    if (distinctJobNums.length > 0) {
      const { data: knownJobs } = await supabase.from('jobs').select('job_number').in('job_number', distinctJobNums)
      const knownSet = new Set((knownJobs || []).map((j: any) => String(j.job_number).toLowerCase()))
      unknownJobs = distinctJobNums.filter((j: string) => !knownSet.has(j.toLowerCase()))
    }

    // ── Determine what's missing ──
    const missingEmployee = !mergedEmployeeId
    // After mergeEntries, null-job entries survive only when NO job is known at all —
    // not today, not any prior day (getLastJobForDay's cross-day fallback covers the
    // usual "still on the same job" case) — meaning this employee has no job history
    // to fall back on at all.
    const hasUnattributedWork = allEntries.some((e: any) => !e.job_number)

    // Fields the office will need to fill in (shown in review screen)
    flags = []

    // ── Decide ──
    // The bot records quietly: job number and PD are never asked about — they default
    // (or fall back to the last-known job) at save time, and the office corrects the
    // exceptions. Two questions survive: lunch, which only fires on a longer day
    // (>8hrs) where it was never mentioned at all — a silent 0 there is much more
    // likely to be a forgotten entry than a real thing — and consumables, asked once
    // the day has a known end time and nothing about supplies has been said or asked
    // yet (mergedStatedOut is the persisted "day looks done" state, not just this
    // message, so it still fires on the message right after lunch gets resolved).
    const needsLunchAsk = totalHours > 8 && mergedLunch == null && !isFollowUp
    const suppliesKnownForDay = allSupplies.length > 0 || submission?.supplies_note != null
    const alreadyAskedConsumables = (submission?.asked_questions || []).includes('Consumables?')
    const needsConsumablesAsk = !!mergedStatedOut && totalHours > 0 && !suppliesKnownForDay && !alreadyAskedConsumables && !isFollowUp && !needsLunchAsk
    reply = ''
    nextStatus = 'collecting'
    let pendingQuestions: string[] = []
    const firstName = (employeeName || '').split(' ')[0] || ''

    if (missingEmployee) {
      // Employee couldn't be identified (unknown phone or unmatched name).
      // Save immediately for the office instead of asking for follow-up.
      reply = `Got it. The office will match this to you and get it into the system.`
      nextStatus = 'submitted'
      flags.push('employee not identified — needs manual assignment')

    } else if (hasUnattributedWork) {
      // No job named and no history to assume from (this employee's first-ever
      // text) — save it anyway so the description isn't lost, and let the office
      // pick the job during review instead of texting back and forth over it.
      reply = `Got it${firstName ? ' ' + firstName : ''} — the office will match the job.`
      nextStatus = 'submitted'
      flags.push('no job entries — needs manual entry')

    } else if (needsLunchAsk) {
      reply = `Got it${firstName ? ' ' + firstName : ''} — that's over 8hrs. Did you take a lunch?\n("lunch 30" or "no lunch")`
      pendingQuestions = ['Lunch?']

    } else if (needsConsumablesAsk) {
      reply = `Got it${firstName ? ' ' + firstName : ''} — any consumables used today (rags, sealant, gloves, etc)? Reply with what, or "none".`
      pendingQuestions = ['Consumables?']
    }

    if (!reply) nextStatus = 'submitted'

    if (nextStatus === 'submitted' && !reply) {
      if (allEntries.some((e: any) => !(Number(e.hours) > 0))) {
        flags.push('job hours missing — need total hours or an out time')
      }
      reply = daySummaryReply(firstName, touchedEntriesWithOT, totalHours, totalOTHours, mergedTimeIn, flags, unknownJobs, allEntriesWithOT.length, deltaMinutes)
    }

    // Appended after whichever branch above set `reply` (lunch/consumables ask,
    // employee-not-found, or the day summary) — a mistyped am/pm on the out time
    // is worth flagging no matter what else this reply is about, and the ask
    // branches above return early before ever reaching daySummaryReply.
    if (midnightOutWarning && mergedStatedOut && reply) {
      reply += `\nHeads up — your out time (${friendlyTime(mergedStatedOut)}) is after midnight. Did you mean pm?`
    }
    if (hoursBoundsMismatch && reply) {
      reply += `\nHeads up — you said ${hoursBoundsMismatch.stated}hrs but your in/out times work out to ${hoursBoundsMismatch.bounds}hrs. Logged ${hoursBoundsMismatch.bounds}hrs — reply to correct if that's wrong.`
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
      // Silent defaults — the bot never asks about lunch/PD anymore. A tech who
      // took lunch or is staying out will say so; the office corrects the forgetters.
      lunch_minutes:      mergedLunch ?? 0,
      per_diem_location:  mergedPerDiem ?? 'none',
      calculated_time_out: calcOut,
      delta_minutes:      deltaMinutes,
      entries:            allEntriesWithOT,
      supplies:           allSupplies,
      supplies_note:      consumablesAnsweredNone ? 'none' : (submission?.supplies_note ?? null),
      pending_questions:  pendingQuestions,
      asked_questions:    Array.from(new Set([...(submission?.asked_questions || []), ...pendingQuestions])),
      raw_messages:       allMsgs,
      status:             nextStatus,
      updated_at:         new Date().toISOString(),
    }

    if (submission) {
      // Conditional on updated_at being exactly what we just read — if a concurrent
      // request already wrote since then, this matches zero rows instead of blindly
      // overwriting it, and we loop back to re-read + re-merge against the new state.
      const { data: updatedRows, error: updateErr } = await supabase
        .from('sms_submissions')
        .update(record)
        .eq('id', submission.id)
        .eq('updated_at', submission.updated_at)
        .select('id')
      if (updateErr) { saveError = updateErr; break }
      if (updatedRows && updatedRows.length > 0) { saved = true; break }
      if (attempt === MAX_SAVE_ATTEMPTS - 1) {
        // Exhausted retries under real concurrent load — save unconditionally rather
        // than drop the message entirely. Logged loudly since this should be rare;
        // if it ever fires, the retry count below probably needs raising.
        console.error(`sms_submissions: exhausted ${MAX_SAVE_ATTEMPTS} save retries for phone ${fromPhone}, saving unconditionally`)
        const { error: fallbackErr } = await supabase.from('sms_submissions').update(record).eq('id', submission.id)
        if (fallbackErr) saveError = fallbackErr
        saved = true
      }
      // else: conflict — loop back and retry against fresh state
    } else {
      const { error: insertErr } = await supabase.from('sms_submissions').insert(record)
      if (insertErr) { saveError = insertErr; break }
      saved = true
    }
  }

  if (saveError) {
    console.error('sms_submissions save failed:', saveError.message)
    const r = "Something went wrong saving that — text the office directly so it doesn't get lost."
    return isTwilio ? twiML(r) : jsonReply({ reply: r, error: saveError.message }, 500)
  }

  return isTwilio ? twiML(reply) : jsonReply({ reply, status: nextStatus, flags })
})
