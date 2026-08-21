import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import PersonPicker from './PersonPicker'
import AuditFieldDiff from './AuditFieldDiff'
import AuditTimeline from './AuditTimeline'

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

export default function AuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])

  const [tableFilter, setTableFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [recordIdSearch, setRecordIdSearch] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [workDateFilter, setWorkDateFilter] = useState('')
  // Only meaningful once both filters narrow to one person's one day — "all of
  // Robin's history" or "everyone on Tuesday" isn't a linear story. Gated at
  // render time rather than reset on filter change, so it doesn't need its own
  // effect — it just quietly falls back to the table if the filters loosen.
  const [viewMode, setViewMode] = useState('table')
  const timelineEligible = !!(employeeFilter && workDateFilter)

  useEffect(() => {
    supabase.schema('Cores').from('employees').select('id, name').order('name').then(({ data }) => setEmployees(data || []))
    // timesheet_entries audit snapshots only carry job_id (a uuid) — this is
    // just to render a real job number in the timeline's detail lines.
    supabase.schema('Cores').from('jobs').select('id, job_number').then(({ data }) => setJobs(data || []))
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
        {timelineEligible && (
          <button
            onClick={() => setViewMode(m => m === 'timeline' ? 'table' : 'timeline')}
            title="A chronological story for this person's day — texted in, approved, edited, etc."
            style={{
              padding: '0.4rem 0.7rem', border: '1px solid #0066cc', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              background: viewMode === 'timeline' ? '#0066cc' : '#fff', color: viewMode === 'timeline' ? '#fff' : '#0066cc',
            }}
          >{viewMode === 'timeline' ? '☰ Table view' : '🕓 Timeline view'}</button>
        )}
        <input
          value={recordIdSearch}
          onChange={e => setRecordIdSearch(e.target.value)}
          placeholder="Search record ID..."
          style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', minWidth: 220 }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {filterBtn('all', 'All')}
          {filterBtn('insert', 'Inserted')}
          {filterBtn('update', 'Updated')}
          {filterBtn('delete', 'Deleted')}
        </div>
      </div>

      {viewMode === 'timeline' && timelineEligible ? (
        <AuditTimeline rows={rows} employees={employees} jobs={jobs} loading={loading} hasMore={hasMore} />
      ) : loading ? (
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
                            <AuditFieldDiff oldData={r.old_data} newData={r.new_data} />
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
