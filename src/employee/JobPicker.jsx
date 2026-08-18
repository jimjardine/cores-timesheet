import React, { useState, useRef, useEffect } from 'react'

// Type-to-filter job picker. A native <select> can't be typed into on iOS —
// its wheel picker has no keyboard at all, so finding a job means scrolling
// through 50+ options by hand. This is a text input + tap-list instead:
// start typing a job number (or vessel name) and it filters down live.
export default function JobPicker({ jobs, value, onChange, placeholder = 'Type a job # to search…' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const selectedJob = jobs.find(j => j.id === value || j.job_number === value)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [])

  const q = query.trim().toLowerCase()
  const matches = !q ? jobs.slice(0, 40) : jobs.filter(j => {
    const num = j.job_number.toLowerCase()
    return num.startsWith(q) || num.includes(q)
      || (j.vessels?.name || '').toLowerCase().includes(q)
      || (j.description || '').toLowerCase().includes(q)
  }).slice(0, 40)

  function pick(job) {
    onChange(job)
    setQuery('')
    setOpen(false)
  }

  const displayValue = open ? query : (selectedJob ? `${selectedJob.job_number} — ${selectedJob.vessels?.name || selectedJob.description || ''}` : '')

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        inputMode="search"
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => setQuery(e.target.value)}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '0.25rem', zIndex: 30,
          background: '#fff', border: '1px solid #ccc', borderRadius: '8px',
          maxHeight: '13rem', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        }}>
          {matches.length === 0 && (
            <div style={{ padding: '0.7rem 0.8rem', color: '#999', fontSize: '0.85rem' }}>No matching jobs</div>
          )}
          {matches.map(j => (
            <div key={j.id}
              onClick={() => pick(j)}
              style={{ padding: '0.65rem 0.8rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', fontSize: '0.92rem' }}>
              <strong>{j.job_number}</strong> — {j.vessels?.name || j.description}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
