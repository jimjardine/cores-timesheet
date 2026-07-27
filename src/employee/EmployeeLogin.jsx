import React, { useState } from 'react'
import { callEmployeeAuth } from './authApi'
import './employee.css'

// Single phone+PIN form for returning users. If the phone has no PIN set yet
// (first time, or after "forgot PIN"), the server tells us via needs_setup and
// we drop straight into the OTP + set-new-PIN flow instead of a bare error.
export default function EmployeeLogin({ onLogin }) {
  const [step, setStep] = useState('login') // 'login' | 'otp'
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [otp, setOtp] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitLogin(e) {
    e.preventDefault()
    setError(''); setInfo(''); setBusy(true)
    const res = await callEmployeeAuth('login', { phone, pin })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Login failed'); return }
    if (res.needs_setup) {
      await startOtp(true)
      return
    }
    onLogin(res.employee)
  }

  async function startOtp(isFirstTime) {
    setError(''); setBusy(true)
    const res = await callEmployeeAuth('request_otp', { phone })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not send code'); return }
    setInfo(isFirstTime
      ? "First time here — we texted you a 6-digit code to set up your PIN."
      : "We texted you a 6-digit code to reset your PIN.")
    setStep('otp')
  }

  async function submitSetPin(e) {
    e.preventDefault()
    setError('')
    if (!/^\d{4}$/.test(newPin)) { setError('PIN must be exactly 4 digits'); return }
    if (newPin !== newPin2) { setError("PINs don't match"); return }
    setBusy(true)
    const res = await callEmployeeAuth('set_pin', { phone, otp, new_pin: newPin })
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not set PIN'); return }
    onLogin(res.employee)
  }

  if (step === 'otp') {
    return (
      <div className="emp-login-wrap">
        <div className="emp-login-card">
          <div className="emp-login-title">Set your PIN</div>
          <div className="emp-login-sub">{info}</div>
          {error && <div className="emp-error">{error}</div>}
          <form onSubmit={submitSetPin}>
            <div className="emp-field">
              <label>6-digit code</label>
              <input type="tel" inputMode="numeric" autoFocus maxLength={6}
                value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="emp-field">
              <label>New 4-digit PIN</label>
              <input type="tel" inputMode="numeric" maxLength={4}
                value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="emp-field">
              <label>Confirm PIN</label>
              <input type="tel" inputMode="numeric" maxLength={4}
                value={newPin2} onChange={e => setNewPin2(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button className="emp-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save PIN & log in'}</button>
            <button type="button" className="emp-inline-link" style={{ marginTop: '0.9rem' }}
              onClick={() => { setStep('login'); setError(''); setInfo('') }}>Back</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="emp-login-wrap">
      <div className="emp-login-card">
        <div className="emp-login-title">Cores Worldwide</div>
        <div className="emp-login-sub">Log in to see and edit your timesheet.</div>
        {error && <div className="emp-error">{error}</div>}
        <form onSubmit={submitLogin}>
          <div className="emp-field">
            <label>Phone number</label>
            <input type="tel" inputMode="tel" autoFocus placeholder="902 555 0123"
              value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="emp-field">
            <label>PIN</label>
            <input type="password" inputMode="numeric" maxLength={4}
              value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
          </div>
          <button className="emp-btn" type="submit" disabled={busy || !phone}>{busy ? 'Checking…' : 'Log in'}</button>
          <button type="button" className="emp-inline-link" style={{ marginTop: '0.9rem' }}
            disabled={!phone || busy}
            onClick={() => startOtp(false)}>Forgot your PIN?</button>
        </form>
      </div>
    </div>
  )
}
