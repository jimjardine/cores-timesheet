import React, { useState } from 'react'

const PASSWORD = 'Cores'
const STORAGE_KEY = 'cores_unlocked'

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)

  if (unlocked) return children

  const handleSubmit = (e) => {
    e.preventDefault()
    if (input === PASSWORD) {
      localStorage.setItem(STORAGE_KEY, 'true')
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
          type="password"
          autoFocus
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false) }}
          placeholder="Password"
          style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: `1px solid ${error ? '#c0392b' : '#ccc'}`, borderRadius: '4px', marginBottom: '0.75rem' }}
        />
        {error && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Wrong password.</div>}
        <button type="submit" style={{ width: '100%', padding: '0.5rem', border: 'none', borderRadius: '4px', background: '#0066cc', color: '#fff', cursor: 'pointer' }}>Enter</button>
      </form>
    </div>
  )
}
