import React, { useState } from 'react'
import AuditFieldDiff, { allFields } from './AuditFieldDiff'

// One dot color/icon per semantic event category — reuses the same hues the
// rest of the app already uses for these concepts (SmsReview's STATUS_COLORS
// for approved/rejected, its note-badge indigo) rather than inventing a new
// palette. "Office" events (no actor signal available) are deliberately
// muted/gray so a low-confidence attribution doesn't visually read the same
// as a confirmed one.
const EVENT_STYLE = {
  employee:   { color: '#0066cc', bg: '#e8f1fc', icon: '📱' },
  approved:   { color: '#2a7a2a', bg: '#e8f5e9', icon: '✅' },
  declined:   { color: '#cc2222', bg: '#fdecea', icon: '⛔' },
  officeEdit: { color: '#888',    bg: '#f0f0f0', icon: '✏️' },
  officeNote: { color: '#3949ab', bg: '#eef2ff', icon: '📝' },
  manualAdd:  { color: '#777',    bg: '#f0f0f0', icon: '➕' },
  delete:     { color: '#cc2222', bg: '#fdecea', icon: '🗑️' },
  botReply:   { color: '#aaa',    bg: '#f5f5f5', icon: '🤖' },
  fallback:   { color: '#aaa',    bg: '#f5f5f5', icon: '•' },
}

const fmtTime = (ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const fmtValShort = (v) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function truncate(text, n = 100) {
  if (!text) return ''
  return text.length > n ? text.slice(0, n) + '…' : text
}

// One INSERT-batch approval writes one timesheet_entries row per job (plus any
// job_supplies rows) in a single multi-row .insert() — Postgres now() is
// stable within one statement, so every row the audit trigger captures from
// that call shares the exact same changed_at. That makes exact-match grouping
// on (action, changed_at, employee_id, work_date) safe — no fuzzy time-window
// matching needed, and it can't accidentally merge two genuinely separate
// single-row inserts (e.g. an office manual add) that just happen to be close
// in time, since those never share an identical timestamp.
function groupingKey(row) {
  if (row.action !== 'INSERT') return null
  if (row.table_name !== 'timesheet_entries' && row.table_name !== 'job_supplies') return null
  const nd = row.new_data || {}
  if (!nd.employee_id || !nd.work_date) return null
  return `${row.action}|${row.changed_at}|${nd.employee_id}|${nd.work_date}`
}

function groupAuditRows(rowsAsc) {
  const groups = []
  const byKey = new Map()
  for (const row of rowsAsc) {
    const key = groupingKey(row)
    if (key && byKey.has(key)) {
      byKey.get(key).rows.push(row)
    } else {
      const group = { key, rows: [row], changed_at: row.changed_at }
      groups.push(group)
      if (key) byKey.set(key, group)
    }
  }
  return groups
}

// The one seam for "who did this." Today it's either a stamped admin name
// (getAdminName(), captured at approval time) or the employee's own name
// resolved from employee_id — there's no per-admin login yet, so most office
// actions (edit, reject, note) genuinely have no actor to show. When real
// admin login ships and a changed_by-style field exists, this is the only
// function that needs to change.
function resolveActor({ source, name, employeeId, employeeById }) {
  if (source === 'admin') return name || null
  if (source === 'employee') return employeeById[employeeId] || null
  return null
}

// A same-day sms_submissions row never stores who approved it — only the
// timesheet_entries rows created by that approval carry approved_by_name.
// Best-effort correlate by employee_id+work_date and nearest timestamp (there
// is no direct foreign key between the two tables at all).
function findApproverName(allRowsForDay, employeeId, workDate, aroundTs) {
  const t = new Date(aroundTs).getTime()
  const candidates = allRowsForDay.filter(r =>
    r.table_name === 'timesheet_entries' && r.action === 'INSERT' &&
    r.new_data?.employee_id === employeeId && r.new_data?.work_date === workDate && r.new_data?.approved_by_name)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => Math.abs(new Date(a.changed_at) - t) - Math.abs(new Date(b.changed_at) - t))
  return candidates[0].new_data.approved_by_name
}

const FIELD_LABELS = {
  hours: 'hours', per_diem: 'per diem', description: 'description', job_id: 'job',
  time_in: 'time in', stated_time_out: 'time out', lunch_minutes: 'lunch',
  per_diem_location: 'per diem', entries: 'jobs', status: 'status',
}
const NOISE_FIELDS = new Set(['updated_at', 'created_at', 'raw_messages', 'pending_questions', 'asked_questions', 'calculated_time_out', 'delta_minutes'])

// Priority fields surface first — per_diem/hours are the motivating case (an
// admin zeroing out per diem is exactly the kind of change someone would come
// to this timeline looking for).
function summarizeChanges(oldData, newData, priority = ['per_diem', 'per_diem_location', 'hours', 'entries']) {
  const fields = allFields(oldData, newData).filter(f => f.changed && !NOISE_FIELDS.has(f.key))
  fields.sort((a, b) => {
    const pa = priority.indexOf(a.key), pb = priority.indexOf(b.key)
    if (pa === -1 && pb === -1) return 0
    if (pa === -1) return 1
    if (pb === -1) return -1
    return pa - pb
  })
  if (fields.length === 0) return null
  return fields.map(f => `${FIELD_LABELS[f.key] || f.key}: ${fmtValShort(f.from)} → ${fmtValShort(f.to)}`).join(', ')
}

