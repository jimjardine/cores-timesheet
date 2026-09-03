import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Phone + 4-digit PIN login for the employee mobile self-service site (/my).
// Deliberately not Supabase Auth — matches the rest of the app's lightweight,
// pragmatic-stopgap security posture (see PasswordGate.jsx) rather than standing
// up full per-user auth infra. First-time setup and "forgot PIN" both go through
// a one-time SMS code (reusing the existing Twilio number/account) to prove
// phone ownership before a PIN can be set; routine logins after that are
// phone+PIN only, no per-login SMS cost.
//
// employee_auth is closed to anon/authenticated (see its migration) — only this
// function's service-role client can read/write it, so a leaked pin_hash isn't
// reachable through the app's otherwise wide-open RLS posture.

function jsonReply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-10)
}

// normalizePhone() always truncates to the last 10 digits, which would silently
// strip a real country code off an overseas number before we could tell it was
// there. For WhatsApp delivery we need the *un-truncated* digit count: a stored
// number with exactly 10 digits has no country code on file (Cores is NA-only
// for plain `phone`, and whatsapp_phone is meant for overseas techs but nothing
// currently stops the admin form from saving a bare 10-digit local number), so
// +1 is the right default there. Anything longer already carries a country code
// — send it through as-is rather than mangling it with a forced +1.
function toWhatsAppE164(raw: string): string {
  const trimmed = (raw || '').trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  return digits.length === 10 ? `+1${digits}` : `+${digits}`
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomOtp(): string {
  // 6 digits, 000000–999999, via a crypto-secure source
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(arr[0] % 1000000).padStart(6, '0')
}

async function sendTwilioSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return { ok: false, error: 'Twilio credentials not configured' }

  const from = '+15064046969' // existing Cores Twilio number
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

// Sends via the WhatsApp Sandbox (not the SMS number) — used for employees
// who have a whatsapp_phone on file (overseas techs who can't reliably get
// SMS), same as the request_confirmation path in sms-timesheet.
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

const OTP_TTL_MINUTES = 10
// Short and self-expiring on purpose — the crew isn't tech-savvy, and a
// mistyped PIN or code shouldn't hold anyone out of logging their hours for
// long. "Forgot your PIN?" already bypasses this instantly regardless (see
// set_pin below), so this wait is only ever the fallback for someone who
// doesn't reach for that. The real deterrent against a genuine attacker is
// the separate IP-based circuit breaker further down, not a long per-account
// lockout.
const MAX_PIN_ATTEMPTS = 5
const LOCKOUT_MINUTES = 2
const MAX_OTP_ATTEMPTS = 5
const OTP_LOCKOUT_MINUTES = 2

// ── IP-based circuit breaker ──────────────────────────────────────────────
// Catches attack-shaped traffic the per-employee lockouts above don't: an
// attacker spreading guesses across many employees, or just hammering the
// endpoint at volume. Separate from, not a replacement for, the per-employee
// lockouts — this is deliberately a blunt, longer block since it should only
// ever trip for genuinely abnormal traffic, never normal crew use.
const IP_WINDOW_MINUTES = 5
const IP_MAX_ATTEMPTS = 20
const IP_LOCKOUT_MINUTES = 30
// Jim's own phone — texted once per new IP block (not once per blocked
// request during the whole cooldown) so he knows about an attack in near
// real time without getting spammed mid-attack.
const SECURITY_ALERT_PHONE = '5068667302'

function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0].trim() || 'unknown'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'Cores' } }
  )

  let json: any
  try {
    json = await req.json()
  } catch {
    return jsonReply({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  // ── IP circuit breaker — checked before anything else for a guessable
  // action, so a blocked IP never even reaches an employee lookup. ──
  const clientIp = clientIpFrom(req)
  const isGuessableAction = json.action === 'login' || json.action === 'set_pin'

  async function recordIpFailure() {
    const { data } = await supabase.rpc('record_ip_auth_failure', {
      p_ip: clientIp, p_window_minutes: IP_WINDOW_MINUTES, p_max_attempts: IP_MAX_ATTEMPTS, p_lockout_minutes: IP_LOCKOUT_MINUTES,
    }).single()
    if (data?.is_new_block) {
      const until = new Date(data.new_blocked_until).toLocaleString('en-CA', { timeZone: 'America/Halifax', hour: 'numeric', minute: '2-digit' })
      await sendTwilioSms(SECURITY_ALERT_PHONE,
        `⚠️ Cores Timesheet: IP ${clientIp} blocked after ${data.new_fail_count} failed login/PIN attempts in ${IP_WINDOW_MINUTES} min. Blocked until ${until} AT.`)
    }
  }

  if (isGuessableAction) {
    const { data: throttle } = await supabase.from('auth_ip_throttle').select('blocked_until').eq('ip', clientIp).maybeSingle()
    if (throttle?.blocked_until && new Date(throttle.blocked_until) > new Date()) {
      return jsonReply({ ok: false, error: 'Too many attempts. Try again later.' })
    }
  }

  const phone = normalizePhone(json.phone || '')
  if (!phone) return jsonReply({ ok: false, error: 'Phone number required' }, 400)

  async function findActiveEmployee() {
    const { data } = await supabase.from('employees').select('id, name, phone, whatsapp_phone, active')
    return (data || []).find((e: any) =>
      e.active && ((e.phone && normalizePhone(e.phone) === phone) || (e.whatsapp_phone && normalizePhone(e.whatsapp_phone) === phone))
    )
  }

  // ── Request a one-time SMS code (first-time PIN setup or forgot-PIN) ──
  if (json.action === 'request_otp') {
    const employee = await findActiveEmployee()
    if (!employee) return jsonReply({ ok: false, error: 'No account found for that phone number.' })

    // Blocks re-requesting a fresh code as a way to dodge an active OTP
    // lockout below — otherwise the lockout on set_pin would be trivial to
    // route around by just asking for a new code each time.
    const { data: existingAuth } = await supabase.from('employee_auth').select('otp_locked_until').eq('employee_id', employee.id).maybeSingle()
    if (existingAuth?.otp_locked_until && new Date(existingAuth.otp_locked_until) > new Date()) {
      const minsLeft = Math.ceil((new Date(existingAuth.otp_locked_until).getTime() - Date.now()) / 60000)
      return jsonReply({ ok: false, error: `Too many attempts. Try again in ${minsLeft} min.` })
    }

    const otp = randomOtp()
    const otpHash = await sha256Hex(otp)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    const { error } = await supabase.from('employee_auth').upsert(
      { employee_id: employee.id, otp_code_hash: otpHash, otp_expires_at: expiresAt, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id' }
    )
    if (error) return jsonReply({ ok: false, error: `Could not start login: ${error.message}` })

    const codeMsg = `Your Cores Timesheet login code is ${otp}. Expires in ${OTP_TTL_MINUTES} minutes.`
    const sendResult = employee.whatsapp_phone
      ? await sendTwilioWhatsApp(toWhatsAppE164(employee.whatsapp_phone), codeMsg)
      : await sendTwilioSms(employee.phone, codeMsg)
    if (!sendResult.ok) return jsonReply({ ok: false, error: `Couldn't send the code: ${sendResult.error}` })

    return jsonReply({ ok: true })
  }

  // ── Verify the SMS code and set a new PIN ──
  if (json.action === 'set_pin') {
    const newPin = String(json.new_pin || '')
    if (!/^\d{4}$/.test(newPin)) return jsonReply({ ok: false, error: 'PIN must be 4 digits' }, 400)

    const employee = await findActiveEmployee()
    if (!employee) return jsonReply({ ok: false, error: 'No account found for that phone number.' })

    const { data: authRow } = await supabase.from('employee_auth').select('*').eq('employee_id', employee.id).single()

    if (authRow?.otp_locked_until && new Date(authRow.otp_locked_until) > new Date()) {
      const minsLeft = Math.ceil((new Date(authRow.otp_locked_until).getTime() - Date.now()) / 60000)
      return jsonReply({ ok: false, error: `Too many attempts. Try again in ${minsLeft} min.` })
    }

    if (!authRow?.otp_code_hash || !authRow.otp_expires_at || new Date(authRow.otp_expires_at) < new Date()) {
      return jsonReply({ ok: false, error: 'Code expired — request a new one.' })
    }
    const otpHash = await sha256Hex(String(json.otp || ''))
    if (otpHash !== authRow.otp_code_hash) {
      // Same "atomic increment, alert once on a new IP-wide block" pattern
      // as login's wrong-PIN path below — see record_otp_failure's migration
      // comment for why the naive read-then-write version this replaced
      // could let concurrent guesses dodge the lockout.
      const { data: otpFail } = await supabase.rpc('record_otp_failure', {
        p_employee_id: employee.id, p_max_attempts: MAX_OTP_ATTEMPTS, p_lockout_minutes: OTP_LOCKOUT_MINUTES,
      }).single()
      await recordIpFailure()
      return jsonReply(otpFail?.new_locked_until
        ? { ok: false, error: `Too many attempts. Try again in ${OTP_LOCKOUT_MINUTES} min.` }
        : { ok: false, error: 'Incorrect code.' })
    }

    const salt = randomHex()
    const pinHash = await sha256Hex(`${salt}:${newPin}`)
    const { error } = await supabase.from('employee_auth').update({
      pin_hash: pinHash, pin_salt: salt,
      pin_fail_count: 0, pin_locked_until: null,
      otp_code_hash: null, otp_expires_at: null,
      otp_fail_count: 0, otp_locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq('employee_id', employee.id)
    if (error) return jsonReply({ ok: false, error: `Could not save PIN: ${error.message}` })

    return jsonReply({ ok: true, employee: { id: employee.id, name: employee.name } })
  }

  // ── Log in with phone + PIN ──
  if (json.action === 'login') {
    const employee = await findActiveEmployee()
    if (!employee) return jsonReply({ ok: false, error: 'No account found for that phone number.' })

    const { data: authRow } = await supabase.from('employee_auth').select('*').eq('employee_id', employee.id).single()
    if (!authRow?.pin_hash) return jsonReply({ ok: true, needs_setup: true })

    if (authRow.pin_locked_until && new Date(authRow.pin_locked_until) > new Date()) {
      const minsLeft = Math.ceil((new Date(authRow.pin_locked_until).getTime() - Date.now()) / 60000)
      return jsonReply({ ok: false, error: `Too many attempts. Try again in ${minsLeft} min.` })
    }

    const pin = String(json.pin || '')
    const candidateHash = await sha256Hex(`${authRow.pin_salt}:${pin}`)

    if (candidateHash === authRow.pin_hash) {
      await supabase.from('employee_auth').update({
        pin_fail_count: 0, pin_locked_until: null, updated_at: new Date().toISOString(),
      }).eq('employee_id', employee.id)
      return jsonReply({ ok: true, employee: { id: employee.id, name: employee.name } })
    }

    // Atomic increment (see record_pin_failure's migration comment) — the
    // old version here read pin_fail_count, added 1 in JS, then wrote it
    // back, which let concurrent guesses race past the lockout.
    const { data: pinFail } = await supabase.rpc('record_pin_failure', {
      p_employee_id: employee.id, p_max_attempts: MAX_PIN_ATTEMPTS, p_lockout_minutes: LOCKOUT_MINUTES,
    }).single()
    await recordIpFailure()

    return jsonReply(pinFail?.new_locked_until
      ? { ok: false, error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} min.` }
      : { ok: false, error: 'Incorrect PIN.', attemptsRemaining: MAX_PIN_ATTEMPTS - (pinFail?.new_fail_count ?? 0) })
  }

  return jsonReply({ ok: false, error: 'Unknown action' }, 400)
})
