import React, { useState, useEffect, useRef } from 'react'

// Type-to-filter person picker — same idea as employee/JobPicker.jsx (a native
// <select> means scrolling through everyone by hand); this one just picks a
// single employee id instead of a job.
//
// allowClear=true adds a pinned "All people" option that picks '' (used for
// filter dropdowns); allowClear=false is for a required field like "which
// employee is this entry for" — no all/none option, must pick someone.
export default function PersonPicker({ employees, value, onChange, allowClear = true, placeholder, inputStyle }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  const selected = employees.find(e => e.id === value)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = !q ? employees : employees.filter(e => e.name.toLowerCase().includes(q))

  function pick(id) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  const displayValue = open ? query : (selected ? selected.name : '')

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={displayValue}
        placeholder={placeholder ?? (allowClear ? 'All people' : 'Type a name…')}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => setQuery(e.target.value)}
        style={inputStyle || { padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', width: '160px' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', zIndex: 30,
          background: '#fff', border: '1px solid #ccc', borderRadius: 6, minWidth: '200px',
          maxHeight: '16rem', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: '0.85rem',
        }}>
          {allowClear && (
            <div
              onClick={() => pick('')}
              style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', color: value ? '#333' : '#0066cc', fontWeight: value ? 400 : 600 }}
            >All people</div>
          )}
          {matches.length === 0 && (
            <div style={{ padding: '0.6rem 0.75rem', color: '#999' }}>No matching names</div>
          )}
          {matches.map(e => (
            <div key={e.id}
              onClick={() => pick(e.id)}
              style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: e.id === value ? '#f0f6ff' : 'transparent' }}
            >{e.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}