function resolveTimelineEvent(group, allRowsForDay, employeeById, jobById) {
  const row = group.rows[0]
  const nd = row.new_data || {}
  const od = row.old_data || {}
  const employeeId = nd.employee_id ?? od.employee_id
  const workDate = nd.work_date ?? od.work_date
  const employeeName = employeeById[employeeId] || 'Someone'
  let verb = null, detail = null, actor = null, style = EVENT_STYLE.fallback

  if (row.table_name === 'timesheet_entries') {
    if (row.action === 'INSERT') {
      const jobRows = group.rows.filter(r => r.table_name === 'timesheet_entries')
      const supplyRows = group.rows.filter(r => r.table_name === 'job_supplies')
      const entrySource = jobRows[0]?.new_data?.entry_source
      const approvedBy = jobRows[0]?.new_data?.approved_by_name
      const n = jobRows.length
      if (entrySource === 'sms') { verb = `Approved ${n} job${n === 1 ? '' : 's'} into the timesheet`; style = EVENT_STYLE.approved }
      else if (entrySource === 'manual') { verb = `Added ${n} job${n === 1 ? '' : 's'} manually`; style = EVENT_STYLE.manualAdd }
      else { verb = `Added ${n} job${n === 1 ? '' : 's'}`; style = EVENT_STYLE.manualAdd }
      actor = resolveActor({ source: 'admin', name: approvedBy })
      const jobList = jobRows.map(r => {
        const jobNum = jobById[r.new_data?.job_id] || 'unmatched job'
        const hrs = r.new_data?.hours
        return `${jobNum}${hrs != null ? ` (${hrs}h)` : ''}`
      }).join(', ')
      detail = jobList + (supplyRows.length ? ` · ${supplyRows.length} suppl${supplyRows.length === 1 ? 'y' : 'ies'}` : '')
    } else if (row.action === 'UPDATE') {
      verb = 'Office edited this entry'
      style = EVENT_STYLE.officeEdit
      detail = summarizeChanges(od, nd)
    } else if (row.action === 'DELETE') {
      verb = 'Removed a job from the timesheet'
      style = EVENT_STYLE.delete
      detail = od.approved_by_name ? `(originally approved by ${od.approved_by_name})` : null
    }
  } else if (row.table_name === 'sms_submissions') {
    if (row.action === 'INSERT') {
      const isMobile = nd.from_phone === 'mobile-app'
      verb = isMobile ? `${employeeName} opened today in the mobile app` : `${employeeName} texted in`
      actor = resolveActor({ source: 'employee', employeeId, employeeById })
      style = EVENT_STYLE.employee
    } else if (row.action === 'UPDATE') {
      const oldMsgs = od.raw_messages || [], newMsgs = nd.raw_messages || []
      const appended = newMsgs.length > oldMsgs.length ? newMsgs.slice(oldMsgs.length) : []
      const officeNote = appended.find(m => m.direction === 'out' && (m.text || '').startsWith('Office note re:'))
      const inbound = appended.find(m => m.direction === 'in')

      if (officeNote) {
        verb = 'Office sent a note'
        detail = truncate(officeNote.text.replace(/^Office note re:[^—-]*[—-]\s*/, ''))
        style = EVENT_STYLE.officeNote
      } else if (inbound) {
        verb = `${employeeName} texted in`
        detail = truncate(inbound.text)
        actor = resolveActor({ source: 'employee', employeeId, employeeById })
        style = EVENT_STYLE.employee
      } else if (appended.length > 0) {
        verb = 'Bot replied'
        detail = truncate(appended[0]?.text)
        style = EVENT_STYLE.botReply
      } else if (od.status !== nd.status) {
        // 'draft' is written exclusively by the mobile app's autosave (no
        // other code path sets it), regardless of what the status/from_phone
        // was before — so this is always the employee, safe unconditionally.
        if (nd.status === 'draft') {
          verb = od.status === 'submitted' ? `${employeeName} reopened the day to make changes` : `${employeeName} is working on this day`
          actor = resolveActor({ source: 'employee', employeeId, employeeById })
          style = EVENT_STYLE.employee
        } else if (nd.status === 'submitted' && nd.from_phone === 'mobile-app') {
          verb = `${employeeName} submitted the day`
          actor = resolveActor({ source: 'employee', employeeId, employeeById })
          style = EVENT_STYLE.employee
        } else if (nd.status === 'submitted') {
          // Reached only when raw_messages did NOT grow this update (checked
          // above) — the bot always bundles its own close-out message with
          // this flip, so a message-less move to 'submitted' is never the bot
          // itself. It's an admin resolving it via SmsReview's Edit modal, or
          // the stale-conversation cron giving up after no reply.
          const hadPendingQuestion = (od.pending_questions || []).length > 0
          verb = hadPendingQuestion ? 'Marked submitted — no reply received' : 'Office marked the day submitted'
          style = EVENT_STYLE.officeEdit
        } else if (nd.status === 'approved') {
          const approverName = findApproverName(allRowsForDay, employeeId, workDate, row.changed_at)
          verb = approverName ? `${approverName} approved the day` : 'Office approved the day'
          actor = resolveActor({ source: 'admin', name: approverName })
          style = EVENT_STYLE.approved
        } else if (nd.status === 'rejected') {
          verb = 'Office declined this day'
          style = EVENT_STYLE.declined
        } else {
          verb = `Status changed to ${nd.status}`
        }
      } else if (nd.from_phone === 'mobile-app') {
        // No status change, no new message, but this row belongs to the
        // mobile app — only the employee's own device ever writes to a
        // 'mobile-app' row (confirmed: no admin edit path touches
        // from_phone), so this is them mid-edit, not the office.
        verb = `${employeeName} updated the day`
        actor = resolveActor({ source: 'employee', employeeId, employeeById })
        style = EVENT_STYLE.employee
        detail = summarizeChanges(od, nd)
      } else {
        verb = 'Office edited this day'
        style = EVENT_STYLE.officeEdit
        detail = summarizeChanges(od, nd)
      }
    } else if (row.action === 'DELETE') {
      verb = 'Submission removed'
      style = EVENT_STYLE.delete
    }
  } else if (row.table_name === 'job_supplies') {
    if (row.action === 'INSERT') { verb = `Added a supply: ${nd.supply_name || '?'}`; style = EVENT_STYLE.manualAdd }
    else if (row.action === 'DELETE') { verb = `Removed a supply: ${od.supply_name || '?'}`; style = EVENT_STYLE.delete }
    else { verb = 'Supply updated'; style = EVENT_STYLE.officeEdit; detail = summarizeChanges(od, nd) }
  } else {
    // Anything else the employee/date filter happened to match — keep it
    // visible rather than silently dropping it versus the table view.
    verb = `${row.table_name} ${row.action.toLowerCase()}d`
    detail = summarizeChanges(od, nd)
  }

  return {
    id: row.id,
    timestamp: row.changed_at,
    icon: style.icon, color: style.color, bg: style.bg,
    actor, verb, detail,
    rawRows: group.rows,
  }
}

