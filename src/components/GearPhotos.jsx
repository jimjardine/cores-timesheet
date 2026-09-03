import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  // Deep link from elsewhere (e.g. the Supplies report's "from photo" link)
  // — ?photo=<id> scrolls to and highlights that one card instead of making
  // her hunt for it in a list of 179.
  const [searchParams] = useSearchParams()
  const highlightPhotoId = searchParams.get('photo')
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
      supabase.schema('Cores').from('job_supplies').select('id, source_photo_id, supply_name, quantity, applied_at, applied_by, billed_at').not('source_photo_id', 'is', null),
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

  // Runs once the target card is actually in the DOM — a plain [] dep would
  // fire before `photos` has loaded, when the grid is still empty.
  useEffect(() => {
    if (!highlightPhotoId || loading) return
    document.getElementById(`gear-photo-${highlightPhotoId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightPhotoId, loading])

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
    if (filter === 'measurement' && p.photo_type !== 'measurement') return false
    if (filter === 'receipt' && p.photo_type !== 'receipt') return false
    if (filter === 'untagged' && p.photo_type != null) return false
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
  // Moving a photo OFF Supply doesn't touch the supply lines it already
  // produced on its own — the Supply Used editor is gated on photo_type ===
  // 'supply' (see the render below), so retagging just hides that whole
  // section while an already-applied line quietly keeps charging the job.
  // Confirmed in production, Jim Jardine, 2026-08-28: retagged a photo from
  // Supply to Reference and its applied line "still remained on the
  // timesheet" with no warning at all. Now: leaving Supply with lines already
  // attached to this photo warns first, then pulls the unbilled ones off the
  // timesheet (deleted) same as everywhere else this codebase treats an
  // unbilled job_supplies row as safe to remove outright — a billed line is
  // real invoicing history and is left alone, still linked to this photo.
  async function savePhotoType(photo, value) {
    const next = photo.photo_type === value ? null : value
    if (photo.photo_type === 'supply' && next !== 'supply') {
      const rows = suppliesByPhoto[photo.id] || []
      const billed = rows.filter(r => r.billed_at)
      const removable = rows.filter(r => !r.billed_at)
      if (removable.length > 0 || billed.length > 0) {
        const onTimesheet = removable.filter(r => r.applied_at)
        const draftOnly = removable.filter(r => !r.applied_at)
        const lines = removable.map(r => `"${r.supply_name}" (×${Number(r.quantity)})`).join(', ')
        let msg = ''
        if (onTimesheet.length > 0) {
          msg = `This photo has ${onTimesheet.length > 1 ? 'supply lines' : 'a supply line'} already on the timesheet: ${lines}.\n\nChanging this photo's type will pull ${onTimesheet.length > 1 ? 'them' : 'it'} off the timesheet.`
        } else if (draftOnly.length > 0) {
          msg = `This photo has ${draftOnly.length > 1 ? 'draft supply lines' : 'a draft supply line'} not yet on the timesheet: ${lines}.\n\nChanging this photo's type will discard ${draftOnly.length > 1 ? 'them' : 'it'}.`
        }
        if (billed.length > 0) {
          msg += `${msg ? '\n\n' : ''}${billed.length} already-billed line${billed.length > 1 ? 's' : ''} will be left as-is (real billing history).`
        }
        if (msg && !confirm(`${msg}\n\nContinue?`)) return
      }
      if (removable.length > 0) {
        const { error: supplyError } = await supabase.schema('Cores').from('job_supplies')
          .delete().in('id', removable.map(r => r.id))
        if (supplyError) { alert("Couldn't remove this photo's supply lines: " + supplyError.message); return }
        setSuppliesByPhoto(m => ({ ...m, [photo.id]: (m[photo.id] || []).filter(r => r.billed_at) }))
      }
    }
    setSavingId(photo.id)
    const { error } = await supabase.schema('Cores').from('gear_photos')
      .update({ photo_type: next })
      .eq('id', photo.id)
    if (error) alert('Error saving: ' + error.message)
    else setPhotos(p => p.map(x => x.id === photo.id ? { ...x, photo_type: next } : x))
    setSavingId(null)
  }

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

  // The not-yet-saved lines for a card. No auto-default here on purpose —
  // an earlier version pre-filled one line automatically whenever a photo
  // had zero saved rows, meant for a fresh photo she'd never touched. But
  // "zero rows" is also exactly what a photo looks like right after its one
  // real line gets deleted elsewhere (e.g. SMS Review) — the auto-default
  // would silently reappear, pre-filled with the same note text, looking
  // like the just-deleted entry never actually left. "+ Add line" already
  // prefills from the note (see the button below), so nothing is lost by
  // requiring that explicit click instead of guessing.
  const linesForPhoto = (photo) => newLines[photo.id] ?? []

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
    // own text report saying the same thing). Every line listed on the card
    // is going on the timesheet, so all of them are worth checking.
    const namesGoingOn = [
      ...pending.map(l => l.supply_name.trim()),
      ...rows.filter(row => (rowEdits[row.id]?.supply_name ?? row.supply_name).trim())
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
    setSavingPhotoId(photo.id)

    const inserts = pending.map(l => ({
      job_id: photo.job_id,
      employee_id: photo.employee_id,
      work_date: photo.work_date,
      supply_name: l.supply_name.trim(),
      quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
      source_photo_id: photo.id,
      ...stamp,
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
      const wasApplied = !!row.applied_at
      // Self-heals any row left over from before the checkbox was removed
      // (saved but never applied) — every row on the card is on the
      // timesheet now, so a save always stamps it if it isn't already.
      const unchanged = supply_name === row.supply_name && quantity === Number(row.quantity) && wasApplied
      if (unchanged) continue
      const { error } = await supabase.schema('Cores').from('job_supplies')
        .update({ supply_name, quantity, ...(wasApplied ? {} : stamp) })
        .eq('id', row.id)
      if (error) { alert('Error saving: ' + error.message); setSavingPhotoId(null); return }
    }

    // Re-read rather than patching local state by hand — several rows can
    // change per save, and this keeps the card honest about what's stored.
    const { data: fresh } = await supabase.schema('Cores').from('job_supplies')
      .select('id, source_photo_id, supply_name, quantity, applied_at, applied_by, billed_at')
      .eq('source_photo_id', photo.id)
    setSuppliesByPhoto(m => ({ ...m, [photo.id]: fresh || [] }))
    setNewLines(d => { const n = { ...d }; delete n[photo.id]; return n })
    setRowEdits(d => {
      const n = { ...d }
      for (const r of rows) delete n[r.id]
      return n
    })
    setSavingPhotoId(null)
  }

  // Removes an already-saved supply line outright — the only way to take
  // something off the timesheet now that there's no on/off checkbox (every
  // row listed on the card is, by definition, on the timesheet). A billed
  // line is real invoicing history and isn't offered this button at all,
  // same protection savePhotoType already gives billed lines above.
  async function deleteSupplyRow(row) {
    if (!confirm(`Remove "${row.supply_name}" (qty ${Number(row.quantity)}) from this job's supplies?`)) return
    const { error } = await supabase.schema('Cores').from('job_supplies').delete().eq('id', row.id)
    if (error) { alert('Error removing: ' + error.message); return }
    setSuppliesByPhoto(m => ({ ...m, [row.source_photo_id]: (m[row.source_photo_id] || []).filter(r => r.id !== row.id) }))
    setRowEdits(d => { const n = { ...d }; delete n[row.id]; return n })
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
    // job_supplies.source_photo_id is ON DELETE SET NULL, not CASCADE — deleting
    // just the photo silently detaches (not removes) any supply line it produced,
    // including ones already applied to the timesheet, leaving an orphaned charge
    // with no photo and no timesheet entry behind it (confirmed in production,
    // Jim Jardine, 2026-08-28). Clean those up too, same as everywhere else this
    // codebase touches job_supplies: unbilled ones are safe to delete outright;
    // a billed one is real billing history, so it's left alone (still linked to
    // this photo id — harmless once the photo record is gone).
    const { data: linkedSupplies, error: lookupError } = await supabase.schema('Cores').from('job_supplies')
      .select('id, billed_at').eq('source_photo_id', photo.id)
    if (lookupError) { alert('Error checking linked supplies: ' + lookupError.message); setSavingId(null); return }
    const unbilledIds = (linkedSupplies || []).filter(s => !s.billed_at).map(s => s.id)
    if (unbilledIds.length > 0) {
      const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').delete().in('id', unbilledIds)
      if (supplyError) { alert('Error removing linked supply lines: ' + supplyError.message); setSavingId(null); return }
    }
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
            employees={employees.filter(e => e.active || e.id === employeeFilter).sort((a, b) => a.name.localeCompare(b.name))}
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
            padding: '0.3rem 0.6rem', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem',
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
          {filterBtn('measurement', `📏 Measurement (${photos.filter(p => p.photo_type === 'measurement').length})`)}
          {filterBtn('receipt', `🧾 Receipt (${photos.filter(p => p.photo_type === 'receipt').length})`)}
          {filterBtn('untagged', `Untagged (${photos.filter(p => p.photo_type == null).length})`)}
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
          const isHighlighted = photo.id === highlightPhotoId
          return (
            <div key={photo.id} id={`gear-photo-${photo.id}`}
              style={{
                border: isHighlighted ? '2px solid #0066cc' : '1px solid #ddd', borderRadius: 8, overflow: 'hidden', background: '#fff',
                boxShadow: isHighlighted ? '0 0 0 3px rgba(0,102,204,0.2)' : 'none',
              }}>
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
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.4rem' }}>
                  {[['supply', '🔧 Supply'], ['reference', '📋 Reference'], ['measurement', '📏 Measurement'], ['receipt', '🧾 Receipt']].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => savePhotoType(photo, key)}
                      disabled={savingId === photo.id}
                      style={{
                        flex: 1, padding: '0.22rem 0.3rem', fontSize: '0.68rem', borderRadius: 4, cursor: 'pointer',
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
                        // Billed lines are real invoicing history — no ✕ here,
                        // same protection savePhotoType gives them above.
                        if (row.billed_at) {
                          return (
                            <div key={row.id}
                              title="Already billed — left as-is"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.4rem', color: '#999', background: '#f5f5f5', borderRadius: 4, fontSize: '0.8rem' }}
                            >
                              <span>{row.quantity} × {row.supply_name} (billed)</span>
                            </div>
                          )
                        }
                        const v = rowEdits[row.id] ?? { supply_name: row.supply_name, quantity: String(row.quantity) }
                        const set = (patch) => setRowEdits(d => ({ ...d, [row.id]: { ...v, ...patch } }))
                        return (
                          <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <input type="number" min="0" step="1" value={v.quantity} disabled={busy}
                              onChange={e => set({ quantity: e.target.value })} style={qtyStyle} />
                            <input value={v.supply_name} placeholder="Description" disabled={busy}
                              onChange={e => set({ supply_name: e.target.value })} style={descStyle} />
                            <button type="button" onClick={() => deleteSupplyRow(row)}
                              disabled={busy} title="Remove from this job's supplies"
                              style={{ flexShrink: 0, padding: '0.2rem 0.5rem', border: '1px solid #fcc', background: '#fee', color: '#c0392b', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                            >✕</button>
                          </div>
                        )
                      })}
                      {lines.map((l, i) => (
                        <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <input type="number" min="0" step="1" value={l.quantity} disabled={busy}
                            onChange={e => setLines(lines.map((x, xi) => xi === i ? { ...x, quantity: e.target.value } : x))}
                            style={qtyStyle} />
                          <input value={l.supply_name} placeholder="Description" disabled={busy}
                            onChange={e => setLines(lines.map((x, xi) => xi === i ? { ...x, supply_name: e.target.value } : x))}
                            style={descStyle} />
                          {/* Drops a line that isn't saved to the timesheet yet — before
                              this, the only way to get rid of an unwanted line (e.g. the
                              auto-filled draft from a caption that isn't a real supply)
                              was untagging the whole photo, wiping every other line on it
                              too. Reported by Jim, 2026-08-28. */}
                          <button type="button" onClick={() => setLines(lines.filter((_, xi) => xi !== i))}
                            disabled={busy} title="Remove this line"
                            style={{ flexShrink: 0, padding: '0.2rem 0.5rem', border: '1px solid #fcc', background: '#fee', color: '#c0392b', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                          >✕</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          onClick={() => setLines([...lines, { key: `l${Date.now()}`, supply_name: photo.note || '', quantity: '1' }])}
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
