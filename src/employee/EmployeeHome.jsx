import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { payWeekRange, cleanupStatPay } from '../utils/statPay'
import { computeOTMap } from '../utils/otCalc'
import { fmtHours } from '../utils/format'
import { fetchDailyOTContext, computeDailyOTSplit, computeSubmissionTiming } from '../utils/entrySave'
import JobPicker from './JobPicker'
import MediaThumb from '../components/MediaThumb'
import './employee.css'

const blankDraftLine = () => ({ job_id: '', hours: '', description: '' })

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayYMD = () => toYMD(new Date())

function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return toYMD(d)
}

const dayName = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' })
const shortDate = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

const fmtTimeShort = (t) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

const gearPhotoUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl

export default function EmployeeHome({ employee }) {
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(() => payWeekRange(todayYMD())[0])
  const [entries, setEntries] = useState([])
  const [supplies, setSupplies] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs] = useState([])
  const [payrollConfig, setPayrollConfig] = useState({})
  const [statHolidays, setStatHolidays] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [employeeThresholds, setEmployeeThresholds] = useState({})
  // Combined Shift + Job(s) panel — one autosaving form instead of two
  // separately-saved ones (see autosaveLog). Only one day's panel is open
  // at a time, so this is flat state rather than per-day.
  const [logFor, setLogFor] = useState(null)
  const [draftShift, setDraftShift] = useState({ time_in: '', time_out: '', lunch_minutes: '', per_diem_location: '' })
  const [draftLines, setDraftLines] = useState([blankDraftLine()])
  const [savingLog, setSavingLog] = useState(false)
  // Keyed by work_date so an in-flight autosave for a day that's no longer
  // open (the tech already swiped to another day) can't get corrupted by
  // openLog() resetting shared refs out from under it.
  const daySubIdsRef = useRef({})
  const insertLocksRef = useRef({})
  const baseEntriesRef = useRef({})
  const [noteFor, setNoteFor] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [photos, setPhotos] = useState([])
  const [photoFor, setPhotoFor] = useState(null)
  const [photoJobId, setPhotoJobId] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const weekEnd = addDays(weekStart, 6)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.schema('Cores').from('timesheet_entries')
      .select('*, jobs(id, job_number, description, customers(name), vessels(name))')
      .eq('employee_id', employee.id)
      .gte('work_date', weekStart).lte('work_date', weekEnd)
      .order('work_date').order('sort_order')
    setEntries(data || [])
    const { data: sup } = await supabase.schema('Cores').from('job_supplies')
      .select('*').eq('employee_id', employee.id)
      .gte('work_date', weekStart).lte('work_date', weekEnd)
    setSupplies(sup || [])
    // Texted-in days not yet approved by the office — shown so a tech can see
    // and fix a text before Niki reviews it. Approved ones already show up
    // above via timesheet_entries, so they're excluded here.
    const { data: subs } = await supabase.schema('Cores').from('sms_submissions')
      .select('*').eq('employee_id', employee.id)
      .gte('work_date', weekStart).lte('work_date', weekEnd)
      .neq('status', 'approved')
      .order('updated_at', { ascending: false })
    setSubmissions(subs || [])
    const { data: gp } = await supabase.schema('Cores').from('gear_photos')
      .select('*').eq('employee_id', employee.id)
      .gte('work_date', weekStart).lte('work_date', weekEnd)
      .order('created_at', { ascending: false })
    setPhotos(gp || [])
    setLoading(false)
  }, [employee.id, weekStart, weekEnd])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.schema('Cores').from('jobs').select('id, job_number, description, vessels(name)').order('job_number').then(({ data }) => setJobs(data || []))
    supabase.schema('Cores').from('payroll_config').select('key, value').then(({ data }) => setPayrollConfig(Object.fromEntries((data || []).map(r => [r.key, Number(r.value)]))))
    supabase.schema('Cores').from('stat_holidays').select('holiday_date').then(({ data }) => setStatHolidays(new Set((data || []).map(r => r.holiday_date))))
    // The login session only carries {id, name} (see employee-auth), so a
    // custom OT schedule (e.g. office staff on a fixed weekly schedule) isn't
    // on the `employee` prop — fetch it directly.
    supabase.schema('Cores').from('employees').select('ot_daily_threshold, ot_friday_threshold').eq('id', employee.id).single()
      .then(({ data }) => {
        if (data && (data.ot_daily_threshold != null || data.ot_friday_threshold != null)) {
          setEmployeeThresholds({ [employee.id]: { daily: data.ot_daily_threshold, friday: data.ot_friday_threshold } })
        }
      })
  }, [employee.id])

  const otMap = computeOTMap(entries, {
    dailyThreshold: payrollConfig.daily_ot_threshold ?? 8,
    weeklyThreshold: payrollConfig.weekly_ot_threshold ?? 40,
    statHolidays,
    employeeThresholds,
  })

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function openLog(ymd) {
    const daySub = submissions.find(s => s.work_date === ymd)
    setDraftShift({
      time_in: daySub?.time_in ? daySub.time_in.substring(0, 5) : '',
      time_out: daySub?.stated_time_out ? daySub.stated_time_out.substring(0, 5) : '',
      lunch_minutes: daySub?.lunch_minutes != null ? String(daySub.lunch_minutes) : '',
      per_diem_location: daySub?.per_diem_location && daySub.per_diem_location !== 'none' ? daySub.per_diem_location : '',
    })
    setDraftLines([blankDraftLine()])
    daySubIdsRef.current[ymd] = daySub?.id || null
    insertLocksRef.current[ymd] = null
    baseEntriesRef.current[ymd] = daySub?.entries || []
    setLogFor(ymd)
    setError('')
  }

  function closeLog() {
    setLogFor(null)
    setDraftLines([blankDraftLine()])
    setPhotoFor(null)
    setPhotoJobId('')
  }

  // Finds (or creates) this day's sms_submissions row, serialized so two
  // near-simultaneous autosaves for the same day can never both insert —
  // the second one waits on the first's insert and reuses its id.
  async function ensureDaySubId(ymd) {
    if (daySubIdsRef.current[ymd]) return daySubIdsRef.current[ymd]
    if (insertLocksRef.current[ymd]) { await insertLocksRef.current[ymd]; return daySubIdsRef.current[ymd] }
    let resolveLock
    insertLocksRef.current[ymd] = new Promise(res => { resolveLock = res })
    const { data, error } = await supabase.schema('Cores').from('sms_submissions').insert({
      from_phone: 'mobile-app', employee_id: employee.id, work_date: ymd, entries: [], status: 'submitted',
    }).select('id').single()
    if (!error) daySubIdsRef.current[ymd] = data.id
    insertLocksRef.current[ymd] = null
    resolveLock()
    if (error) throw error
    return daySubIdsRef.current[ymd]
  }

  // One autosave for the whole combined Shift + Job(s) panel — replaces the
  // old two-button "Save shift" / "Save job" flow the boys were complaining
  // about. Fires on blur of any field (i.e. the moment they move off it),
  // not on an explicit Save tap, so nothing gets lost if they switch to
  // another day or leave the page mid-entry. linesOverride lets a handler
  // that just changed draftLines pass the freshly-computed array straight
  // through instead of reading back the (still-stale, pre-render) state.
  async function autosaveLog(ymd, linesOverride) {
    const lines = linesOverride ?? draftLines
    const validLines = lines.filter(l => l.job_id)
    const jobNumberFor = (jobId) => jobs.find(j => j.id === jobId)?.job_number || ''

    setSavingLog(true); setError('')
    try {
      let newEntries = []
      if (validLines.length > 0) {
        const { statDay, dailyOTThreshold, alreadyWorked: startAlready } = await fetchDailyOTContext(supabase, employee.id, ymd)
        let alreadyWorked = startAlready + (baseEntriesRef.current[ymd] || []).reduce((s, e) => s + (Number(e.hours) || 0), 0)
        newEntries = validLines.map(l => {
          const hours = Number(l.hours) || 0
          const { reg, ot } = computeDailyOTSplit(hours, alreadyWorked, dailyOTThreshold, statDay)
          alreadyWorked += hours
          return {
            job_number: jobNumberFor(l.job_id), hours, description: (l.description || '').trim(),
            reg_hours: Math.round(reg * 100) / 100, ot_hours: Math.round(ot * 100) / 100,
          }
        })
      }

      const entries = [...(baseEntriesRef.current[ymd] || []), ...newEntries]
      const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0)
      const time_in = draftShift.time_in || null
      const stated_time_out = draftShift.time_out || null
      const lunch_minutes = draftShift.lunch_minutes === '' ? null : Number(draftShift.lunch_minutes)
      const per_diem_location = draftShift.per_diem_location.trim() || 'none'
      const { calculated_time_out, delta_minutes } = computeSubmissionTiming(time_in, stated_time_out, lunch_minutes, totalHours)

      // Nothing worth persisting yet — no shift time set, no per diem note, no job picked
      if (!time_in && !stated_time_out && lunch_minutes == null && per_diem_location === 'none' && entries.length === 0) {
        setSavingLog(false)
        return
      }

      const id = await ensureDaySubId(ymd)
      const { error: err } = await supabase.schema('Cores').from('sms_submissions')
        .update({ time_in, stated_time_out, lunch_minutes, per_diem_location, entries, calculated_time_out, delta_minutes, status: 'submitted', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (err) { setError(err.message); setSavingLog(false); return }
      await load()
    } catch (e) {
      setError(e.message)
    }
    setSavingLog(false)
  }

  // Uploaded straight to the gear-photos bucket — photo or video, the
  // bucket/UI don't care which (see utils/media.js for how display decides
  // which to render). Job is optional — same pending_context convention the
  // SMS/MMS path uses (see sms-timesheet index.ts): picking a job sets
  // job_id/ship_or_job and clears pending_context; leaving it blank marks
  // pending_context true so it shows up in Gear Photos' "needs ship/job"
  // triage queue for the office.
  async function uploadPhoto(ymd, file) {
    setUploadingPhoto(true); setError('')
    const jobNumber = photoJobId ? jobs.find(j => j.id === photoJobId)?.job_number || '' : ''
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${ymd}/${employee.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('gear-photos').upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (upErr) { setError(upErr.message); setUploadingPhoto(false); return }
    const { error: insErr } = await supabase.schema('Cores').from('gear_photos').insert({
      employee_id: employee.id, work_date: ymd, from_phone: 'mobile-app',
      storage_path: path, job_id: photoJobId || null, ship_or_job: jobNumber || null,
      pending_context: !photoJobId, file_size_bytes: file.size,
    })
    if (insErr) { setError(insErr.message); setUploadingPhoto(false); return }
    await load()
    setUploadingPhoto(false)
    setPhotoFor(null)
    setPhotoJobId('')
  }

  // General note for the day, not tied to any job (e.g. "took the truck home
  // tonight") — same admin_note field and append-with-timestamp behavior as
  // the SMS "NOTE:" command, so a note from either channel shows up the same
  // way in the office's review screen. Reuses the day's existing in-progress/
  // submitted sms_submission if there is one, otherwise creates a bare one
  // (no job entries) just to carry the note.
  async function saveNote(ymd) {
    const text = noteDraft.trim()
    if (!text) return
    setSavingNote(true); setError('')
    const daySub = submissions.find(s => s.work_date === ymd)
    const firstName = (employee.name || '').split(' ')[0] || ''
    const stamp = `[${shortDate(ymd)}${firstName ? ' ' + firstName : ''}]`
    const combined = daySub?.admin_note ? `${daySub.admin_note}\n${stamp} ${text}` : `${stamp} ${text}`

    const { error: err } = daySub
      ? await supabase.schema('Cores').from('sms_submissions')
          .update({ admin_note: combined, updated_at: new Date().toISOString() }).eq('id', daySub.id)
      : await supabase.schema('Cores').from('sms_submissions').insert({
          from_phone: 'mobile-app', employee_id: employee.id, work_date: ymd,
          entries: [], status: 'submitted', admin_note: combined,
        })
    if (err) { setError(err.message); setSavingNote(false); return }
    await load()
    setSavingNote(false)
    setNoteFor(null)
    setNoteDraft('')
  }

  async function deleteEntry(entry) {
    if (entry.entry_source !== 'self') { setError('This entry has been approved and can only be changed by the office.'); setConfirmDeleteId(null); return }
    const { error: err } = await supabase.schema('Cores').from('timesheet_entries').delete().eq('id', entry.id).eq('employee_id', employee.id)
    if (err) { setError(err.message); setConfirmDeleteId(null); return }
    await supabase.schema('Cores').from('job_supplies').delete()
      .eq('employee_id', entry.employee_id).eq('job_id', entry.job_id).eq('work_date', entry.work_date)
    await cleanupStatPay(entry.employee_id, entry.work_date)
    setConfirmDeleteId(null)
    await load()
  }

  return (
    <div className="emp-main">
      <div className="emp-week-switch">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
        <div className="emp-week-label" onClick={() => setWeekStart(payWeekRange(todayYMD())[0])}>
          {shortDate(weekStart)} – {shortDate(weekEnd)}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
      </div>

      {error && <div className="emp-error">{error}</div>}

      {loading ? (
        <div className="emp-empty">Loading…</div>
      ) : days.map((ymd) => {
        const dayEntries = entries.filter(e => e.work_date === ymd)
        const daySupplies = supplies.filter(s => s.work_date === ymd)
        const dayPhotos = photos.filter(p => p.work_date === ymd)
        const totalHours = dayEntries.reduce((s, e) => s + Number(e.hours), 0)
        const perDiem = dayEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0)
        const isStat = dayEntries.some(e => e.is_stat_pay)
        // Most recent non-approved submission for this day, if any — texted in
        // but not yet reviewed, so it's still editable from here.
        const daySub = submissions.find(s => s.work_date === ymd)
        const subTotalHours = (daySub?.entries || []).reduce((s, e) => s + (Number(e.hours) || 0), 0)

        return (
          <div className="emp-card" key={ymd}>
            <div className="emp-day-header">
              <div>
                <div className="emp-day-name">
                  {dayName(ymd)}
                  {isStat && <span className="emp-chip emp-chip-stat">STAT</span>}
                  {perDiem > 0 && <span className="emp-chip emp-chip-pd">PD ×{perDiem}</span>}
                </div>
                <div className="emp-day-date">{shortDate(ymd)}</div>
              </div>
              {totalHours > 0 && <div className="emp-day-total">{fmtHours(totalHours)}h</div>}
            </div>

            {logFor === ymd ? (
              <div style={{ marginBottom: '0.75rem', borderBottom: '1px solid #eee', paddingBottom: '0.75rem' }}>
                <div className="emp-row-2">
                  <div className="emp-field">
                    <label>Time in</label>
                    <input type="time" value={draftShift.time_in}
                      onChange={e => setDraftShift(f => ({ ...f, time_in: e.target.value }))}
                      onBlur={() => autosaveLog(ymd)} />
                  </div>
                  <div className="emp-field">
                    <label>Time out</label>
                    <input type="time" value={draftShift.time_out}
                      onChange={e => setDraftShift(f => ({ ...f, time_out: e.target.value }))}
                      onBlur={() => autosaveLog(ymd)} />
                  </div>
                </div>
                <div className="emp-row-2">
                  <div className="emp-field">
                    <label>Lunch (min)</label>
                    <input type="number" min="0" step="5" value={draftShift.lunch_minutes}
                      onChange={e => setDraftShift(f => ({ ...f, lunch_minutes: e.target.value }))}
                      onBlur={() => autosaveLog(ymd)} />
                  </div>
                  <div className="emp-field">
                    <label>Per diem</label>
                    <input type="text" placeholder='"none" or hotel name' value={draftShift.per_diem_location}
                      onChange={e => setDraftShift(f => ({ ...f, per_diem_location: e.target.value }))}
                      onBlur={() => autosaveLog(ymd)} />
                  </div>
                </div>

                {draftLines.map((line, i) => (
                  <div className="emp-job-line" key={i}>
                    {draftLines.length > 1 && (
                      <button className="emp-remove-line" onClick={() => setDraftLines(lines => {
                        const next = lines.filter((_, idx) => idx !== i)
                        autosaveLog(ymd, next)
                        return next
                      })}>Remove</button>
                    )}
                    <div className="emp-field">
                      <label>Job</label>
                      <JobPicker jobs={jobs} value={line.job_id} onChange={(job) => setDraftLines(lines => {
                        const next = lines.map((l, idx) => idx === i ? { ...l, job_id: job.id } : l)
                        autosaveLog(ymd, next)
                        return next
                      })} />
                    </div>
                    <div className="emp-field">
                      <label>Hours</label>
                      <input type="number" step="0.25" min="0" value={line.hours}
                        onChange={e => setDraftLines(lines => lines.map((l, idx) => idx === i ? { ...l, hours: e.target.value } : l))}
                        onBlur={() => autosaveLog(ymd)} />
                    </div>
                    <div className="emp-field">
                      <label>Notes</label>
                      <input type="text" value={line.description}
                        onChange={e => setDraftLines(lines => lines.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))}
                        onBlur={() => autosaveLog(ymd)} />
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="emp-btn emp-btn-secondary emp-btn-small" onClick={() => setDraftLines(l => [...l, blankDraftLine()])}>+ Add another job</button>
                  {photoFor !== ymd && (
                    <button className="emp-btn emp-btn-secondary emp-btn-small"
                      onClick={() => { setPhotoFor(ymd); setPhotoJobId(''); setError('') }}>+ Photo</button>
                  )}
                </div>

                {/* Most photos are of a specific job, so this lives right beside
                    "+ Add another job" instead of down with the day-level Note —
                    a tech is usually already looking at the job they want to
                    attach it to. */}
                {photoFor === ymd && (
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
                        {/* display:none (or visibility:hidden) on a file input silently blocks the
                            native picker from opening on iOS Safari when triggered via a wrapping
                            label — has to stay "visible" (just invisible/off-screen) for tapping the
                            label to work. capture="environment" is left off so the OS offers both
                            camera and library, matching what "Take / choose photo or video" promises. */}
                        <input type="file" accept="image/*,video/*" disabled={uploadingPhoto}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: uploadingPhoto ? 'not-allowed' : 'pointer' }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(ymd, f) }} />
                      </label>
                      <button className="emp-btn emp-btn-secondary" onClick={() => { setPhotoFor(null); setPhotoJobId('') }}>Cancel</button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.9rem' }}>
                  <button className="emp-btn" onClick={closeLog}>Done</button>
                  {savingLog && <span style={{ fontSize: '0.8rem', color: '#999' }}>Saving…</span>}
                </div>
              </div>
            ) : daySub?.time_in ? (
              <div className="emp-hint" style={{ marginBottom: '0.6rem', cursor: 'pointer' }} onClick={() => openLog(ymd)}>
                {`Shift: In ${fmtTimeShort(daySub.time_in)} · Out ${daySub.stated_time_out ? fmtTimeShort(daySub.stated_time_out) : '—'} · Lunch ${daySub.lunch_minutes ?? 0}min · PD: ${daySub.per_diem_location && daySub.per_diem_location !== 'none' ? daySub.per_diem_location : 'none'} (tap to edit)`}
              </div>
            ) : (
              // A gray "tap to..." hint line reads as informational text, not
              // as something to press — a real button here instead of just a
              // clickable hint (the guys kept asking Jim how to start a day).
              <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginBottom: '0.6rem' }}
                onClick={() => openLog(ymd)}>+ Log shift & jobs</button>
            )}

            {dayEntries.length === 0 && !daySub && <div className="emp-empty">No hours logged</div>}

            {dayEntries.map((e) => {
              const ot = otMap[e.id]?.ot || 0
              // Approved (or office-entered) hours are locked once they've been
              // reviewed — only entries a tech added themselves can be reopened.
              const locked = e.entry_source !== 'self'
              return (
                <div className="emp-job-row" key={e.id} onClick={locked ? undefined : () => navigate(`entry/${e.id}/edit`)} style={locked ? { cursor: 'default' } : undefined}>
                  <div className="emp-job-info">
                    <div className="emp-job-number">
                      {locked && <span title="Approved — office only" style={{ marginRight: '0.3rem' }}>🔒</span>}
                      {e.jobs?.job_number || (e.is_stat_pay ? 'Stat pay' : '—')}
                      {ot > 0 && <span className="emp-chip emp-chip-ot">OT {fmtHours(ot)}</span>}
                    </div>
                    {e.description && <div className="emp-job-desc">{e.description}</div>}
                  </div>
                  <div className="emp-job-hours">{fmtHours(e.hours)}h</div>
                </div>
              )
            })}

            {daySupplies.length > 0 && (
              <div className="emp-hint">
                Supplies: {daySupplies.map(s => `${s.supply_name} ×${s.quantity}`).join(', ')}
              </div>
            )}

            {dayPhotos.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {dayPhotos.map(p => (
                  <MediaThumb key={p.id} src={gearPhotoUrl(p.storage_path)} alt={p.ship_or_job || 'photo'}
                    style={{ width: '3.2rem', height: '3.2rem', objectFit: 'cover', borderRadius: '4px', border: '1px solid #ddd' }} />
                ))}
              </div>
            )}

            {daySub && (
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid #eee', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span className="emp-chip" style={{ marginLeft: 0, background: daySub.status === 'rejected' ? '#fdecea' : '#fff4de', color: daySub.status === 'rejected' ? '#c0392b' : '#a06b00' }}>
                    {daySub.status === 'rejected' ? '✗ declined — edit to resend' : '⏳ texted in — awaiting approval'}
                  </span>
                  {subTotalHours > 0 && <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{fmtHours(subTotalHours)}h</span>}
                </div>
                {(daySub.entries || []).map((e, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', color: '#555', padding: '0.15rem 0' }}>
                    {e.job_number || '?'}: {e.hours != null ? `${fmtHours(e.hours)}h` : 'hrs TBD'}{e.description ? ` — ${e.description}` : ''}
                  </div>
                ))}
                {(daySub.supplies || []).length > 0 && (
                  <div className="emp-hint">
                    Supplies: {daySub.supplies.map(s => `${s.supply_name} ×${s.quantity}`).join(', ')}
                  </div>
                )}
                {daySub.admin_note && (
                  <div className="emp-hint" style={{ whiteSpace: 'pre-line' }}>
                    Note: {daySub.admin_note}
                  </div>
                )}
                {(daySub.entries || []).length > 0 && (
                  <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginTop: '0.5rem' }}
                    onClick={() => navigate(`pending/${daySub.id}/edit`)}>Edit</button>
                )}
              </div>
            )}

            {noteFor === ymd ? (
              <div style={{ marginTop: '0.5rem' }}>
                <div className="emp-field">
                  <label>Note (not tied to a job)</label>
                  <input type="text" value={noteDraft} placeholder="Fill in your note here"
                    onChange={e => setNoteDraft(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="emp-btn" disabled={savingNote || !noteDraft.trim()} onClick={() => saveNote(ymd)}>
                    {savingNote ? 'Saving…' : 'Save note'}
                  </button>
                  <button className="emp-btn emp-btn-secondary" onClick={() => { setNoteFor(null); setNoteDraft('') }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginTop: '0.4rem', marginLeft: '0.5rem' }}
                onClick={() => { setNoteFor(ymd); setNoteDraft(''); setError('') }}>+ Note</button>
            )}

            {dayEntries.some(e => e.entry_source === 'self') && (
              <div style={{ marginTop: '0.5rem' }}>
                {dayEntries.filter(e => e.entry_source === 'self').map(e => confirmDeleteId === e.id ? (
                  <span key={e.id} style={{ marginRight: '1rem', fontSize: '0.8rem' }}>
                    Delete {e.jobs?.job_number || 'entry'}?{' '}
                    <button className="emp-inline-link" style={{ color: '#c0392b' }} onClick={() => deleteEntry(e)}>Yes</button>
                    {' / '}
                    <button className="emp-inline-link" onClick={() => setConfirmDeleteId(null)}>No</button>
                  </span>
                ) : (
                  <button key={e.id} className="emp-inline-link" style={{ marginRight: '1rem', fontSize: '0.8rem' }}
                    onClick={() => setConfirmDeleteId(e.id)}>Delete {e.jobs?.job_number || 'entry'}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div style={{ height: '5rem' }} />
      <button className="emp-btn emp-fab" onClick={() => navigate('entry/new')}>+ Add entry</button>
    </div>
  )
}
