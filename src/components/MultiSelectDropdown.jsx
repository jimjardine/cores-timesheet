import React, { useState, useRef, useEffect } from 'react'

// Same type-to-filter + arrow-key feel as PersonPicker.jsx, adapted for
// picking several people at once instead of one — Enter toggles the
// highlighted row's checkbox rather than picking-and-closing, since a
// multi-select stays open for more picks.
export default function MultiSelectDropdown({ options, selectedIds, onChange, placeholder = '— select —', allLabel, minWidth = 200 }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const rowRefs = useRef([])

  const label = selectedIds.length === 0
    ? placeholder
    : (allLabel && selectedIds.length === options.length && options.length > 0)
      ? allLabel
      : selectedIds.length <= 2
        ? selectedIds.map(id => options.find(o => o.id === id)?.name).filter(Boolean).join(', ')
        : `${selectedIds.length} selected`

  const q = query.trim().toLowerCase()
  const matches = !q ? options : options.filter(o => o.name.toLowerCase().includes(q))

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else { setQuery(''); setActiveIndex(-1) }
  }, [open])

  // Re-clamp whenever the filtered list changes size — otherwise a stale
  // index could point past the end, or Enter could toggle a hidden row.
  useEffect(() => {
    setActiveIndex(i => (i >= matches.length ? matches.length - 1 : i))
  }, [matches.length])

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(sid => sid !== id) : [...selectedIds, id])
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (matches.length === 0 ? -1 : i + 1 >= matches.length ? 0 : i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (matches.length === 0 ? -1 : i - 1 < 0 ? matches.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && matches[activeIndex]) toggle(matches[activeIndex].id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: `${minWidth}px`, textAlign: 'left', background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
        <span style={{ color: selectedIds.length ? '#333' : '#999' }}>{label}</span>
        <span style={{ color: '#aaa' }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: '240px', zIndex: 20 }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Type to filter…"
              onChange={e => { setQuery(e.target.value); setActiveIndex(-1) }}
              onKeyDown={handleKeyDown}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.75rem', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.85rem', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
              <button onClick={() => onChange([...new Set([...selectedIds, ...matches.map(o => o.id)])])} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Select all</button>
              <button onClick={() => onChange([])} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Clear</button>
            </div>
            <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
              {matches.length === 0 && (
                <div style={{ padding: '0.6rem 0.75rem', color: '#999', fontSize: '0.85rem' }}>No matching names</div>
              )}
              {matches.map((o, i) => (
                <label key={o.id}
                  ref={el => { rowRefs.current[i] = el }}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', cursor: 'pointer', fontSize: '0.9rem', background: i === activeIndex ? '#e6f0ff' : 'transparent' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  {o.name}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
