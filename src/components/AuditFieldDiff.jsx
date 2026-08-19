import React from 'react'

const fmtVal = (v) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Every field on the row, old value and new value side by side — not just the
// ones that changed, so nothing is hidden behind a diff algorithm's judgment
// call. Shared between the Audit Log table's expandable row and the timeline's
// "view raw" affordance so they never fork.
export function allFields(oldData, newData) {
  const keys = [...new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})])].sort()
  return keys.map(k => {
    const from = oldData ? oldData[k] : undefined
    const to = newData ? newData[k] : undefined
    return { key: k, from, to, changed: JSON.stringify(from) !== JSON.stringify(to) }
  })
}

export default function AuditFieldDiff({ oldData, newData }) {
  const fields = allFields(oldData, newData)
  if (fields.length === 0) return <div style={{ color: '#888', fontSize: '0.85rem' }}>No fields recorded</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', fontFamily: 'monospace' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '0.2rem 0.6rem 0.2rem 0', color: '#aaa', fontWeight: 600, fontFamily: 'ui-sans-serif, sans-serif', fontSize: '0.72rem', textTransform: 'uppercase' }}>Field</th>
          <th style={{ textAlign: 'left', padding: '0.2rem 0.6rem', color: '#aaa', fontWeight: 600, fontFamily: 'ui-sans-serif, sans-serif', fontSize: '0.72rem', textTransform: 'uppercase' }}>Old Value</th>
          <th style={{ textAlign: 'left', padding: '0.2rem 0.6rem', color: '#aaa', fontWeight: 600, fontFamily: 'ui-sans-serif, sans-serif', fontSize: '0.72rem', textTransform: 'uppercase' }}>New Value</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(f => (
          <tr key={f.key} style={{ background: f.changed ? '#fff8e1' : 'transparent' }}>
            <td style={{ padding: '0.25rem 0.6rem 0.25rem 0', color: f.changed ? '#333' : '#aaa', fontWeight: f.changed ? 600 : 400, whiteSpace: 'nowrap' }}>{f.key}</td>
            <td style={{ padding: '0.25rem 0.6rem', color: f.changed ? '#c00' : '#aaa' }}>{fmtVal(f.from)}</td>
            <td style={{ padding: '0.25rem 0.6rem', color: f.changed ? '#2a7a2a' : '#aaa', fontWeight: f.changed ? 600 : 400 }}>{fmtVal(f.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
