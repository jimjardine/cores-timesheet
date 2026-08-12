import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { payWeekRange, ensureStatPay, cleanupStatPay } from '../utils/statPay'
import { computeOTMap } from '../utils/otCalc'
import { fmtHours } from '../utils/format'
import { addJobToDay } from '../utils/entrySave'
import './employee.css'

const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayYMD = () => toYMD(new Date())

function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return toYMD(d)
}

const dayName = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' })
const shortDate = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

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
  const [addJobFor, setAddJobFor] = useState(null)
  const [addJobFields, setAddJobFields] = useState({ job_id: '', hours: '', description: '' })
  const [savingJob, setSavingJob] = useState(false)
  const [noteFor, setNoteFor] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
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
    // and fix a text before Nicki reviews it. Approved ones already show up
    // above via timesheet_entries, so they're excluded here.
    const { data: subs } = await supabase.schema('Cores').from('sms_submissions')
      .select('*').eq('employee_id', employee.id)
      .gte('work_date', weekStart).lte('work_date', weekEnd)
      .neq('status', 'approved')
      .order('updated_at', { ascending: false })
    setSubmissions(subs || [])
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

  async function saveAddJob(ymd) {
    if (!addJobFields.job_id || !addJobFields.hours) { setError('Pick a job and enter hours'); return }
    if (!addJobFields.description.trim()) { setError('Add a note describing what was done'); return }
    setSavingJob(true); setError('')
    const { error: err } = await addJobToDay(supabase, {
      employeeId: employee.id, workDate: ymd,
      jobId: addJobFields.job_id, hours: addJobFields.hours, description: addJobFields.description,
      entrySource: 'self', confirmationStatus: 'not_required',
    })
    if (err) { setError(err.message); setSavingJob(false); return }
    await ensureStatPay(employee.id, ymd)
    await load()
    setSavingJob(false)
    setAddJobFor(null)
    setAddJobFields({ job_id: '', hours: '', description: '' })
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

            {addJobFor === ymd ? (
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid #eee', paddingTop: '0.75rem' }}>
                <div className="emp-field">
                  <label>Job</label>
                  <select value={addJobFields.job_id} onChange={e => setAddJobFields(f => ({ ...f, job_id: e.target.value }))}>
                    <option value="">Select a job…</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.vessels?.name || j.description}</option>)}
                  </select>
                </div>
                <div className="emp-field">
                  <label>Hours</label>
                  <input type="number" step="0.25" min="0" value={addJobFields.hours}
                    onChange={e => setAddJobFields(f => ({ ...f, hours: e.target.value }))} />
                </div>
                <div className="emp-field">
                  <label>Notes</label>
                  <input type="text" value={addJobFields.description}
                    onChange={e => setAddJobFields(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="emp-btn" disabled={savingJob} onClick={() => saveAddJob(ymd)}>
                    {savingJob ? 'Saving…' : 'Save job'}
                  </button>
                  <button className="emp-btn emp-btn-secondary" onClick={() => setAddJobFor(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="emp-btn emp-btn-secondary emp-btn-small" style={{ marginTop: '0.6rem' }}
                onClick={() => { setAddJobFor(ymd); setError('') }}>+ Add job</button>
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