export default function AuditTimeline({ rows, employees, jobs, loading, hasMore }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  if (loading) return <div style={{ color: '#888', textAlign: 'center', padding: '3rem' }}>Loading…</div>
  if (rows.length === 0) {
    return (
      <div style={{ color: '#888', textAlign: 'center', padding: '3rem', border: '2px dashed #ddd', borderRadius: 8 }}>
        No history for this day
      </div>
    )
  }

  const employeeById = Object.fromEntries(employees.map(e => [e.id, e.name]))
  const jobById = Object.fromEntries((jobs || []).map(j => [j.id, j.job_number]))
  const rowsAsc = [...rows].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
  const groups = groupAuditRows(rowsAsc)
  const events = groups.map(g => resolveTimelineEvent(g, rowsAsc, employeeById, jobById))

  return (
    <div style={{ padding: '0.5rem 0 1rem' }}>
      {hasMore && (
        <div style={{ fontSize: '0.8rem', color: '#a06b00', background: '#fff4de', border: '1px solid #ffe4a8', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
          100+ changes for this day — showing the first page only. That's a lot for one day; worth a look at the raw table view.
        </div>
      )}
      {events.map((ev, i) => {
        const isLast = i === events.length - 1
        const isExpanded = !!expanded[ev.id]
        return (
          <div key={ev.id} style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '2rem', flexShrink: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: ev.color, marginTop: '0.4rem', flexShrink: 0 }} />
              {!isLast && <div style={{ flex: 1, width: 2, background: '#e5e5e5', marginTop: '0.2rem' }} />}
            </div>
            <div style={{ flex: 1, paddingBottom: isLast ? '0.5rem' : '1.25rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#999' }}>{fmtTime(ev.timestamp)}</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#222', marginTop: '0.1rem' }}>
                <span style={{ marginRight: '0.4rem' }}>{ev.icon}</span>{ev.verb}
              </div>
              {ev.detail && (
                <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.15rem' }}>{ev.detail}</div>
              )}
              <button
                onClick={() => toggle(ev.id)}
                style={{ marginTop: '0.3rem', background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.78rem', padding: 0 }}
              >{isExpanded ? '▲ hide raw diff' : '▼ view raw diff'}</button>
              {isExpanded && (
                <div style={{ marginTop: '0.5rem', background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: '0.6rem 0.75rem' }}>
                  {ev.rawRows.map(r => (
                    <div key={r.id} style={{ marginBottom: '0.5rem' }}>
                      <div style={{ fontSize: '0.72rem', color: '#aaa', marginBottom: '0.2rem' }}>{r.table_name} · {r.action}</div>
                      <AuditFieldDiff oldData={r.old_data} newData={r.new_data} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
