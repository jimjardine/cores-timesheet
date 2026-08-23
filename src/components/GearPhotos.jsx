import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import MediaThumb from './MediaThumb'
import MediaViewer from './MediaViewer'
import { getAdminName } from './PasswordGate'
import JobPicker from '../employee/JobPicker'
import PersonPicker from './PersonPicker'

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
  // photo id. applied_at null = still a draft (autosaved as she types, not
  // yet on any report/billing/PDF); applied_at set = real, via "Apply to
  // Timesheet". Lets a card show both without losing either on reload.
  const [suppliesByPhoto, setSuppliesByPhoto] = useState({})
  // A not-yet-saved draft line, keyed by photo id — nothing is inserted
  // until she actually types a description, so marking a photo "Supply"
  // doesn't spam empty rows into job_supplies.
  const [newDraft, setNewDraft] = useState({})
  // Local edits to an existing (already-inserted) draft row, keyed by row id,
  // flushed on blur — same save-on-blur convention as the mobile day-card panel.
  const [rowEdits, setRowEdits] = useState({})
  const [supplySavingId, setSupplySavingId] = useState(null)
  const [applyingId, setApplyingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: j }, { data: emps }, { data: logged }] = await Promise.all([
      supabase.schema('Cores').from('gear_photos').select('*').order('created_at', { ascending: false }),
      // Include closed jobs: a photo can legitimately be tagged to a job that's
      // since closed, and excluding them silently nulled out job_id (photo vanished
      // from every report with no error).
      supabase.schema('Cores').from('jobs').select('id, job_number, description, status, vessels(name)'),
      supabase.schema('Cores').from('employees').select('id, name'),
      supabase.schema('Cores').from('job_supplies').select('id, source_photo_id, supply_name, quantity, applied_at, applied_by').not('source_photo_id', 'is', null),
    ])
    setPhotos(p || [])
    setJobs(j || [])
    setEmployees(emps || [])
    const byPhoto = {}
    for (const row of logged || []) {
      (byPhoto[row.source_photo_id] ||= []).push(row)
    }
    setSuppliesByPhoto(byPhoto)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const employeeName = (id) => employees.find(e => e.id === id)?.name || null

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

  // Autosave (blur) a not-yet-inserted draft line — nothing is written until
  // there's an actual description, so opening the Supply fields doesn't by
  // itself create a row.
  async function saveNewDraft(photo) {
    const draft = newDraft[photo.id]
    const supply_name = (draft?.supply_name || '').trim()
    if (!supply_name) return
    const quantity = Number(draft?.quantity) > 0 ? Number(draft.quantity) : 1
    setSupplySavingId('new-' + photo.id)
    const { data, error } = await supabase.schema('Cores').from('job_supplies').insert({
      job_id: photo.job_id,
      employee_id: photo.employee_id,
      work_date: photo.work_date,
      supply_name,
      quantity,
      source_photo_id: photo.id,
    }).select('id, source_photo_id, supply_name, quantity, applied_at, applied_by').single()
    if (error) alert('Error saving: ' + error.message)
    else {
      setSuppliesByPhoto(m => ({ ...m, [photo.id]: [...(m[photo.id] || []), data] }))
      setNewDraft(d => { const n = { ...d }; delete n[photo.id]; return n })
    }
    setSupplySavingId(null)
  }

  // Autosave (blur) edits to an already-inserted draft row.
  async function saveDraftRow(photo, row) {
    const edit = rowEdits[row.id]
    if (!edit) return
    const supply_name = edit.supply_name.trim()
    if (!supply_name) return
    const quantity = Number(edit.quantity) > 0 ? Number(edit.quantity) : 1
    if (supply_name === row.supply_name && quantity === Number(row.quantity)) return
    setSupplySavingId(row.id)
    const { error } = await supabase.schema('Cores').from('job_supplies')
      .update({ supply_name, quantity }).eq('id', row.id)
    if (error) alert('Error saving: ' + error.message)
    else setSuppliesByPhoto(m => ({ ...m, [photo.id]: (m[photo.id] || []).map(r => r.id === row.id ? { ...r, supply_name, quantity } : r) }))
    setSupplySavingId(null)
  }

  // Turns a draft into a real, billable job_supplies row — deliberate and
  // explicit (she reviews the photo, confirms the description/quantity),
  // not automatic, so nothing lands on the timesheet/billing checklist she
  // didn't actually mean to apply.
  async function applyDraft(photo, row) {
    const edit = rowEdits[row.id] ?? { supply_name: row.supply_name, quantity: String(row.quantity) }
    const supply_name = edit.supply_name.trim()
    if (!supply_name) return
    const quantity = Number(edit.quantity) > 0 ? Number(edit.quantity) : 1
    setApplyingId(row.id)
    const applied_at = new Date().toISOString()
    const applied_by = getAdminName()
    const { error } = await supabase.schema('Cores').from('job_supplies')
      .update({ supply_name, quantity, applied_at, applied_by }).eq('id', row.id)
    if (error) alert('Error applying: ' + error.message)
    else {
      setSuppliesByPhoto(m => ({ ...m, [photo.id]: (m[photo.id] || []).map(r => r.id === row.id ? { ...r, supply_name, quantity, applied_at, applied_by } : r) }))
      setRowEdits(d => { const n = { ...d }; delete n[row.id]; return n })
    }
    setApplyingId(null)
  }

  // Same as applyDraft, but for a line that hasn't been inserted yet —
  // one insert, already stamped applied, rather than insert-then-update.
  async function applyNewDraft(photo) {
    const draft = newDraft[photo.id]
    const supply_name = (draft?.supply_name || '').trim()
    if (!supply_name) return
    const quantity = Number(draft?.quantity) > 0 ? Number(draft.quantity) : 1
    setApplyingId('new-' + photo.id)
    const applied_at = new Date().toISOString()
    const applied_by = getAdminName()
    const { data, error } = await supabase.schema('Cores').from('job_supplies').insert({
      job_id: photo.job_id,
      employee_id: photo.employee_id,
      work_date: photo.work_date,
      supply_name,
      quantity,
      source_photo_id: photo.id,
      applied_at,
      applied_by,
    }).select('id, source_photo_id, supply_name, quantity, applied_at, applied_by').single()
    if (error) alert('Error applying: ' + error.message)
    else {
      setSuppliesByPhoto(m => ({ ...m, [photo.id]: [...(m[photo.id] || []), data] }))
      setNewDraft(d => { const n = { ...d }; delete n[photo.id]; return n })
    }
    setApplyingId(null)
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
                  const applied = rows.filter(r => r.applied_at)
                  const drafts = rows.filter(r => !r.applied_at)
                  const hasNewDraft = newDraft[photo.id] !== undefined
                  // Show an empty draft row as soon as the photo is marked Supply —
                  // no extra click needed — until there's a real draft or new-draft
                  // in play, at which point "+ add another item" takes over.
                  const showBlankDraft = drafts.length === 0 && !hasNewDraft

                  const draftRow = (row, isNew) => {
                    const key = isNew ? `new-${photo.id}` : row.id
                    const value = isNew
                      ? (newDraft[photo.id] ?? { supply_name: photo.note || '', quantity: '1' })
                      : (rowEdits[row.id] ?? { supply_name: row.supply_name, quantity: String(row.quantity) })
                    const setValue = (patch) => {
                      if (isNew) setNewDraft(d => ({ ...d, [photo.id]: { ...value, ...patch } }))
                      else setRowEdits(d => ({ ...d, [row.id]: { ...value, ...patch } }))
                    }
                    const onBlurSave = () => (isNew ? saveNewDraft(photo) : saveDraftRow(photo, row))
                    const onApply = () => (isNew ? applyNewDraft(photo) : applyDraft(photo, row))
                    const busy = supplySavingId === key || applyingId === key
                    return (
                      <div key={key} style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <input
                          value={value.supply_name}
                          onChange={e => setValue({ supply_name: e.target.value })}
                          onBlur={onBlurSave}
                          placeholder="Description"
                          disabled={busy}
                          style={{ padding: '0.3rem 0.4rem', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #ccc' }}
                        />
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          <input
                            type="number" min="0" step="1"
                            value={value.quantity}
                            onChange={e => setValue({ quantity: e.target.value })}
                            onBlur={onBlurSave}
                            disabled={busy}
                            style={{ width: '4.5rem', padding: '0.3rem 0.4rem', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #ccc' }}
                          />
                          <button
                            // Without this, a mouse click moves focus off the
                            // input first, firing its onBlur autosave (an
                            // insert, for a fresh draft) a beat before this
                            // onClick's own insert/update — two racing writes
                            // for the same click. Blocking the focus change
                            // means only this handler's write happens.
                            onMouseDown={e => e.preventDefault()}
                            onClick={onApply}
                            disabled={busy || !value.supply_name.trim()}
                            style={{ flex: 1, padding: '0.3rem 0.5rem', fontSize: '0.78rem', border: '1px solid #0066cc', background: '#0066cc', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
                          >Apply to Timesheet</button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div style={{ marginBottom: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {applied.map(row => (
                        <div key={row.id} style={{ fontSize: '0.75rem', color: '#2a7a2a' }}>
                          ✓ Applied: {row.supply_name} ×{row.quantity}
                        </div>
                      ))}
                      {drafts.map(row => draftRow(row, false))}
                      {(showBlankDraft || hasNewDraft) && draftRow(null, true)}
                      {!showBlankDraft && !hasNewDraft && (
                        <button
                          onClick={() => setNewDraft(d => ({ ...d, [photo.id]: { supply_name: '', quantity: '1' } }))}
                          style={{ width: '100%', padding: '0.3rem 0.5rem', fontSize: '0.78rem', border: '1px dashed #0066cc', background: '#fff', color: '#0066cc', borderRadius: 4, cursor: 'pointer' }}
                        >+ add another item</button>
                      )}
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
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%' }}>
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
