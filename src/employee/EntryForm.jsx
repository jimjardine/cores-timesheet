import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { ensureStatPay, cleanupStatPay } from '../utils/statPay'
import { replaceSupplies, fetchDailyOTContext, computeDailyOTSplit, computeSubmissionTiming } from '../utils/entrySave'
import JobPicker from './JobPicker'
import MediaThumb from '../components/MediaThumb'
import './employee.css'

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const gearPhotoUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl

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
  // Numeric multiplier — used only in edit mode, for legacy entry_source='self'
  // rows that still carry timesheet_entries.per_diem directly (see saveEdit).
  const [perDiem, setPerDiem] = useState(0)
  // Free text — used in new-day mode, matches sms_submissions.per_diem_location
  // (same shape a texted-in day uses; see saveNewDay/PendingEntryEdit.jsx).
  const [perDiemLocation, setPerDiemLocation] = useState('')
  const [jobLines, setJobLines] = useState([blankJobLine()])
  const [supplyLines, setSupplyLines] = useState([blankSupplyLine()])

  // ── Edit-single-entry fields ──
  const [originalEntry, setOriginalEntry] = useState(null)
  const [editJobId, setEditJobId] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // ── Photos (day-scoped, same gear-photos bucket the day-card upload uses) ──
  const [photos, setPhotos] = useState([])
  const [showPhotoUpload, setShowPhotoUpload] = useState(false)
  const [photoJobId, setPhotoJobId] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  useEffect(() => {
    supabase.schema('Cores').from('jobs').select('id, job_number, description, vessels(name)').order('job_number').then(({ data }) => setJobs(data || []))
  }, [])

  async function loadPhotos() {
    const { data } = await supabase.schema('Cores').from('gear_photos')
      .select('*').eq('employee_id', employee.id).eq('work_date', workDate).order('created_at')
    setPhotos(data || [])
  }
  // Photos are day-scoped (not tied to a single job line), same as the
  // day-card's own upload — re-fetch whenever the date this entry is for changes.
  useEffect(() => { loadPhotos() }, [employee.id, workDate])

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

      // Applied only — a still-drafting GearPhotos line isn't part of what this
      // editor manages, and replaceSupplies() (on Save) never touches it anyway.
      const { data: sup } = await supabase.schema('Cores').from('job_supplies')
        .select('job_id, supply_name, quantity').eq('employee_id', employee.id).eq('work_date', entry.work_date)
        .not('applied_at', 'is', null)
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

    const jobNumberFor = (jobId) => jobs.find(j => j.id === jobId)?.job_number || ''

    // Lands in sms_submissions — same as a texted-in day — so it shows up in
    // the office's SMS Review for approval instead of going straight into
    // timesheet_entries. reg_hours/ot_hours here are only a same-day preview
    // for the review screen; computeOTMap derives the real split (incl.
    // weekly threshold) once SmsReview's approve() writes the real entries.
    const { statDay, dailyOTThreshold, alreadyWorked: startAlready } = await fetchDailyOTContext(supabase, employee.id, workDate)
    let alreadyWorked = startAlready
    const entries = validLines.map(l => {
      const hours = Number(l.hours)
      const { reg, ot } = computeDailyOTSplit(hours, alreadyWorked, dailyOTThreshold, statDay)
      alreadyWorked += hours
      return {
        job_number: jobNumberFor(l.job_id), hours, description: l.description.trim(),
        reg_hours: Math.round(reg * 100) / 100, ot_hours: Math.round(ot * 100) / 100,
      }
    })
    const supplies = supplyLines
      .filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
      .map(s => ({ job_number: jobNumberFor(s.job_id), supply_name: s.supply_name, quantity: Number(s.quantity) }))

    const totalHours = entries.reduce((s, e) => s + e.hours, 0)
    const { calculated_time_out, delta_minutes } = computeSubmissionTiming(timeIn, timeOut, lunchMinutes, totalHours)

    // Same gap as EmployeeHome's autosave — an app-logged day had nothing in
    // raw_messages at all, so it showed no "Conversation" in SMS Review the
    // way a texted-in day does. One snapshot line at creation time here,
    // since this is a single create (not an autosave loop needing the
    // session-close handling EmployeeHome.jsx uses).
    const summaryParts = [`In ${timeIn || '—'}`, `Out ${timeOut || '—'}`, `Lunch ${lunchMinutes === '' ? 0 : lunchMinutes}min`]
    if (perDiemLocation.trim()) summaryParts.push(`PD: ${perDiemLocation.trim()}`)
    for (const e of entries) summaryParts.push(`Job# ${e.job_number}: ${e.hours}hrs${e.description ? ' — ' + e.description : ''}`)
    const raw_messages = [{ ts: new Date().toISOString(), text: `Logged via app: ${summaryParts.join(' · ')}`, direction: 'in' }]

    const { error: insertError } = await supabase.schema('Cores').from('sms_submissions').insert({
      from_phone: 'mobile-app', employee_id: employee.id, work_date: workDate,
      time_in: timeIn || null, stated_time_out: timeOut || null,
      lunch_minutes: lunchMinutes === '' ? null : Number(lunchMinutes),
      per_diem_location: perDiemLocation.trim() || 'none',
      entries, supplies, status: 'submitted',
      calculated_time_out, delta_minutes, raw_messages,
    })
    if (insertError) { setError(insertError.message); setSaving(false); return }

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

  // Same gear-photos bucket + pending_context convention as the day-card
  // upload in EmployeeHome.jsx — see that file's uploadPhoto for the full note.
  async function uploadPhoto(file) {
    setUploadingPhoto(true); setError('')
    const jobNumber = photoJobId ? jobs.find(j => j.id === photoJobId)?.job_number || '' : ''
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${workDate}/${employee.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('gear-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (upErr) { setError(upErr.message); setUploadingPhoto(false); return }
    const { error: insErr } = await supabase.schema('Cores').from('gear_photos').insert({
      employee_id: employee.id, work_date: workDate, from_phone: 'mobile-app',
      storage_path: path, job_id: photoJobId || null, ship_or_job: jobNumber || null,
      pending_context: !photoJobId, file_size_bytes: file.size,
    })
    if (insErr) { setError(insErr.message); setUploadingPhoto(false); return }
    await loadPhotos()
    setUploadingPhoto(false)
    setShowPhotoUpload(false)
    setPhotoJobId('')
  }

  async function deleteThisEntry() {
    setSaving(true)
    const { error: delError } = await supabase.schema('Cores').from('timesheet_entries')
      .delete().eq('id', originalEntry.id).eq('employee_id', employee.id)
    if (delError) { setError(delError.message); setSaving(false); return }
    // Applied only — a still-drafting GearPhotos line for this job/day isn't
    // tied to this entry's existence and must survive the entry being deleted.
    await supabase.schema('Cores').from('job_supplies').delete()
      .eq('employee_id', employee.id).eq('job_id', originalEntry.job_id).eq('work_date', originalEntry.work_date)
      .not('applied_at', 'is', null)
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
            {mode === 'new' ? (
              <input type="text" placeholder='"none" or hotel name' value={perDiemLocation} onChange={e => setPerDiemLocation(e.target.value)} />
            ) : (
              <select value={perDiem} onChange={e => setPerDiem(e.target.value)}>
                <option value={0}>None</option>
                <option value={1}>×1</option>
                <option value={2}>×2</option>
              </select>
            )}
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
                  <JobPicker jobs={jobs} value={line.job_id} onChange={(job) => updateJobLine(i, { job_id: job.id })} />
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
            <JobPicker jobs={jobs} value={editJobId} onChange={(job) => setEditJobId(job.id)} />
            <div style={{ height: '0.6rem' }} />
            <label>Hours</label>
            <input type="number" step="0.25" min="0" value={editHours} onChange={e => setEditHours(e.target.value)} />
            <div style={{ height: '0.6rem' }} />
            <label>Notes</label>
            <textarea rows={2} value={editDescription} onChange={e => setEditDescription(e.target.value)} />
          </div>
        )}

        <div style={{ marginTop: '1rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444' }}>Photos</label>
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {photos.map(p => (
                <MediaThumb key={p.id} src={gearPhotoUrl(p.storage_path)} alt={p.ship_or_job || 'photo'}
                  style={{ width: '3.2rem', height: '3.2rem', objectFit: 'cover', borderRadius: '4px', border: '1px solid #ddd' }} />
              ))}
            </div>
          )}
          {!showPhotoUpload ? (
            <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginTop: '0.5rem' }}
              onClick={() => { setShowPhotoUpload(true); setPhotoJobId(mode === 'edit' ? editJobId : ''); setError('') }}>+ Photo</button>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <div className="emp-field">
                <label>Job this photo is for (optional)</label>
                <JobPicker jobs={jobs} value={photoJobId} onChange={(job) => setPhotoJobId(job.id)} placeholder="No job — office will sort it out" />
                {photoJobId && (
                  <button type="button" className="emp-inline-link" style={{ marginTop: '0.3rem', fontSize: '0.8rem' }}
                    onClick={() => setPhotoJobId('')}>Clear job</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <label className="emp-btn" style={{ position: 'relative', overflow: 'hidden', opacity: uploadingPhoto ? 0.5 : 1, cursor: uploadingPhoto ? 'not-allowed' : 'pointer' }}>
                  {uploadingPhoto ? 'Uploading…' : 'Take / choose photo or video'}
                  <input type="file" accept="image/*,video/*" disabled={uploadingPhoto}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: uploadingPhoto ? 'not-allowed' : 'pointer' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f) }} />
                </label>
                <button className="emp-btn emp-btn-secondary" onClick={() => { setShowPhotoUpload(false); setPhotoJobId('') }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444' }}>Supplies used (optional)</label>
          {supplyLines.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
              <div className="emp-row-2" style={{ flex: 1 }}>
                <JobPicker jobs={jobs} value={line.job_id} onChange={(job) => updateSupplyLine(i, { job_id: job.id })} placeholder="Job…" />
                <input type="text" placeholder="Fill in supply name and qty" value={line.supply_name}
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
