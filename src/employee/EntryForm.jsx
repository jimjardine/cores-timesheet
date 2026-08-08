import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { ensureStatPay, cleanupStatPay } from '../utils/statPay'
import { replaceSupplies } from '../utils/entrySave'
import './employee.css'

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const blankJobLine = () => ({ job_id: '', hours: '', description: '' })
const blankSupplyLine = () => ({ job_id: '', supply_name: '', quantity: 1 })

export default function EntryForm({ employee, mode }) {
  const navigate = useNavigate()
  const { entryId } = useParams()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(mode === 'edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── New-day fields (multi-job) ──
  const [workDate, setWorkDate] = useState(toYMD(new Date()))
  const [timeIn, setTimeIn] = useState('07:00')
  const [timeOut, setTimeOut] = useState('15:30')
  const [lunchMinutes, setLunchMinutes] = useState(30)
  const [perDiem, setPerDiem] = useState(0)
  const [jobLines, setJobLines] = useState([blankJobLine()])
  const [supplyLines, setSupplyLines] = useState([blankSupplyLine()])

  // ── Edit-single-entry fields ──
  const [originalEntry, setOriginalEntry] = useState(null)
  const [editJobId, setEditJobId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editDescription, setEditDescription] = useState('')

  useEffect(() => {
    supabase.schema('Cores').from('jobs').select('id, job_number, description, vessels(name)').order('job_number').then(({ data }) => setJobs(data || []))
  }, [])

  useEffect(() => {
    if (mode !== 'edit') return
    let cancelled = false
    async function loadEntry() {
      setLoading(true)
      const { data: entry } = await supabase.schema('Cores').from('timesheet_entries')
        .select('*').eq('id', entryId).eq('employee_id', employee.id).single()
      if (cancelled) return
      if (!entry) { setError('Entry not found'); setLoading(false); return }
      if (entry.entry_source !== 'self') { setError('locked'); setOriginalEntry(entry); setLoading(false); return }
      setOriginalEntry(entry)
      setWorkDate(entry.work_date)
      setEditJobId(entry.job_id || '')
      setEditHours(String(entry.hours ?? ''))
      setEditDescription(entry.description || '')
      setTimeIn(entry.time_in ? entry.time_in.substring(0, 5) : '')
      setTimeOut(entry.stated_time_out ? entry.stated_time_out.substring(0, 5) : '')
      setLunchMinutes(entry.lunch_minutes ?? '')
      setPerDiem(entry.per_diem ?? 0)

      const { data: sup } = await supabase.schema('Cores').from('job_supplies')
        .select('job_id, supply_name, quantity').eq('employee_id', employee.id).eq('work_date', entry.work_date)
      setSupplyLines(sup && sup.length > 0 ? sup : [blankSupplyLine()])
      setLoading(false)
    }
    loadEntry()
    return () => { cancelled = true }
  }, [mode, entryId, employee.id])

  function updateJobLine(i, patch) {
    setJobLines(lines => lines.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function updateSupplyLine(i, patch) {
    setSupplyLines(lines => lines.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  async function saveNewDay() {
    // Hours may be 0 — that's how a day with no real work still gets logged
    // (so it counts as "submitted" instead of looking like a forgotten day).
    const validLines = jobLines.filter(l => l.job_id && l.hours !== '' && Number(l.hours) >= 0)
    if (validLines.length === 0) { setError('Add at least one job (0 hours is fine if you did no work)'); return }
    if (validLines.some(l => !l.description.trim())) { setError('Add a note describing what was done for each job'); return }
    setSaving(true); setError('')

    // ot_hours left null — computeOTMap derives reg/OT (daily + weekly
    // threshold) at display/export time instead. See entrySave.js.
    const rows = validLines.map((l, i) => ({
      employee_id: employee.id, work_date: workDate, job_id: l.job_id,
      hours: Number(l.hours), ot_hours: null, description: l.description || '',
      per_diem: Number(perDiem) || 0, sort_order: i + 1,
      time_in: timeIn || null, stated_time_out: timeOut || null,
      lunch_minutes: lunchMinutes === '' ? null : Number(lunchMinutes),
      entry_source: 'self', confirmation_status: 'not_required',
    }))

    const { error: insertError } = await supabase.schema('Cores').from('timesheet_entries').insert(rows)
    if (insertError) { setError(insertError.message); setSaving(false); return }

    const { error: supplyError } = await replaceSupplies(supabase, employee.id, workDate, supplyLines)
    if (supplyError) { setError(supplyError.message); setSaving(false); return }

    await ensureStatPay(employee.id, workDate)
    setSaving(false)
    navigate('..')
  }

  async function saveEdit() {
    const hours = Number(editHours)
    if (!editJobId || editHours === '' || hours < 0) { setError('Pick a job and enter hours (0 is fine)'); return }
    if (!editDescription.trim()) { setError('Add a note describing what was done'); return }
    setSaving(true); setError('')

    // ot_hours left null — computeOTMap derives reg/OT at display/export
    // time instead. See entrySave.js.
    const { error: updateError } = await supabase.schema('Cores').from('timesheet_entries').update({
      job_id: editJobId, work_date: workDate,
      hours, ot_hours: null, description: editDescription,
      per_diem: Number(perDiem) || 0,
      time_in: timeIn || null, stated_time_out: timeOut || null,
      lunch_minutes: lunchMinutes === '' ? null : Number(lunchMinutes),
    }).eq('id', originalEntry.id).eq('employee_id', employee.id)
    if (updateError) { setError(updateError.message); setSaving(false); return }

    const { error: supplyError } = await replaceSupplies(supabase, employee.id, workDate, supplyLines)
    if (supplyError) { setError(supplyError.message); setSaving(false); return }

    await ensureStatPay(employee.id, workDate)
    if (originalEntry.work_date !== workDate) await cleanupStatPay(employee.id, originalEntry.work_date)
    setSaving(false)
    navigate('..')
  }

  async function deleteThisEntry() {
    setSaving(true)
    const { error: delError } = await supabase.schema('Cores').from('timesheet_entries')
      .delete().eq('id', originalEntry.id).eq('employee_id', employee.id)
    if (delError) { setError(delError.message); setSaving(false); return }
    await supabase.schema('Cores').from('job_supplies').delete()
      .eq('employee_id', employee.id).eq('job_id', originalEntry.job_id).eq('work_date', originalEntry.work_date)
    await cleanupStatPay(employee.id, originalEntry.work_date)
    setSaving(false)
    navigate('..')
  }

  if (loading) return <div className="emp-main"><div className="emp-empty">Loading…</div></div>

  if (error === 'locked') {
    return (
      <div className="emp-main">
        <a className="emp-back-link" onClick={() => navigate('..')}>‹ Back</a>
        <div className="emp-card">
          <div className="emp-empty">🔒 This entry has been approved — the office will need to make any changes now.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="emp-main">
      <a className="emp-back-link" onClick={() => navigate('..')}>‹ Back</a>
      <div className="emp-card">
        {error && <div className="emp-error">{error}</div>}

        <div className="emp-field">
          <label>Date</label>
          <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} />
        </div>

        <div className="emp-row-2">
          <div className="emp-field">
            <label>Time in</label>
            <input type="time" value={timeIn} onChange={e => setTimeIn(e.target.value)} />
          </div>
          <div className="emp-field">
            <label>Time out</label>
            <input type="time" value={timeOut} onChange={e => setTimeOut(e.target.value)} />
          </div>
        </div>

        <div className="emp-row-2">
          <div className="emp-field">
            <label>Lunch (min)</label>
            <input type="number" min="0" step="5" value={lunchMinutes} onChange={e => setLunchMinutes(e.target.value)} />
          </div>
          <div className="emp-field">
            <label>Per diem</label>
            <select value={perDiem} onChange={e => setPerDiem(e.target.value)}>
              <option value={0}>None</option>
              <option value={1}>×1</option>
              <option value={2}>×2</option>
            </select>
          </div>
        </div>

        {mode === 'new' ? (
          <>
            {jobLines.map((line, i) => (
              <div className="emp-job-line" key={i}>
                {jobLines.length > 1 && (
                  <button className="emp-remove-line" onClick={() => setJobLines(l => l.filter((_, idx) => idx !== i))}>Remove</button>
                )}
                <div className="emp-field">
                  <label>Job</label>
                  <select value={line.job_id} onChange={e => updateJobLine(i, { job_id: e.target.value })}>
                    <option value="">Select a job…</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.vessels?.name || j.description}</option>)}
                  </select>
                </div>
                <div className="emp-field">
                  <label>Hours</label>
                  <input type="number" step="0.25" min="0" value={line.hours} onChange={e => updateJobLine(i, { hours: e.target.value })} />
                </div>
                <div className="emp-field">
                  <label>Notes</label>
                  <textarea rows={2} value={line.description} onChange={e => updateJobLine(i, { description: e.target.value })} />
                </div>
              </div>
            ))}
            <button className="emp-btn emp-btn-secondary emp-btn-small" onClick={() => setJobLines(l => [...l, blankJobLine()])}>+ Add another job</button>
          </>
        ) : (
          <div className="emp-field">
            <label>Job</label>
            <select value={editJobId} onChange={e => setEditJobId(e.target.value)}>
              <option value="">Select a job…</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.vessels?.name || j.description}</option>)}
            </select>
            <div style={{ height: '0.6rem' }} />
            <label>Hours</label>
            <input type="number" step="0.25" min="0" value={editHours} onChange={e => setEditHours(e.target.value)} />
            <div style={{ height: '0.6rem' }} />
            <label>Notes</label>
            <textarea rows={2} value={editDescription} onChange={e => setEditDescription(e.target.value)} />
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444' }}>Supplies used (optional)</label>
          {supplyLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
              <div className="emp-row-2" style={{ flex: 1 }}>
                <select value={line.job_id} onChange={e => updateSupplyLine(i, { job_id: e.target.value })}>
                  <option value="">Job…</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number}</option>)}
                </select>
                <input type="text" placeholder="Supply + qty" value={line.supply_name}
                  onChange={e => updateSupplyLine(i, { supply_name: e.target.value })} />
              </div>
              <button className="emp-remove-line" style={{ position: 'static' }}
                onClick={() => setSupplyLines(l => l.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          ))}
          <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginTop: '0.5rem' }}
            onClick={() => setSupplyLines(l => [...l, blankSupplyLine()])}>+ Add supply</button>
        </div>

        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <button className="emp-btn" disabled={saving} onClick={mode === 'new' ? saveNewDay : saveEdit}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {mode === 'edit' && (confirmDelete ? (
            <div style={{ textAlign: 'center', fontSize: '0.9rem' }}>
              Delete this entry?{' '}
              <button className="emp-inline-link" style={{ color: '#c0392b' }} disabled={saving} onClick={deleteThisEntry}>Yes, delete</button>
              {' / '}
              <button className="emp-inline-link" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="emp-btn emp-btn-danger" disabled={saving} onClick={() => setConfirmDelete(true)}>Delete this entry</button>
          ))}
        </div>
      </div>
    </div>
  )
}
