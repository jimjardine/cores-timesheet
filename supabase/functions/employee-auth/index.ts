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

const OTP_TTL_MINUTES = 10
const MAX_PIN_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

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

    const otp = randomOtp()
    const otpHash = await sha256Hex(otp)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    const { error } = await supabase.from('employee_auth').upsert(
      { employee_id: employee.id, otp_code_hash: otpHash, otp_expires_at: expiresAt, updated_at: new Date().toISOString() },
      { onConflict: 'employee_id' }
    )
    if (error) return jsonReply({ ok: false, error: `Could not start login: ${error.message}` })

    const sendResult = await sendTwilioSms(employee.phone, `Your Cores Timesheet login code is ${otp}. Expires in ${OTP_TTL_MINUTES} minutes.`)
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
    if (!authRow?.otp_code_hash || !authRow.otp_expires_at || new Date(authRow.otp_expires_at) < new Date()) {
      return jsonReply({ ok: false, error: 'Code expired — request a new one.' })
    }
    const otpHash = await sha256Hex(String(json.otp || ''))
    if (otpHash !== authRow.otp_code_hash) return jsonReply({ ok: false, error: 'Incorrect code.' })

    const salt = randomHex()
    const pinHash = await sha256Hex(`${salt}:${newPin}`)
    const { error } = await supabase.from('employee_auth').update({
      pin_hash: pinHash, pin_salt: salt,
      pin_fail_count: 0, pin_locked_until: null,
      otp_code_hash: null, otp_expires_at: null,
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

    const failCount = (authRow.pin_fail_count || 0) + 1
    const lockedUntil = failCount >= MAX_PIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString() : null
    await supabase.from('employee_auth').update({
      pin_fail_count: lockedUntil ? 0 : failCount, pin_locked_until: lockedUntil, updated_at: new Date().toISOString(),
    }).eq('employee_id', employee.id)

    return jsonReply(lockedUntil
      ? { ok: false, error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} min.` }
      : { ok: false, error: 'Incorrect PIN.', attemptsRemaining: MAX_PIN_ATTEMPTS - failCount })
  }

  return jsonReply({ ok: false, error: 'Unknown action' }, 400)
})
