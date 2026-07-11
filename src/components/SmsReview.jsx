import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { ensureStatPay, isStatHoliday } from '../utils/statPay'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-timesheet`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const STATUS_COLORS = {
  collecting: '#888',
  submitted:  '#cc7700',
  approved:   '#2a7a2a',
  rejected:   '#cc2222',
}

export default function SmsReview() {
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs]               = useState([])
  const [employees, setEmployees]     = useState([])
  const [otThreshold, setOtThreshold] = useState(8)
  const [filter, setFilter]           = useState('submitted')
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState({})
  const [acting, setActing]           = useState(null)

  // Test harness
  const [testOpen, setTestOpen]   = useState(false)
  const [testPhone, setTestPhone] = useState('5068667302')
  const [testMsg, setTestMsg]     = useState('')
  const [testReply, setTestReply] = useState(null)
  const [testLoading, setTestLoading] = useState(false)

  // Edit modal
  const [editModal, setEditModal]   = useState(null)
  const [editFields, setEditFields] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: subs }, { data: j }, { data: emps }, { data: cfg }] = await Promise.all([
      supabase.schema('Cores').from('sms_submissions').select('*').order('updated_at', { ascending: false }),
      supabase.schema('Cores').from('jobs').select('id, job_number, description').eq('status', 'open'),
      supabase.schema('Cores').from('employees').select('id, name, active'),
      supabase.schema('Cores').from('payroll_config').select('key, value'),
    ])
    setSubmissions(subs || [])
    setJobs(j || [])
    setEmployees(emps || [])
    const ot = (cfg || []).find(r => r.key === 'daily_ot_threshold')
    setOtThreshold(ot ? Number(ot.value) : 8)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // "Pending" also surfaces still-open conversations (status='collecting') — otherwise a
  // tech who never answers a follow-up question (lunch/PD/supplies) vanishes from view
  // entirely, since it never reaches 'submitted' on its own.
  const visible = submissions.filter(s => {
    if (filter === 'all') return true
    if (filter === 'submitted') return s.status === 'submitted' || s.status === 'collecting'
    return s.status === filter
  })

  const employeeName = (id) => employees.find(e => e.id === id)?.name || 'Unknown'
  const getEmployee = (id) => employees.find(e => e.id === id) || { name: 'Unknown', active: null }

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  // ── Test harness ──────────────────────────────────────────────────────────
  async function sendTest() {
    if (!testMsg.trim()) return
    setTestLoading(true)
    setTestReply(null)
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ from_phone: testPhone, body: testMsg }),
      })
      const data = await res.json()
      setTestReply(data.reply || JSON.stringify(data))
      setTestMsg('')
      await load()
    } catch (e) {
      setTestReply('Error: ' + e.message)
    }
    setTestLoading(false)
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function approve(sub) {
    setActing(sub.id)
    const hasPD = sub.per_diem_location && sub.per_diem_location !== 'none'
    const entries = sub.entries || []

    // Map job numbers to IDs — case-insensitive so "shop"/"Shop"/"SHOP" all match
    const jobMap = {}
    jobs.forEach(j => { jobMap[j.job_number.toUpperCase()] = j.id })

    const rows = entries.map((e, i) => ({
      employee_id: sub.employee_id,
      job_id:      jobMap[(e.job_number || '').toUpperCase()] || null,
      work_date:   sub.work_date,
      hours:       Number(e.hours),
      ot_hours:    Number(e.ot_hours ?? 0),
      description: e.description || null,
      // per_diem is a multiplier (×1 standard, ×2 double), not a dollar amount
      per_diem:    i === 0 && hasPD ? 1 : 0,
      sort_order:  i + 1,
      // Carry the day's shift times onto the entries so the Edit modal and PDF
      // work even if the sms_submission is later cleaned up
      time_in:         sub.time_in || null,
      stated_time_out: sub.stated_time_out || null,
      lunch_minutes:   sub.lunch_minutes ?? null,
      // The text itself is the employee's confirmation — no follow-up needed
      entry_source:         'sms',
      confirmation_status:  'not_required',
    }))

    if (rows.length > 0) {
      const { error } = await supabase.schema('Cores').from('timesheet_entries').insert(rows)
      if (error) { alert('Error creating entries: ' + error.message); setActing(null); return }
    }

    // Supplies go to job_supplies for job cost reporting (no pricing — invoicing adds that)
    const supplies = (sub.supplies || []).filter(s => s.supply_name?.trim())
    if (supplies.length > 0) {
      const supplyRows = supplies.map(s => ({
        job_id:            jobMap[(s.job_number || '').toUpperCase()] || null,
        sms_submission_id: sub.id,
        employee_id:       sub.employee_id,
        work_date:         sub.work_date,
        supply_name:       s.supply_name.trim(),
        quantity:          Number(s.quantity) > 0 ? Number(s.quantity) : 1,
      }))
      const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').insert(supplyRows)
      if (supplyError) {
        alert(`Timesheet entries were created but supplies failed to save: ${supplyError.message}\nAdd the supplies manually.`)
      }
    }

    const { error: statusError } = await supabase.schema('Cores').from('sms_submissions').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', sub.id)
    if (statusError) {
      // Entries are already in — approving again would duplicate them
      alert(`Entries were created but the submission couldn't be marked approved: ${statusError.message}\nDo NOT approve it again — refresh and check the Timesheets tab.`)
    }
    await ensureStatPay(sub.employee_id, sub.work_date)
    await load()
    setActing(null)
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  async function reject(sub) {
    if (!confirm('Mark this submission as rejected?')) return
    setActing(sub.id)
    const { error } = await supabase.schema('Cores').from('sms_submissions').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', sub.id)
    if (error) alert(`Reject failed: ${error.message}`)
    await load()
    setActing(null)
  }

  // ── Edit modal ────────────────────────────────────────────────────────────
  function openEdit(sub) {
    setEditModal(sub)
    setEditFields({
      employee_id:       sub.employee_id || '',
      work_date:         sub.work_date || '',
      time_in:           sub.time_in ? sub.time_in.substring(0, 5) : '',
      stated_time_out:   sub.stated_time_out ? sub.stated_time_out.substring(0, 5) : '',
      lunch_minutes:     sub.lunch_minutes != null ? String(sub.lunch_minutes) : '',
      per_diem_location: sub.per_diem_location || '',
      entries:           (sub.entries || []).map(e => ({
        job_number:  e.job_number || '',
        hours:       e.hours != null ? String(e.hours) : '',
        description: e.description || '',
      })),
      supplies:          (sub.supplies || []).map(s => ({
        job_number:  s.job_number || '',
        supply_name: s.supply_name || '',
        quantity:    s.quantity != null ? String(s.quantity) : '1',
      })),
    })
  }

  const setEntryField = (i, field, value) =>
    setEditFields(p => ({ ...p, entries: p.entries.map((e, j) => j === i ? { ...e, [field]: value } : e) }))
  const addEntryRow = () =>
    setEditFields(p => ({ ...p, entries: [...p.entries, { job_number: '', hours: '', description: '' }] }))
  const removeEntryRow = (i) =>
    setEditFields(p => ({ ...p, entries: p.entries.filter((_, j) => j !== i) }))

  const setSupplyField = (i, field, value) =>
    setEditFields(p => ({ ...p, supplies: p.supplies.map((s, j) => j === i ? { ...s, [field]: value } : s) }))
  const addSupplyRow = () =>
    setEditFields(p => ({ ...p, supplies: [...p.supplies, { job_number: '', supply_name: '', quantity: '1' }] }))
  const removeSupplyRow = (i) =>
    setEditFields(p => ({ ...p, supplies: p.supplies.filter((_, j) => j !== i) }))

  async function saveEdit() {
    // Drop blank rows, then re-split reg/OT the same way the edge function does
    const cleaned = editFields.entries
      .filter(e => e.job_number.trim() || e.description.trim() || e.hours !== '')
      .map(e => ({ job_number: e.job_number.trim(), hours: Number(e.hours) || 0, description: e.description.trim() }))

    if (cleaned.some(e => !e.job_number)) { alert('Every entry needs a job number'); return }
    if (cleaned.some(e => !(e.hours > 0))) { alert('Every entry needs hours greater than 0'); return }

    // Seed the split with hours already in timesheet_entries for this employee/date,
    // matching the edge function — otherwise a second submission that day gets reg
    // hours it shouldn't
    let alreadyWorked = 0
    if (editFields.employee_id && editFields.work_date) {
      const { data: existing } = await supabase.schema('Cores').from('timesheet_entries')
        .select('hours').eq('employee_id', editFields.employee_id).eq('work_date', editFields.work_date).eq('is_stat_pay', false)
      alreadyWorked = (existing || []).reduce((s, e) => s + Number(e.hours || 0), 0)
    }
    // Work on a stat holiday is all OT — no reg allowance at all
    const statDay = editFields.work_date ? await isStatHoliday(editFields.work_date) : false
    let regLeft = statDay ? 0 : Math.max(0, otThreshold - alreadyWorked)
    const entries = cleaned.map(e => {
      const hours = Math.round(e.hours * 100) / 100
      const reg   = Math.round(Math.min(hours, Math.max(0, regLeft)) * 100) / 100
      const ot    = Math.round((hours - reg) * 100) / 100
      regLeft     = Math.max(0, regLeft - hours)
      return { ...e, hours, reg_hours: reg, ot_hours: ot }
    })

    const supplies = (editFields.supplies || [])
      .filter(s => s.supply_name.trim())
      .map(s => ({
        job_number:  s.job_number.trim(),
        supply_name: s.supply_name.trim(),
        quantity:    Number(s.quantity) > 0 ? Number(s.quantity) : 1,
      }))

    const updates = {
      employee_id:       editFields.employee_id || null,
      work_date:         editFields.work_date || null,
      time_in:           editFields.time_in || null,
      stated_time_out:   editFields.stated_time_out || null,
      lunch_minutes:     editFields.lunch_minutes !== '' ? Number(editFields.lunch_minutes) : null,
      per_diem_location: editFields.per_diem_location || null,
      entries,
      supplies,
      calculated_time_out: null,
      delta_minutes:     null,
      pending_questions: [],
      updated_at:        new Date().toISOString(),
    }

    // Nicki has fixed it up by hand — a collecting submission is now reviewable
    if (editModal.status === 'collecting') updates.status = 'submitted'

    // Recalculate time_out and delta against the stated out time
    const totalHours = entries.reduce((s, e) => s + e.hours, 0)
    if (updates.time_in && totalHours > 0) {
      const [h, m] = updates.time_in.split(':').map(Number)
      const lunchMins = Number(updates.lunch_minutes) || 0
      const outMins = h * 60 + m + Math.round(totalHours * 60) + lunchMins
      const oh = Math.floor(outMins / 60) % 24
      const om = outMins % 60
      updates.calculated_time_out = `${String(oh).padStart(2,'0')}:${String(om).padStart(2,'0')}`
      if (updates.stated_time_out) {
        const [sh, sm] = updates.stated_time_out.split(':').map(Number)
        updates.delta_minutes = (sh * 60 + sm) - outMins
      }
    }

    const { error } = await supabase.schema('Cores').from('sms_submissions').update(updates).eq('id', editModal.id)
    if (error) { alert('Error saving: ' + error.message); return }
    setEditModal(null)
    await load()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmt12(t) {
    if (!t) return '?'
    const [h, m] = t.substring(0, 5).split(':').map(Number)
    const p = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    return m === 0 ? `${h12}${p}` : `${h12}:${String(m).padStart(2,'0')}${p}`
  }

  function fmtDate(d) {
    if (!d) return '?'
    const [y, mo, day] = d.split('-').map(Number)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${months[mo-1]} ${day}, ${y}`
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>

      {/* Test harness — dev builds only, hidden from the client */}
      {import.meta.env.DEV && (
      <div style={{ marginBottom: '1.5rem', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <div
          onClick={() => setTestOpen(p => !p)}
          style={{ background: '#f5f5f5', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}
        >
          <span>Test SMS Parser</span>
          <span>{testOpen ? '▲' : '▼'}</span>
        </div>
        {testOpen && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="From phone"
                style={{ width: 180, padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, fontFamily: 'monospace' }}
              />
              <span style={{ color: '#888', fontSize: '0.85rem', lineHeight: '2' }}>→ simulates inbound SMS</span>
            </div>
            <textarea
              value={testMsg}
              onChange={e => setTestMsg(e.target.value)}
              placeholder={'e.g. In 7:30, 4760 6hrs port engine bearings, 4862 2hrs fuel lines, lunch 30, no PD'}
              rows={3}
              style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4, fontFamily: 'monospace', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={sendTest}
                disabled={testLoading || !testMsg.trim()}
                style={{
                  padding: '0.4rem 1.2rem',
                  background: (testLoading || !testMsg.trim()) ? '#ccc' : '#0066cc',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: (testLoading || !testMsg.trim()) ? 'default' : 'pointer',
                }}
              >
                {testLoading ? 'Sending…' : (testReply && !testMsg.trim() ? 'Sent ✓' : 'Send')}
              </button>
              {testReply && (
                <div style={{ background: '#e8f4e8', border: '1px solid #9c9', borderRadius: 6, padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap', flex: 1 }}>
                  {testReply}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Filter + title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>SMS Submissions</h2>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {['submitted', 'approved', 'rejected', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '0.3rem 0.8rem', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: filter === f ? 700 : 400,
              background: filter === f ? '#0066cc' : '#eee', color: filter === f ? '#fff' : '#333',
            }}>
              {f === 'submitted' ? 'Pending' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={load} style={{ padding: '0.3rem 0.8rem', border: '1px solid #ccc', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: '0.85rem' }}>↺</button>
        </div>
      </div>

      {loading && <div style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>Loading…</div>}

      {!loading && visible.length === 0 && (
        <div style={{ color: '#888', textAlign: 'center', padding: '3rem', border: '2px dashed #ddd', borderRadius: 8 }}>
          No {filter === 'submitted' ? 'pending' : filter} submissions
        </div>
      )}

      {visible.map(sub => {
        const flags = []
        if (!sub.employee_id)                          flags.push('employee unknown')
        if (!sub.time_in)                              flags.push('start time missing')
        if (!sub.entries || sub.entries.length === 0)  flags.push('no job entries')
        if (sub.lunch_minutes == null)                 flags.push('lunch unknown')
        if (sub.per_diem_location == null)             flags.push('per diem unknown')
        if (sub.delta_minutes && Math.abs(sub.delta_minutes) > 15) flags.push(`time delta ${sub.delta_minutes > 0 ? '+' : ''}${sub.delta_minutes}min`)
        if (sub.status === 'collecting' && (sub.pending_questions || []).length > 0) {
          flags.push(`⏳ awaiting reply — ${sub.pending_questions.join(' | ')}`)
        }
        if (sub.status === 'submitted' && (sub.pending_questions || []).length > 0) {
          flags.push('⏱ no reply received — auto-closed')
        }

        const isExpanded = !!expanded[sub.id]

        return (
          <div key={sub.id} style={{ border: '1px solid #ddd', borderRadius: 8, marginBottom: '1rem', overflow: 'hidden' }}>

            {/* Card header */}
            <div
              onClick={() => toggle(sub.id)}
              style={{ background: '#fafafa', padding: '0.75rem 1rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong style={{ fontSize: '1rem' }}>{employeeName(sub.employee_id)}</strong>
                  {getEmployee(sub.employee_id).active === false && (
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: 4, background: '#ffd9d9', color: '#c00', fontWeight: 700, border: '1px solid #ffaaaa' }}>
                      INACTIVE
                    </span>
                  )}
                </div>
                <span style={{ color: '#555' }}>{fmtDate(sub.work_date)}</span>
                <span style={{ fontSize: '0.8rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: STATUS_COLORS[sub.status] + '22', color: STATUS_COLORS[sub.status], fontWeight: 600, border: `1px solid ${STATUS_COLORS[sub.status]}44` }}>
                  {sub.status}
                </span>
                {flags.map(f => (
                  <span key={f} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: '#ffe0e0', color: '#c00', border: '1px solid #ffaaaa' }}>
                    ⚠ {f}
                  </span>
                ))}
              </div>
              <span style={{ color: '#999', fontSize: '0.8rem' }}>{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div style={{ padding: '1rem' }}>

                {/* Time row */}
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                  <span><strong>In:</strong> {fmt12(sub.time_in)}</span>
                  <span><strong>Out:</strong> {fmt12(sub.stated_time_out || sub.calculated_time_out)}</span>
                  <span><strong>Lunch:</strong> {sub.lunch_minutes != null ? (sub.lunch_minutes === 0 ? 'None' : `${sub.lunch_minutes}min`) : '?'}</span>
                  {sub.delta_minutes != null && Math.abs(sub.delta_minutes) > 0 && (
                    <span style={{ color: Math.abs(sub.delta_minutes) > 15 ? '#c00' : '#888' }}>
                      <strong>Δ:</strong> {sub.delta_minutes > 0 ? '+' : ''}{sub.delta_minutes}min
                    </span>
                  )}
                  <span><strong>Per diem:</strong> {sub.per_diem_location === 'none' ? 'No' : sub.per_diem_location || '?'}</span>
                  <span style={{ color: '#999', marginLeft: 'auto' }}>{sub.from_phone}</span>
                </div>

                {/* Entries table */}
                {sub.entries && sub.entries.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: '#f0f0f0' }}>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', width: 70 }}>Job #</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right', width: 55 }}>Reg</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right', width: 55 }}>OT</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', width: 110, color: '#888' }}>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sub.entries.map((e, i) => {
                        const matchedJob = jobs.find(j => j.job_number.toUpperCase() === (e.job_number || '').toUpperCase())
                        const reg = e.reg_hours ?? e.hours
                        const ot  = e.ot_hours ?? 0
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                            <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{e.job_number}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{reg}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: ot > 0 ? '#cc6600' : '#ccc', fontWeight: ot > 0 ? 700 : 400 }}>
                              {ot > 0 ? ot : '—'}
                            </td>
                            <td style={{ padding: '0.4rem 0.6rem', color: '#333' }}>{e.description}</td>
                            <td style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: matchedJob ? '#2a7a2a' : '#c00' }}>
                              {matchedJob ? `✓ ${matchedJob.description?.substring(0, 25) || '—'}` : '✗ not found'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {sub.entries.length > 1 && (
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #ddd', fontWeight: 700, background: '#fafafa' }}>
                          <td style={{ padding: '0.3rem 0.6rem' }}>Total</td>
                          <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right' }}>
                            {sub.entries.reduce((s, e) => s + (e.reg_hours ?? e.hours ?? 0), 0)}
                          </td>
                          <td style={{ padding: '0.3rem 0.6rem', textAlign: 'right', color: '#cc6600' }}>
                            {sub.entries.reduce((s, e) => s + (e.ot_hours ?? 0), 0) || '—'}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                ) : (
                  <div style={{ color: '#c00', marginBottom: '0.75rem', fontSize: '0.875rem' }}>No job entries</div>
                )}

                {/* Supplies table */}
                {sub.supplies && sub.supplies.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ background: '#eef4ee' }}>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>Supply</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right', width: 55 }}>Qty</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', width: 70 }}>Job #</th>
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', width: 110, color: '#888' }}>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sub.supplies.map((s, i) => {
                        const matchedJob = jobs.find(j => j.job_number.toUpperCase() === (s.job_number || '').toUpperCase())
                        return (
                          <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                            <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{s.supply_name}</td>
                            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{s.quantity}</td>
                            <td style={{ padding: '0.4rem 0.6rem' }}>{s.job_number || '—'}</td>
                            <td style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', color: matchedJob ? '#2a7a2a' : '#c00' }}>
                              {matchedJob ? '✓' : '✗ not found'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}

                {/* Conversation history */}
                {sub.raw_messages && sub.raw_messages.length > 0 && (
                  <details style={{ marginBottom: '0.75rem' }}>
                    <summary style={{ cursor: 'pointer', color: '#555', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                      Conversation ({sub.raw_messages.length} messages)
                    </summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '0.5rem' }}>
                      {sub.raw_messages.map((m, i) => (
                        <div key={i} style={{
                          alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end',
                          background: m.direction === 'in' ? '#f0f0f0' : '#ddeeff',
                          borderRadius: 8, padding: '0.4rem 0.75rem',
                          maxWidth: '85%', fontSize: '0.82rem', whiteSpace: 'pre-wrap',
                        }}>
                          {m.text}
                          <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 2 }}>
                            {m.direction === 'in' ? `Worker (${sub.from_phone})` : 'System'} · {m.ts ? new Date(m.ts).toLocaleTimeString() : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Actions */}
                {(sub.status === 'submitted' || sub.status === 'collecting') && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => approve(sub)}
                      disabled={!!acting || !sub.employee_id || !sub.entries?.length}
                      style={{ padding: '0.4rem 1rem', background: '#2a7a2a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                    >
                      {acting === sub.id ? 'Approving…' : 'Approve → Timesheet'}
                    </button>
                    <button
                      onClick={() => openEdit(sub)}
                      style={{ padding: '0.4rem 1rem', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => reject(sub)}
                      disabled={!!acting}
                      style={{ padding: '0.4rem 1rem', background: '#fff', color: '#c00', border: '1px solid #c00', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Reject
                    </button>
                  </div>
                )}

                {sub.status === 'approved' && (
                  <div style={{ color: '#2a7a2a', fontSize: '0.85rem', fontWeight: 600 }}>✓ Approved — entries written to timesheet</div>
                )}
                {sub.status === 'rejected' && (
                  <div style={{ color: '#c00', fontSize: '0.85rem', fontWeight: 600 }}>✗ Rejected</div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Edit modal */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: '1.5rem', width: 640, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Edit Submission</h3>

            <label style={lbl}>Employee</label>
            <select value={editFields.employee_id} onChange={e => setEditFields(p => ({ ...p, employee_id: e.target.value }))} style={inp}>
              <option value="">— Unknown —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>

            <label style={lbl}>Work Date</label>
            <input type="date" value={editFields.work_date} onChange={e => setEditFields(p => ({ ...p, work_date: e.target.value }))} style={inp} />

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Time In</label>
                <input type="time" value={editFields.time_in} onChange={e => setEditFields(p => ({ ...p, time_in: e.target.value }))} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Stated Time Out</label>
                <input type="time" value={editFields.stated_time_out} onChange={e => setEditFields(p => ({ ...p, stated_time_out: e.target.value }))} style={inp} />
              </div>
            </div>

            <label style={lbl}>Lunch (minutes)</label>
            <input type="number" value={editFields.lunch_minutes} onChange={e => setEditFields(p => ({ ...p, lunch_minutes: e.target.value }))} placeholder="0 = no lunch" style={inp} />

            <label style={lbl}>Per Diem Location</label>
            <input value={editFields.per_diem_location} onChange={e => setEditFields(p => ({ ...p, per_diem_location: e.target.value }))} placeholder='"none" or hotel name' style={inp} />

            <label style={lbl}>Job Entries</label>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: '0.75rem', color: '#888', textAlign: 'left' }}>
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 90 }}>Job #</th>
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 70 }}>Hours</th>
                  <th style={{ fontWeight: 600, paddingBottom: 2 }}>Description</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {editFields.entries.map((e, i) => {
                  const matched = jobs.some(j => j.job_number.toUpperCase() === e.job_number.trim().toUpperCase())
                  return (
                    <tr key={i}>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          value={e.job_number}
                          onChange={ev => setEntryField(i, 'job_number', ev.target.value)}
                          placeholder="4760"
                          style={{ ...inp, borderColor: e.job_number.trim() && !matched ? '#e08080' : '#ccc' }}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          type="number" min="0" step="0.25"
                          value={e.hours}
                          onChange={ev => setEntryField(i, 'hours', ev.target.value)}
                          style={inp}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          value={e.description}
                          onChange={ev => setEntryField(i, 'description', ev.target.value)}
                          placeholder="what was done"
                          style={inp}
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => removeEntryRow(i)}
                          title="Remove entry"
                          style={{ border: 'none', background: 'transparent', color: '#c00', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem' }}
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button
              onClick={addEntryRow}
              style={{ marginTop: '0.35rem', padding: '0.25rem 0.7rem', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
            >+ Add job</button>
            {editFields.entries.some(e => e.job_number.trim() && !jobs.some(j => j.job_number.toUpperCase() === e.job_number.trim().toUpperCase())) && (
              <div style={{ fontSize: '0.75rem', color: '#c00', marginTop: '0.3rem' }}>
                Red job numbers don't match any open job — they'll save, but won't link to a job record.
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.3rem' }}>
              Reg/OT split and out-time are recalculated automatically on save.
            </div>

            <label style={lbl}>Supplies Used</label>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: '0.75rem', color: '#888', textAlign: 'left' }}>
                  <th style={{ fontWeight: 600, paddingBottom: 2 }}>Supply</th>
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 70 }}>Qty</th>
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 90 }}>Job #</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {(editFields.supplies || []).map((s, i) => {
                  const matched = jobs.some(j => j.job_number.toUpperCase() === s.job_number.trim().toUpperCase())
                  const entryJobNumbers = [...new Set(
                    editFields.entries.map(e => e.job_number.trim()).filter(Boolean)
                  )]
                  return (
                    <tr key={i}>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          value={s.supply_name}
                          onChange={ev => setSupplyField(i, 'supply_name', ev.target.value)}
                          placeholder="brake cleaner"
                          style={inp}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          type="number" min="0" step="0.5"
                          value={s.quantity}
                          onChange={ev => setSupplyField(i, 'quantity', ev.target.value)}
                          style={inp}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <select
                          value={s.job_number}
                          onChange={ev => setSupplyField(i, 'job_number', ev.target.value)}
                          style={{ ...inp, borderColor: s.job_number.trim() && !matched ? '#e08080' : '#ccc' }}
                        >
                          <option value="">—</option>
                          {entryJobNumbers.map(jn => (
                            <option key={jn} value={jn}>{jn}</option>
                          ))}
                          {s.job_number.trim() && !entryJobNumbers.includes(s.job_number.trim()) && (
                            <option value={s.job_number}>{s.job_number}</option>
                          )}
                        </select>
                      </td>
                      <td>
                        <button
                          onClick={() => removeSupplyRow(i)}
                          title="Remove supply"
                          style={{ border: 'none', background: 'transparent', color: '#c00', cursor: 'pointer', fontSize: '1rem', padding: '0.2rem' }}
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button
              onClick={addSupplyRow}
              style={{ marginTop: '0.35rem', padding: '0.25rem 0.7rem', background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
            >+ Add supply</button>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button onClick={saveEdit} style={{ padding: '0.4rem 1.2rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditModal(null)} style={{ padding: '0.4rem 1.2rem', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const lbl = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#555', marginBottom: '0.2rem', marginTop: '0.75rem' }
const inp = { display: 'block', width: '100%', padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.9rem', boxSizing: 'border-box' }
