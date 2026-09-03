import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'

// Type-to-filter picker over any simple {id, name} lookup table (component
// types, engine types, ...), with inline "add new" when nothing matches —
// same interaction pattern as PersonPicker/JobPicker. The point is
// convergence: pick what already exists instead of typing a slightly
// different spelling each time ("piston" vs "Piston" vs "pistons"), but a
// genuinely new value can still be added without leaving this field.
export default function LookupPicker({ table, types, value, onChange, onTypeCreated, placeholder = 'Type to search…' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef(null)
  const rowRefs = useRef([])

  const selected = types.find(t => t.id === value)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = !q ? types : types.filter(t => t.name.toLowerCase().includes(q))
  const exactMatch = q && types.some(t => t.name.toLowerCase() === q)
  const canCreate = q.length > 0 && !exactMatch
  const rows = canCreate ? [...matches, { id: '__create__', name: query.trim() }] : matches

  useEffect(() => {
    setActiveIndex(i => (i >= rows.length ? rows.length - 1 : i))
  }, [rows.length])

  useEffect(() => {
    if (activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  async function pick(row) {
    if (row.id === '__create__') {
      const name = row.name
      setCreating(true)
      const { data, error } = await supabase.schema('Cores').from(table).insert({ name }).select().single()
      if (error) {
        // Someone else may have just added the exact same name — re-fetch and
        // use it instead of failing outright.
        const { data: existing } = await supabase.schema('Cores').from(table).select('*').ilike('name', name).maybeSingle()
        setCreating(false)
        if (existing) {
          onTypeCreated?.(existing)
          onChange(existing.id)
          setQuery(''); setOpen(false); setActiveIndex(-1)
          return
        }
        alert('Error adding: ' + error.message)
        return
      }
      setCreating(false)
      onTypeCreated?.(data)
      onChange(data.id)
      setQuery(''); setOpen(false); setActiveIndex(-1)
      return
    }
    onChange(row.id)
    setQuery(''); setOpen(false); setActiveIndex(-1)
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
      if (activeIndex >= 0 && rows[activeIndex]) pick(rows[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  const displayValue = selected ? (open ? query : selected.name) : query

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={displayValue}
        placeholder={placeholder}
        disabled={creating}
        onFocus={() => { setOpen(true); setQuery(''); setActiveIndex(-1) }}
        onChange={e => { setQuery(e.target.value); setActiveIndex(-1) }}
        onKeyDown={handleKeyDown}
        style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', zIndex: 30,
          background: '#fff', border: '1px solid #ccc', borderRadius: 6, minWidth: '220px',
          maxHeight: '16rem', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: '0.85rem',
        }}>
          {rows.length === 0 && (
            <div style={{ padding: '0.6rem 0.75rem', color: '#999' }}>Start typing to add a new one</div>
          )}
          {rows.map((r, i) => (
            <div key={r.id}
              ref={el => { rowRefs.current[i] = el }}
              onClick={() => pick(r)}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: '0.5rem 0.75rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                background: i === activeIndex ? '#e6f0ff' : (r.id === value ? '#f0f6ff' : 'transparent'),
                color: r.id === '__create__' ? '#0066cc' : undefined,
                fontWeight: r.id === '__create__' ? 600 : undefined,
              }}
            >{r.id === '__create__' ? `+ Add "${r.name}"` : r.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}
