import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'

const PAGE_SIZE = 100

// Type-to-filter person picker — same idea as employee/JobPicker.jsx (a native
// <select> means scrolling through everyone by hand); this one just picks a
// single employee id instead of a job.
function PersonPicker({ employees, value, onChange }) {
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
        placeholder="All people"
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={e => setQuery(e.target.value)}
        style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', width: '160px' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', zIndex: 30,
          background: '#fff', border: '1px solid #ccc', borderRadius: 6, minWidth: '200px',
          maxHeight: '16rem', overflowY: 'auto', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: '0.85rem',
        }}>
          <div
            onClick={() => pick('')}
            style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', color: value ? '#333' : '#0066cc', fontWeight: value ? 400 : 600 }}
          >All people</div>
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

const fmtWorkDate = (ymd) => ymd
  ? new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  : null

// Best-effort human label for the row — most audit rows are on tables tied to
// an employee/day (timesheet_entries, sms_submissions, job_supplies), so that's
// the common case; other tables fall back to whatever name-ish field they have
// so the row still reads as something other than a bare UUID.
function describeRecord(r, employeeById) {
  const nd = r.new_data || {}
  const od = r.old_data || {}
  const employeeId = nd.employee_id ?? od.employee_id
  if (employeeId) {
    return {
      name: employeeById[employeeId] || 'Unknown employee',
      date: fmtWorkDate(nd.work_date ?? od.work_date),
    }
  }
  const name = nd.name ?? od.name ?? nd.job_number ?? od.job_number ?? null
  const date = fmtWorkDate(nd.work_date ?? od.work_date ?? nd.holiday_date ?? od.holiday_date)
  return { name, date }
}

// employee_id/work_date live inside the jsonb old_data/new_data, not as real
// columns, and a row can have either one populated (an INSERT has no old_data,
// a DELETE has no new_data) — so match "changed on this employee" as new_data
// OR old_data carrying that employee_id (same for work_date), combined with AND
// when both filters are set. Built as a single .or() string since supabase-js
// ANDs separate .or()/.eq() calls together but a second .or() call would
// overwrite the first rather than combine with it.
function buildLinkedRecordFilter(employeeId, workDate) {
  const leaf = (prefix) => {
    const parts = []
    if (employeeId) parts.push(`${prefix}->>employee_id.eq.${employeeId}`)
    if (workDate)   parts.push(`${prefix}->>work_date.eq.${workDate}`)
    if (parts.length === 0) return null
    return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`
  }
  const newLeaf = leaf('new_data')
  const oldLeaf = leaf('old_data')
  return newLeaf ? `${newLeaf},${oldLeaf}` : null
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
  const [employees, setEmployees] = useState([])

  const [tableFilter, setTableFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [recordIdSearch, setRecordIdSearch] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [workDateFilter, setWorkDateFilter] = useState('')

  useEffect(() => {
    supabase.schema('Cores').from('employees').select('id, name').order('name').then(({ data }) => setEmployees(data || []))
  }, [])
  const employeeById = Object.fromEntries(employees.map(e => [e.id, e.name]))

  const load = useCallback(async (offset, append) => {
    if (append) setLoadingMore(true); else setLoading(true)
    let query = supabase.schema('Cores').from('audit_log').select('*').order('changed_at', { ascending: false })
    if (tableFilter) query = query.eq('table_name', tableFilter)
    if (actionFilter !== 'all') query = query.eq('action', actionFilter.toUpperCase())
    if (recordIdSearch.trim()) query = query.eq('record_id', recordIdSearch.trim())
    // Filters the date the change was ABOUT (a timesheet_entries/sms_submissions/
    // job_supplies row's work_date), not changed_at (when the edit was made).
    const linkedFilter = buildLinkedRecordFilter(employeeFilter, workDateFilter)
    if (linkedFilter) query = query.or(linkedFilter)
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
    if (error) { alert('Error loading audit log: ' + error.message) }
    else {
      setRows(p => append ? [...p, ...(data || [])] : (data || []))
      setHasMore((data || []).length === PAGE_SIZE)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [tableFilter, actionFilter, recordIdSearch, employeeFilter, workDateFilter])

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
        <PersonPicker employees={employees} value={employeeFilter} onChange={setEmployeeFilter} />
        <input
          type="date"
          value={workDateFilter}
          onChange={e => setWorkDateFilter(e.target.value)}
          title="Filters by the date the change was about (e.g. a timesheet's work date) — not when the edit was made"
          style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem' }}
        />
        {(employeeFilter || workDateFilter) && (
          <button
            onClick={() => { setEmployeeFilter(''); setWorkDateFilter('') }}
            style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: '0.85rem', color: '#666' }}
          >Clear</button>
        )}
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
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Name / Date</th>
                  <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Record</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isExpanded = !!expanded[r.id]
                  const fields = isExpanded ? allFields(r.old_data, r.new_data) : []
                  const { name, date } = describeRecord(r, employeeById)
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
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: name ? '#333' : '#ccc' }}>
                          {name || '—'}{date && <span style={{ color: '#888' }}> · {date}</span>}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: '#888', fontFamily: 'monospace' }}>
                          {r.record_id?.slice(0, 8)}… <span style={{ color: '#ccc' }}>{isExpanded ? '▲' : '▼'}</span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottom: '1px solid #eee', background: '#fafafa' }}>
                          <td colSpan={5} style={{ padding: '0.75rem 1.5rem' }}>
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
