import React, { useState } from 'react'

const PASSWORD = 'Cores'
const STORAGE_KEY = 'cores_unlocked'
const NAME_STORAGE_KEY = 'cores_admin_name'

// The office login is a single shared password (no per-admin accounts), but
// approvals need to be attributed to whoever is actually at the keyboard —
// so we also collect a name and stamp it on approvals (see the
// approved_by_name writes in SmsReview.jsx / AdminDashboard.jsx) instead of
// a hardcoded name.
export function getAdminName() {
  return localStorage.getItem(NAME_STORAGE_KEY) || ''
}

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')
  const [name, setName] = useState(() => getAdminName())
  const [input, setInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [error, setError] = useState(false)

  if (unlocked && name) return children

  // Already unlocked on this device but no name on file yet (e.g. existing
  // session from before name capture shipped) — just ask for the name.
  const needsNameOnly = unlocked && !name

  const handleSubmit = (e) => {
    e.preventDefault()
    if (needsNameOnly) {
      if (!nameInput.trim()) return
      localStorage.setItem(NAME_STORAGE_KEY, nameInput.trim())
      setName(nameInput.trim())
      return
    }
    if (input === PASSWORD && nameInput.trim()) {
      localStorage.setItem(STORAGE_KEY, 'true')
      localStorage.setItem(NAME_STORAGE_KEY, nameInput.trim())
      setName(nameInput.trim())
      setUnlocked(true)
    } else {
      setError(true)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e' }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: '2rem', borderRadius: '8px', width: '280px' }}>
        <div style={{ fontWeight: 700, marginBottom: '1rem' }}>Cores Worldwide</div>
        <input
          type="text"
          autoFocus
          value={nameInput}
          onChange={(e) => { setNameInput(e.target.value); setError(false) }}
          placeholder="Your name"
          style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: `1px solid ${error ? '#c0392b' : '#ccc'}`, borderRadius: '4px', marginBottom: '0.75rem' }}
        />
        {!needsNameOnly && (
          <input
            type="password"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(false) }}
            placeholder="Password"
            style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: `1px solid ${error ? '#c0392b' : '#ccc'}`, borderRadius: '4px', marginBottom: '0.75rem' }}
          />
        )}
        {error && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Wrong password.</div>}
        <button type="submit" style={{ width: '100%', padding: '0.5rem', border: 'none', borderRadius: '4px', background: '#0066cc', color: '#fff', cursor: 'pointer' }}>Enter</button>
      </form>
    </div>
  )
}
