import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import MediaThumb from './MediaThumb'
import MediaViewer from './MediaViewer'
import { getAdminName } from './PasswordGate'
import JobPicker from '../employee/JobPicker'
import PersonPicker from './PersonPicker'
import { looksLikeSameSupply } from '../utils/supplyMatch'

const publicUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl

const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtSize = (bytes) => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—'
// Local calendar date — toISOString() is UTC and rolls to tomorrow after 9pm Atlantic
const toYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function GearPhotos() {
  const [photos, setPhotos]     = useState([])
  const [jobs, setJobs]         = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all')
  const [jobFilterId, setJobFilterId] = useState('')
  // Live text as it's typed into the job filter — narrows the photo grid on
  // every keystroke, same as JobPicker's own dropdown does internally.
  // jobFilterId (an exact pick) takes priority over this once set.
  const [jobFilterQuery, setJobFilterQuery] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  // Same live-as-you-type behaviour as jobFilterQuery, for the person filter.
  const [employeeFilterQuery, setEmployeeFilterQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [customDate, setCustomDate] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [edits, setEdits]       = useState({})
  const [noteDrafts, setNoteDrafts] = useState({})
  // Supply lines tied to a photo (job_supplies.source_photo_id), keyed by
  // photo id. applied_at null = saved but not on the timesheet; applied_at
  // set = on the timesheet (and so on the reports/billing/PDF).
  const [suppliesByPhoto, setSuppliesByPhoto] = useState({})
  // Lines she's added on this card but hasn't saved yet, keyed by photo id.
  // Kept out of the database until Save so "+ Add line" can't spam empty rows.
  const [newLines, setNewLines] = useState({})
  // Local edits to an already-saved row, keyed by row id, flushed on Save.
  const [rowEdits, setRowEdits] = useState({})
  // Checkbox overrides, keyed by row id — absent means "same as stored".
  const [checkedRows, setCheckedRows] = useState({})
  const [savingPhotoId, setSavingPhotoId] = useState(null)
  // `${employee_id}|${work_date}` for every day that already has a real
  // timesheet entry. job_supplies has no FK to timesheet_entries — a supply
  // applied for an employee/day with no entry yet would sit invisible until
  // one showed up, so Save to Timesheet is blocked until there's an entry
  // for it to actually attach to.
  const [entryDays, setEntryDays] = useState(new Set())
  // Same key, but for a day whose hours were texted in and are still
  // awaiting admin approval (no timesheet_entries row yet, but not "nothing
  // logged" either) — lets the blocked message tell the two apart instead of
  // reading like the tech never reported their hours at all.
  const [pendingDays, setPendingDays] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: j }, { data: emps }, { data: logged }, { data: entries }, { data: pending }] = await Promise.all([
      supabase.schema('Cores').from('gear_photos').select('*').order('created_at', { ascending: false }),
      // Include closed jobs: a photo can legitimately be tagged to a job that's
      // since closed, and excluding them silently nulled out job_id (photo vanished
      // from every report with no error).
      supabase.schema('Cores').from('jobs').select('id, job_number, description, status, vessels(name)'),
      supabase.schema('Cores').from('employees').select('id, name'),
      supabase.schema('Cores').from('job_supplies').select('id, source_photo_id, supply_name, quantity, applied_at, applied_by').not('source_photo_id', 'is', null),
      supabase.schema('Cores').from('timesheet_entries').select('employee_id, work_date'),
      supabase.schema('Cores').from('sms_submissions').select('employee_id, work_date').in('status', ['submitted', 'collecting']),
    ])
    setPhotos(p || [])
    setJobs(j || [])
    setEmployees(emps || [])
    const byPhoto = {}
    for (const row of logged || []) {
      (byPhoto[row.source_photo_id] ||= []).push(row)
    }
    setSuppliesByPhoto(byPhoto)
    setEntryDays(new Set((entries || []).map(e => `${e.employee_id}|${e.work_date}`)))
    setPendingDays(new Set((pending || []).map(e => `${e.employee_id}|${e.work_date}`)))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const employeeName = (id) => employees.find(e => e.id === id)?.name || null
  const hasEntryForPhoto = (photo) => photo.employee_id && entryDays.has(`${photo.employee_id}|${photo.work_date}`)
  const hasPendingSubmission = (photo) => photo.employee_id && pendingDays.has(`${photo.employee_id}|${photo.work_date}`)

  // Same substring match JobPicker's own dropdown uses, so what the grid
  // shows always agrees with what the dropdown suggests.
  function jobMatchesQuery(job, q) {
    if (!job) return false
    return job.job_number.toLowerCase().includes(q)
      || (job.vessels?.name || '').toLowerCase().includes(q)
      || (job.description || '').toLowerCase().includes(q)
  }

  const visible = photos.filter(p => {
    if (filter === 'needs_context' && !p.pending_context) return false
    if (filter === 'supply' && p.photo_type !== 'supply') return false
    if (filter === 'reference' && p.photo_type !== 'reference') return false
    if (jobFilterId) {
      if (p.job_id !== jobFilterId) return false
    } else if (jobFilterQuery.trim()) {
      if (!jobMatchesQuery(jobs.find(j => j.id === p.job_id), jobFilterQuery.trim().toLowerCase())) return false
    }
    if (employeeFilter) {
      if (p.employee_id !== employeeFilter) return false
    } else if (employeeFilterQuery.trim()) {
      if (!(employeeName(p.employee_id) || '').toLowerCase().includes(employeeFilterQuery.trim().toLowerCase())) return false
    }
    if (dateFilter === 'today' && p.work_date !== toYMD(new Date())) return false
    if (dateFilter === 'custom' && customDate && p.work_date !== customDate) return false
    return true
  })
  const hasActiveFilter = filter !== 'all' || jobFilterId || jobFilterQuery.trim() || employeeFilter || employeeFilterQuery.trim() || dateFilter !== 'all'

  async function saveContext(photo, value) {
    setSavingId(photo.id)
    const jobId = jobs.find(j => j.job_number.toUpperCase() === value.trim().toUpperCase())?.id || null
    const { error } = await supabase.schema('Cores').from('gear_photos')
      .update({ ship_or_job: value, job_id: jobId, pending_context: !value })
      .eq('id', photo.id)
    if (error) alert('Error saving: ' + error.message)
    else {
      setPhotos(p => p.map(x => x.id === photo.id ? { ...x, ship_or_job: value, job_id: jobId, pending_context: !value } : x))
      setEdits(e => { const n = { ...e }; delete n[photo.id]; return n })
    }
    setSavingId(null)
  }

  // Toggle: clicking the already-selected type clears it back to unclassified.
  async function savePhotoType(photo, value) {
    const next = photo.photo_type === value ? null : value
    setSavingId(photo.id)
    const { error } = await supabase.schema('Cores').from('gear_photos')
      .update({ photo_type: next })
      .eq('id', photo.id)
    if (error) alert('Error saving: ' + error.message)
    else setPhotos(p => p.map(x => x.id === photo.id ? { ...x, photo_type: next } : x))
    setSavingId(null)
  }

  // Whether a line is ticked to go on the timesheet. Persisted rows default to
  // whatever they already are (applied = ticked), so opening a card and saving
  // without touching anything is a no-op rather than a mass un-apply.
  const isChecked = (row) => checkedRows[row.id] ?? !!row.applied_at

  // A pending (texted-in, not-yet-approved) submission is enough to save a
  // supply against — she doesn't have to wait for admin approval to log
  // what's in a photo. It just won't show in the Edit Entry modal's
  // Supplies list until that submission is approved and a real
  // timesheet_entries row exists for it to attach to (still visible on the
  // Supplies report either way).
  const canSaveSupply = (photo) => hasEntryForPhoto(photo) || hasPendingSubmission(photo)

  // Only reachable when there's truly nothing logged for that employee/day —
  // a pending submission is enough to save against, so this isn't "no entry",
  // it's "no entry and nothing pending either."
  function blockedReason(photo) {
    const name = employeeName(photo.employee_id) || 'This employee'
    const date = fmtDate(photo.work_date)
    return `${name} doesn't have a timesheet entry for ${date} yet — supplies can't be saved until hours are logged for that day.`
  }

  // The not-yet-saved lines for a card — a fresh photo defaults to one line
  // pre-filled from the tech's note, shown before she's touched anything.
  // Shared between the render and the save so accepting that default and
  // hitting Save immediately actually saves it, instead of silently saving
  // nothing because newLines[photo.id] was never set by an onChange.
  const linesForPhoto = (photo) => {
    const rows = suppliesByPhoto[photo.id] || []
    const pending = newLines[photo.id]
    return pending ?? (rows.length === 0
      ? [{ key: 'l0', supply_name: photo.note || '', quantity: '1', checked: true }]
      : [])
  }

  // The one write for the whole card: every ticked line ends up on the
  // timesheet, every unticked one doesn't. Unticking an already-applied line
  // takes it back off — same fully reversible posture as the billed checkbox.
  async function saveToTimesheet(photo) {
    if (!canSaveSupply(photo)) {
      alert(blockedReason(photo))
      return
    }
    const rows = suppliesByPhoto[photo.id] || []
    const pending = linesForPhoto(photo).filter(l => l.supply_name.trim())

    // Guard against logging the same consumable twice for the same job/day —
    // once from this photo, once already from elsewhere (typically the tech's
    // own text report saying the same thing). Only lines actually about to go
    // on the timesheet are worth checking; an unticked line isn't applying.
    const namesGoingOn = [
      ...pending.filter(l => l.checked).map(l => l.supply_name.trim()),
      ...rows.filter(row => isChecked(row) && (rowEdits[row.id]?.supply_name ?? row.supply_name).trim())
        .map(row => (rowEdits[row.id]?.supply_name ?? row.supply_name).trim()),
    ]
    if (namesGoingOn.length > 0 && photo.job_id) {
      const { data: sameJobDay } = await supabase.schema('Cores').from('job_supplies')
        .select('supply_name, source_photo_id')
        .eq('employee_id', photo.employee_id).eq('work_date', photo.work_date).eq('job_id', photo.job_id)
        .not('applied_at', 'is', null)
      // Rows already on this same photo sit side by side deliberately (that's
      // what "+ Add line" is for) — only cross-check against other photos/text.
      const elsewhere = (sameJobDay || []).filter(r => r.source_photo_id !== photo.id)
      const dupes = []
      for (const name of namesGoingOn) {
        const hit = elsewhere.find(r => looksLikeSameSupply(name, r.supply_name))
        if (hit) dupes.push({ name, existing: hit.supply_name, source: hit.source_photo_id ? 'another photo' : 'a text report' })
      }
      // Just tell her exactly what's already there and let her decide —
      // she knows whether this is the same can or a second one.
      if (dupes.length === 1) {
        const d = dupes[0]
        if (!confirm(`There's already a "${d.existing}" logged for this job today (from ${d.source}). Do you want to add "${d.name}" as well?`)) return
      } else if (dupes.length > 1) {
        const list = dupes.map(d => `"${d.existing}" (from ${d.source}) — you're also about to add "${d.name}"`).join('\n')
        if (!confirm(`Some of these look like they're already logged for this job today:\n\n${list}\n\nAdd them anyway?`)) return
      }
    }

    const stamp = { applied_at: new Date().toISOString(), applied_by: getAdminName() }
    const cleared = { applied_at: null, applied_by: null }
    setSavingPhotoId(photo.id)

    const inserts = pending.map(l => ({
      job_id: photo.job_id,
      employee_id: photo.employee_id,
      work_date: photo.work_date,
      supply_name: l.supply_name.trim(),
      quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
      source_photo_id: photo.id,
      ...(l.checked ? stamp : cleared),
    }))
    if (inserts.length > 0) {
      const { error } = await supabase.schema('Cores').from('job_supplies').insert(inserts)
      if (error) { alert('Error saving: ' + error.message); setSavingPhotoId(null); return }
    }

    for (const row of rows) {
      const edit = rowEdits[row.id]
      const supply_name = (edit?.supply_name ?? row.supply_name).trim()
      if (!supply_name) continue
      const quantity = Number(edit?.quantity ?? row.quantity) > 0 ? Number(edit?.quantity ?? row.quantity) : 1
      const checked = isChecked(row)
      const wasApplied = !!row.applied_at
      const unchanged = supply_name === row.supply_name && quantity === Number(row.quantity) && checked === wasApplied
      if (unchanged) continue
      const { error } = await supabase.schema('Cores').from('job_supplies')
        .update({ supply_name, quantity, ...(checked ? (wasApplied ? {} : stamp) : cleared) })
        .eq('id', row.id)
      if (error) { alert('Error saving: ' + error.message); setSavingPhotoId(null); return }
    }

    // Re-read rather than patching local state by hand — several rows can
    // change per save, and this keeps the card honest about what's stored.
    const { data: fresh } = await supabase.schema('Cores').from('job_supplies')
      .select('id, source_photo_id, supply_name, quantity, applied_at, applied_by')
      .eq('source_photo_id', photo.id)
    setSuppliesByPhoto(m => ({ ...m, [photo.id]: fresh || [] }))
    setNewLines(d => { const n = { ...d }; delete n[photo.id]; return n })
    setRowEdits(d => {
      const n = { ...d }
      for (const r of rows) delete n[r.id]
      return n
    })
    setCheckedRows(c => {
      const n = { ...c }
      for (const r of rows) delete n[r.id]
      return n
    })
    setSavingPhotoId(null)
  }

  async function saveNote(photo) {
    const value = (noteDrafts[photo.id] ?? '').trim()
    setSavingId(photo.id)
    const { error } = await supabase.schema('Cores').from('gear_photos')
      .update({ note: value || null })
      .eq('id', photo.id)
    if (error) alert('Error saving note: ' + error.message)
    else {
      setPhotos(p => p.map(x => x.id === photo.id ? { ...x, note: value || null } : x))
      setNoteDrafts(d => { const n = { ...d }; delete n[photo.id]; return n })
    }
    setSavingId(null)
  }

  async function remove(photo) {
    if (!confirm('Delete this photo? This removes the file and its record permanently.')) return
    setSavingId(photo.id)
    const { error: storageError } = await supabase.storage.from('gear-photos').remove([photo.storage_path])
    if (storageError) { alert('Error deleting file: ' + storageError.message); setSavingId(null); return }
    const { error } = await supabase.schema('Cores').from('gear_photos').delete().eq('id', photo.id)
    if (error) alert('File removed but record delete failed: ' + error.message)
    else setPhotos(p => p.filter(x => x.id !== photo.id))
    setSavingId(null)
  }

  const filterBtn = (key, label) => (
    <button
      onClick={() => setFilter(key)}
      style={{
        padding: '0.4rem 0.9rem', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
        background: filter === key ? '#0066cc' : '#fff',
        color: filter === key ? '#fff' : '#333',
        borderColor: filter === key ? '#0066cc' : '#ccc',
      }}
    >{label}</button>
  )

  if (loading) return <div style={{ padding: '2rem' }}>Loading photos…</div>

  return (
    <div style={{ padding: '1.5rem 2rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Gear Photos</h2>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>{photos.length} total</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '1rem' }}>
          <JobPicker
            jobs={jobs}
            value={jobFilterId}
            onChange={job => { setJobFilterId(job.id); setJobFilterQuery('') }}
            // Typing supersedes a prior exact pick, so the grid goes back to
            // live-filtering instead of staying locked to the old selection —
            // but a bare focus (query still empty) shouldn't itself clear it,
            // or just clicking into the box to look at it would reset the filter.
            onQueryChange={q => { setJobFilterQuery(q); if (q.trim()) setJobFilterId('') }}
            placeholder="Filter by job #..."
            inputStyle={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', minWidth: 200 }}
          />
          {jobFilterId && (
            <button
              onClick={() => { setJobFilterId(''); setJobFilterQuery('') }}
              title="Clear job filter"
              style={{ padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: 6, background: '#fff', color: '#666', cursor: 'pointer', fontSize: '0.85rem' }}
            >✕</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <PersonPicker
            employees={employees.slice().sort((a, b) => a.name.localeCompare(b.name))}
            value={employeeFilter}
            onChange={id => { setEmployeeFilter(id); setEmployeeFilterQuery('') }}
            onQueryChange={q => { setEmployeeFilterQuery(q); if (q.trim()) setEmployeeFilter('') }}
            placeholder="Filter by person..."
            inputStyle={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', width: 170 }}
          />
          {employeeFilter && (
            <button
              onClick={() => { setEmployeeFilter(''); setEmployeeFilterQuery('') }}
              title="Clear person filter"
              style={{ padding: '0.3rem 0.5rem', border: '1px solid #ccc', borderRadius: 6, background: '#fff', color: '#666', cursor: 'pointer', fontSize: '0.85rem' }}
            >✕</button>
          )}
        </div>
        <button
          onClick={() => {
            if (dateFilter === 'all') { setDateFilter('today'); setCustomDate('') }
            else { setDateFilter('all'); setCustomDate('') }
          }}
          style={{
            padding: '0.4rem 0.9rem', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
            background: dateFilter !== 'all' ? '#0066cc' : '#fff',
            color: dateFilter !== 'all' ? '#fff' : '#333',
            borderColor: dateFilter !== 'all' ? '#0066cc' : '#ccc',
          }}
        >{dateFilter === 'all' ? 'Today' : 'Clear'}</button>
        <input
          type="date"
          value={customDate}
          onChange={e => { setCustomDate(e.target.value); setDateFilter(e.target.value ? 'custom' : 'all') }}
          style={{ padding: '0.35rem 0.5rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {filterBtn('all', 'All')}
          {filterBtn('needs_context', `Needs ship/job (${photos.filter(p => p.pending_context).length})`)}
          {filterBtn('supply', `🔧 Supplies (${photos.filter(p => p.photo_type === 'supply').length})`)}
          {filterBtn('reference', `📋 Reference (${photos.filter(p => p.photo_type === 'reference').length})`)}
        </div>
      </div>

      {visible.length === 0 && (
        <div style={{ color: '#888', padding: '2rem 0', textAlign: 'center' }}>
          No photos {hasActiveFilter ? 'match this filter' : 'have been texted in yet'}.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
        {visible.map(photo => {
          const matchedJob = jobs.find(j => j.job_number.toUpperCase() === (photo.ship_or_job || '').toUpperCase())
          const name = employeeName(photo.employee_id)
          return (
            <div key={photo.id} style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              <div
                onClick={() => setLightbox(photo)}
                style={{ aspectRatio: '4 / 3', background: '#f0f0f0', cursor: 'pointer', overflow: 'hidden' }}
              >
                <MediaThumb
                  src={publicUrl(photo.storage_path)}
                  alt={photo.ship_or_job || 'gear photo'}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <div style={{ padding: '0.6rem 0.75rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.3rem' }}>
                  {fmtDate(photo.work_date)} · {fmtTime(photo.created_at)} {name ? `· ${name}` : `· ${photo.from_phone}`}
                </div>
                {(() => {
                  const draft = edits[photo.id] ?? (photo.ship_or_job || '')
                  const dirty = draft !== (photo.ship_or_job || '')
                  return (
                    <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                      <input
                        value={draft}
                        onChange={e => setEdits(x => ({ ...x, [photo.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && dirty) saveContext(photo, draft) }}
                        placeholder="ship or job #"
                        disabled={savingId === photo.id}
                        style={{
                          flex: 1, minWidth: 0, padding: '0.3rem 0.4rem', fontSize: '0.85rem', borderRadius: 4,
                          border: `1px solid ${photo.pending_context ? '#e0a030' : '#ccc'}`,
                        }}
                      />
                      {dirty && (
                        <button
                          onClick={() => saveContext(photo, draft)}
                          disabled={savingId === photo.id}
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid #0066cc', background: '#0066cc', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                        >Save</button>
                      )}
                    </div>
                  )
                })()}
                {matchedJob && (
                  <div style={{ fontSize: '0.75rem', color: matchedJob.status === 'closed' ? '#888' : '#2a7a2a', marginBottom: '0.3rem' }}>
                    ✓ {matchedJob.description}{matchedJob.status === 'closed' ? ' (closed)' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                  {[['supply', '🔧 Supply'], ['reference', '📋 Reference']].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => savePhotoType(photo, key)}
                      disabled={savingId === photo.id}
                      style={{
                        flex: 1, padding: '0.3rem 0.4rem', fontSize: '0.78rem', borderRadius: 4, cursor: 'pointer',
                        border: `1px solid ${photo.photo_type === key ? '#0066cc' : '#ccc'}`,
                        background: photo.photo_type === key ? '#0066cc' : '#fff',
                        color: photo.photo_type === key ? '#fff' : '#555',
                      }}
                    >{label}</button>
                  ))}
                </div>
                {(() => {
                  const noteDraft = noteDrafts[photo.id] ?? (photo.note || '')
                  const noteDirty = noteDraft !== (photo.note || '')
                  return (
                    <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                      <textarea
                        value={noteDraft}
                        onChange={e => setNoteDrafts(d => ({ ...d, [photo.id]: e.target.value }))}
                        placeholder="Add a note about this photo..."
                        rows={2}
                        disabled={savingId === photo.id}
                        style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.4rem', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #ccc', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      {noteDirty && (
                        <button
                          onClick={() => saveNote(photo)}
                          disabled={savingId === photo.id}
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', border: '1px solid #0066cc', background: '#0066cc', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                        >Save</button>
                      )}
                    </div>
                  )
                })()}
                {photo.job_id && photo.photo_type === 'supply' && (() => {
                  const rows = suppliesByPhoto[photo.id] || []
                  // Start her off with one line pre-filled from whatever the
                  // tech texted in, so the common case is tick-and-save.
                  const lines = linesForPhoto(photo)
                  const busy = savingPhotoId === photo.id
                  const canSave = canSaveSupply(photo)
                  const stillPending = canSave && !hasEntryForPhoto(photo)
                  // Once a line is on the timesheet, re-clicking Save with
                  // nothing changed must do nothing — otherwise there's no
                  // visible difference between "already processed" and "not
                  // saved yet," and the natural response to that uncertainty
                  // is to hit + Add line and re-type the same supply,
                  // creating a real duplicate row for the same photo.
                  const hasNewContent = lines.some(l => l.supply_name.trim())
                  const hasRowEdits = rows.some(row => {
                    if (isChecked(row) !== !!row.applied_at) return true
                    const edit = rowEdits[row.id]
                    if (!edit) return false
                    return edit.supply_name.trim() !== row.supply_name || Number(edit.quantity) !== Number(row.quantity)
                  })
                  const hasUnsaved = hasNewContent || hasRowEdits
                  const qtyStyle = { width: '3.2rem', padding: '0.3rem 0.4rem', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #ccc' }
                  const descStyle = { flex: 1, minWidth: 0, padding: '0.3rem 0.4rem', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #ccc' }

                  const setLines = (next) => setNewLines(d => ({ ...d, [photo.id]: next }))

                  return (
                    <div style={{ marginBottom: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {!canSave && (
                        <div style={{ fontSize: '0.72rem', color: '#a05a00', background: '#fff6e8', border: '1px solid #f0d9a8', borderRadius: 4, padding: '0.35rem 0.5rem' }}>
                          {blockedReason(photo)}
                        </div>
                      )}
                      {stillPending && (
                        <div style={{ fontSize: '0.72rem', color: '#555', background: '#f3f6fa', border: '1px solid #dbe4ee', borderRadius: 4, padding: '0.35rem 0.5rem' }}>
                          {employeeName(photo.employee_id) || 'This employee'}'s hours for {fmtDate(photo.work_date)} are still awaiting approval — this will show on the timesheet once that submission is approved.
                        </div>
                      )}
                      {rows.map(row => {
                        // Ticked, applied, no pending edit — this row is already on
                        // the timesheet and there's nothing left to do with it here.
                        // A live checkbox + editable fields looked identical to a
                        // still-unsaved line; shown instead as plain, greyed-out
                        // text. Click it to unlock — for a typo fix or to take it
                        // back off the timesheet.
                        const locked = !!row.applied_at && isChecked(row) && !rowEdits[row.id]
                        if (locked) {
                          return (
                            <div key={row.id}
                              onClick={() => setRowEdits(d => ({ ...d, [row.id]: { supply_name: row.supply_name, quantity: String(row.quantity) } }))}
                              title="On the timesheet — click to edit or remove"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.4rem', color: '#999', background: '#f5f5f5', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              <span>{row.quantity} × {row.supply_name}</span>
                            </div>
                          )
                        }
                        const v = rowEdits[row.id] ?? { supply_name: row.supply_name, quantity: String(row.quantity) }
                        const set = (patch) => setRowEdits(d => ({ ...d, [row.id]: { ...v, ...patch } }))
                        return (
                          <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input type="checkbox" checked={isChecked(row)} disabled={busy}
                              title={row.applied_at ? 'On the timesheet — untick and save to take it off' : 'Tick and save to put it on the timesheet'}
                              onChange={e => setCheckedRows(c => ({ ...c, [row.id]: e.target.checked }))}
                              style={{ width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer' }} />
                            <input type="number" min="0" step="1" value={v.quantity} disabled={busy}
                              onChange={e => set({ quantity: e.target.value })} style={qtyStyle} />
                            <input value={v.supply_name} placeholder="Description" disabled={busy}
                              onChange={e => set({ supply_name: e.target.value })} style={descStyle} />
                          </div>
                        )
                      })}
                      {lines.map((l, i) => (
                        <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <input type="checkbox" checked={l.checked} disabled={busy}
                            title="Tick and save to put it on the timesheet"
                            onChange={e => setLines(lines.map((x, xi) => xi === i ? { ...x, checked: e.target.checked } : x))}
                            style={{ width: '1rem', height: '1rem', flexShrink: 0, cursor: 'pointer' }} />
                          <input type="number" min="0" step="1" value={l.quantity} disabled={busy}
                            onChange={e => setLines(lines.map((x, xi) => xi === i ? { ...x, quantity: e.target.value } : x))}
                            style={qtyStyle} />
                          <input value={l.supply_name} placeholder="Description" disabled={busy}
                            onChange={e => setLines(lines.map((x, xi) => xi === i ? { ...x, supply_name: e.target.value } : x))}
                            style={descStyle} />
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          onClick={() => setLines([...lines, { key: `l${Date.now()}`, supply_name: '', quantity: '1', checked: true }])}
                          disabled={busy}
                          style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.78rem', border: '1px dashed #0066cc', background: '#fff', color: '#0066cc', borderRadius: 4, cursor: 'pointer' }}
                        >+ Add line</button>
                        <button
                          onClick={() => saveToTimesheet(photo)}
                          disabled={busy || !canSave || !hasUnsaved}
                          title={!canSave ? blockedReason(photo) : !hasUnsaved ? 'Already on the timesheet — nothing new to save' : undefined}
                          style={{
                            flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.78rem', borderRadius: 4,
                            border: `1px solid ${canSave && hasUnsaved ? '#0066cc' : '#ccc'}`,
                            background: canSave && hasUnsaved ? '#0066cc' : '#eee',
                            color: canSave && hasUnsaved ? '#fff' : '#999',
                            cursor: canSave && hasUnsaved ? 'pointer' : 'not-allowed',
                          }}
                        >{busy ? 'Saving…' : !canSave || hasUnsaved ? 'Save to Timesheet' : 'Saved ✓'}</button>
                      </div>
                    </div>
                  )
                })()}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#aaa' }}>
                  <span>{fmtSize(photo.file_size_bytes)}</span>
                  {photo.photo_latitude && photo.photo_longitude && (
                    <a
                      href={`https://maps.google.com/?q=${photo.photo_latitude},${photo.photo_longitude}`}
                      target="_blank" rel="noreferrer"
                      style={{ color: '#0066cc' }}
                    >📍 map</a>
                  )}
                  <button
                    onClick={() => remove(photo)}
                    disabled={savingId === photo.id}
                    style={{ border: 'none', background: 'transparent', color: '#c00', cursor: 'pointer', fontSize: '0.8rem' }}
                  >delete</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', cursor: 'zoom-out',
          }}
        >
          {/* Click-through blocked for both — video so tapping play/pause/scrub on
              the native controls doesn't also close the lightbox, images so
              MediaViewer's own click-drag-to-pan doesn't close it either. Only
              clicking the surrounding backdrop closes it now. */}
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          >
            <MediaViewer
              src={publicUrl(lightbox.storage_path)}
              alt={lightbox.ship_or_job || 'gear photo'}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
