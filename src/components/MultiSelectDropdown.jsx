import React, { useState } from 'react'

export default function MultiSelectDropdown({ options, selectedIds, onChange, placeholder = '— select —', allLabel, minWidth = 200 }) {
  const [open, setOpen] = useState(false)
  const label = selectedIds.length === 0
    ? placeholder
    : (allLabel && selectedIds.length === options.length && options.length > 0)
      ? allLabel
      : selectedIds.length <= 2
        ? selectedIds.map(id => options.find(o => o.id === id)?.name).filter(Boolean).join(', ')
        : `${selectedIds.length} selected`

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: `${minWidth}px`, textAlign: 'left', background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
        <span style={{ color: selectedIds.length ? '#333' : '#999' }}>{label}</span>
        <span style={{ color: '#aaa' }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: '240px', maxHeight: '320px', overflowY: 'auto', zIndex: 20 }}>
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
              <button onClick={() => onChange(options.map(o => o.id))} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Select all</button>
              <button onClick={() => onChange([])} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Clear</button>
            </div>
            {options.map(o => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(o.id)}
                  onChange={e => onChange(e.target.checked ? [...selectedIds, o.id] : selectedIds.filter(id => id !== o.id))}
                />
                {o.name}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
