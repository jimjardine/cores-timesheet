import React, { useState, useEffect, useRef } from 'react'

// Type-to-filter person picker — same idea as employee/JobPicker.jsx (a native
// <select> means scrolling through everyone by hand); this one just picks a
// single employee id instead of a job.
//
// allowClear=true adds a pinned "All people" option that picks '' (used for
// filter dropdowns); allowClear=false is for a required field like "which
// employee is this entry for" — no all/none option, must pick someone.
export default function PersonPicker({ employees, value, onChange, allowClear = true, placeholder, inputStyle, clearLabel = 'All people', onQueryChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Index into the flat list actually on screen (clearOption first, if any,
  // then matches) — kept as a plain index rather than an id so ArrowDown/Up
  // don't need to care which row is the pinned clear option.
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)
  const rowRefs = useRef([])

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
  // Same order the dropdown renders in — what ArrowDown/Up walk and what
  // Enter picks from.
  const rows = allowClear ? [{ id: '', name: clearLabel }, ...matches] : matches

  // Re-clamp whenever the visible rows change size (typing narrows the list) —
  // otherwise a stale index could point past the end, or Enter could pick
  // a row that's no longer shown.
  useEffect(() => {
    setActiveIndex(i => (i >= rows.length ? rows.length - 1 : i))
  }, [rows.length])

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function pick(id) {
    onChange(id)
    setQuery('')
    onQueryChange?.('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setOpen(true); setActiveIndex(0) }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1 >= rows.length ? 0 : i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 < 0 ? rows.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && rows[activeIndex]) pick(rows[activeIndex].id)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  // Closing without picking (e.g. clicking away) keeps what was typed visible —
  // it shouldn't look cleared when a caller may still be live-filtering on it.
  const displayValue = selected ? (open ? query : selected.name) : query

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={displayValue}
        placeholder={placeholder ?? (allowClear ? 'All people' : 'Type a name…')}
        onFocus={() => { setOpen(true); setQuery(''); onQueryChange?.(''); setActiveIndex(-1) }}
        onChange={e => { setQuery(e.target.value); onQueryChange?.(e.target.value); setActiveIndex(-1) }}
        onKeyDown={handleKeyDown}
        style={inputStyle || { padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', width: '160px' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', zIndex: 30,
          background: '#fff', border: '1px solid #ccc', borderRadius: 6, minWidth: '200px',
          maxHeight: '16rem', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: '0.85rem',
        }}>
          {matches.length === 0 && (
            <div style={{ padding: '0.6rem 0.75rem', color: '#999' }}>No matching names</div>
          )}
          {rows.map((r, i) => (
            <div key={r.id || '__clear__'}
              ref={el => { rowRefs.current[i] = el }}
              onClick={() => pick(r.id)}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: '0.5rem 0.75rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                background: i === activeIndex ? '#e6f0ff' : (r.id === value ? '#f0f6ff' : 'transparent'),
                color: allowClear && r.id === '' ? (value ? '#333' : '#0066cc') : undefined,
                fontWeight: allowClear && r.id === '' ? (value ? 400 : 600) : undefined,
              }}
            >{r.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}
