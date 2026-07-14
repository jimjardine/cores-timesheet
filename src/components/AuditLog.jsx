import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

const PAGE_SIZE = 100

const TABLES = [
  'employees', 'customers', 'vessels', 'jobs', 'job_tasks', 'timesheet_entries',
  'payroll_config', 'stat_holidays', 'job_status_logs', 'vessel_contacts',
  'sms_submissions', 'job_supplies', 'gear_photos', 'weekly_summary_posted',
]

const ACTION_COLORS = {
  INSERT: '#2a7a2a',
  UPDATE: '#0066cc',
  DELETE: '#c00',
}

const fmtWhen = (ts) => {
  const d = new Date(ts)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const fmtVal = (v) => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Every field on the row, old value and new value side by side — not just the ones
// that changed, so nothing is hidden behind a diff algorithm's judgment call.
function allFields(oldData, newData) {
  const keys = [...new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})])].sort()
  return keys.map(k => {
    const from = oldData ? oldData[k] : undefined
    const to = newData ? newData[k] : undefined
    return { key: k, from, to, changed: JSON.stringify(from) !== JSON.stringify(to) }
  })
}

export default function AuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [expanded, setExpanded] = useState({})

  const [tableFilter, setTableFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [recordIdSearch, setRecordIdSearch] = useState('')

  const load = useCallback(async (offset, append) => {
    if (append) setLoadingMore(true); else setLoading(true)
    let query = supabase.schema('Cores').from('audit_log').select('*').order('changed_at', { ascending: false })
    if (tableFilter) query = query.eq('table_name', tableFilter)
    if (actionFilter !== 'all') query = query.eq('action', actionFilter.toUpperCase())
    if (recordIdSearch.trim()) query = query.eq('record_id', recordIdSearch.trim())
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
    if (error) { alert('Error loading audit log: ' + error.message) }
    else {
      setRows(p => append ? [...p, ...(data || [])] : (data || []))
      setHasMore((data || []).length === PAGE_SIZE)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [tableFilter, actionFilter, recordIdSearch])

  useEffect(() => { load(0, false) }, [load])

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  const filterBtn = (key, label) => (
    <button
      onClick={() => setActionFilter(key)}
      style={{
        padding: '0.4rem 0.9rem', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
        background: actionFilter === key ? '#0066cc' : '#fff',
        color: actionFilter === key ? '#fff' : '#333',
        borderColor: actionFilter === key ? '#0066cc' : '#ccc',
      }}
    >{label}</button>
  )

  return (
    <div style={{ padding: '1.5rem 2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Audit Log</h2>
        <select
          value={tableFilter}
          onChange={e => setTableFilter(e.target.value)}
          style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem' }}
        >
          <option value="">All tables</option>
          {TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={recordIdSearch}
          onChange={e => setRecordIdSearch(e.target.value)}
          placeholder="Search record ID..."
          style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', minWidth: 220 }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {filterBtn('all', 'All')}
          {filterBtn('insert', 'Insert')}
          {filterBtn('update', 'Update')}
          {filterBtn('delete', 'Delete')}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '3rem' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '3rem', border: '2px dashed #ddd', borderRadius: 8 }}>
          No matching audit entries
        </div>
      ) : (
        <>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>When</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Table</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Action</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Record</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isExpanded = !!expanded[r.id]
                  const fields = isExpanded ? allFields(r.old_data, r.new_data) : []
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        onClick={() => toggle(r.id)}
                        style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f9fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#555', whiteSpace: 'nowrap' }} title={r.changed_at}>
                          {fmtWhen(r.changed_at)}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600 }}>{r.table_name}</td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <span style={{
                            fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 600,
                            background: (ACTION_COLORS[r.action] || '#888') + '22', color: ACTION_COLORS[r.action] || '#888',
                            border: `1px solid ${(ACTION_COLORS[r.action] || '#888')}44`,
                          }}>{r.action}</span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: '#888', fontFamily: 'monospace' }}>
                          {r.record_id?.slice(0, 8)}… <span style={{ color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottom: '1px solid #eee', background: '#fafafa' }}>
                          <td colSpan={4} style={{ padding: '0.75rem 1.5rem' }}>
                            {fields.length === 0 ? (
                              <div style={{ color: '#888', fontSize: '0.85rem' }}>No fields recorded</div>
                            ) : (
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
                            )}
                            <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '0.75rem', fontFamily: 'monospace' }}>
                              record_id: {r.record_id}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                onClick={() => load(rows.length, true)}
                disabled={loadingMore}
                style={{ padding: '0.5rem 1.2rem', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
              >{loadingMore ? 'Loading…' : 'Load more'}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
