import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { ensureStatPay } from '../utils/statPay'
import { fmtHours } from '../utils/format'
import { looksLikeSameSupply } from '../utils/supplyMatch'
import MultiSelectDropdown from './MultiSelectDropdown'
import PersonPicker from './PersonPicker'
import { getAdminName } from './PasswordGate'
import MediaThumb from './MediaThumb'
import MediaViewer from './MediaViewer'

// Rounds a minute delta to the nearest quarter hour, as hours (e.g. -150 -> -2.5)
const deltaMinsToHours = (mins) => Math.round(mins / 15) / 4

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-timesheet`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const gearPhotoUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl

const STATUS_COLORS = {
  draft:      '#aaa',
  collecting: '#888',
  submitted:  '#cc7700',
  approved:   '#2a7a2a',
  rejected:   '#cc2222',
}

export default function SmsReview({ onApproved } = {}) {
  const [submissions, setSubmissions] = useState([])
  const [jobs, setJobs]               = useState([])
  const [employees, setEmployees]     = useState([])
  const [gearPhotos, setGearPhotos]   = useState([])
  const [filter, setFilter]           = useState('submitted')
  const [filterEmployeeIds, setFilterEmployeeIds] = useState([])
  const [sortBy, setSortBy]           = useState('recent')
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState({})
  const [acting, setActing]           = useState(null)
  const [noteDrafts, setNoteDrafts]   = useState({})
  // Reject ("Delete") now requires a reason so the tech isn't just left with a
  // bare "declined" chip — open/draft state per submission, same shape as the
  // admin-note compose box below.
  const [rejectOpen, setRejectOpen]     = useState({})
  const [rejectDrafts, setRejectDrafts] = useState({})
  const [photoModal, setPhotoModal]           = useState(null) // { title, photos }
  const [photoLightbox, setPhotoLightbox]     = useState(null)
  // employee_id|work_date pairs that already have an approved timesheet_entries
  // row — cross-referenced against pending submissions so a duplicate (e.g. a
  // stray mobile-app entry for a day already texted in and approved) gets
  // flagged before an admin approves it a second time, instead of only being
  // caught after the fact.
  const [approvedDaySet, setApprovedDaySet]   = useState(new Set())
  // Supplies already saved for an employee/day — most commonly logged from a
  // Gear Photos card while this submission is still pending, per source_photo_id.
  // job_supplies has no FK to sms_submissions for that path, so this is a
  // separate employee+date lookup, same shape as approvedDaySet above. Without
  // this, a supply she'd already saved was invisible here until the submission
  // got approved and a real timesheet_entries row existed for it to attach to.
  const [appliedSupplies, setAppliedSupplies] = useState([])

  // Text-the-employee ("admin note") affordance — per-submission toggle,
  // draft text, and send status (undefined | 'sending' | 'sent' | error string)
  const [adminNoteOpen, setAdminNoteOpen]     = useState({})
  const [adminNoteDrafts, setAdminNoteDrafts] = useState({})
  const [adminNoteStatus, setAdminNoteStatus] = useState({})

  // Test harness
  const [testOpen, setTestOpen]   = useState(false)
  const [testPhone, setTestPhone] = useState('5068667302')
  const [testMsg, setTestMsg]     = useState('')
  const [testReply, setTestReply] = useState(null)
  const [testLoading, setTestLoading] = useState(false)

  // Edit modal
  const [editModal, setEditModal]   = useState(null)
  const [editFields, setEditFields] = useState({})

  // silent=true skips the "Loading…" banner — used by the background poll so a
  // refresh that finds nothing new doesn't flash text at the top of the list
  // every cycle.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const [{ data: subs }, { data: j }, { data: emps }, { data: photos }, { data: approvedDays }, { data: applied }] = await Promise.all([
      supabase.schema('Cores').from('sms_submissions').select('*').order('updated_at', { ascending: false }),
      supabase.schema('Cores').from('jobs').select('id, job_number, description').eq('status', 'open'),
      supabase.schema('Cores').from('employees').select('id, name, active'),
      supabase.schema('Cores').from('gear_photos').select('id, job_id, storage_path, employee_id, work_date, created_at').not('job_id', 'is', null),
      supabase.schema('Cores').from('timesheet_entries').select('employee_id, work_date').gte('work_date', ninetyDaysAgo.toISOString().slice(0, 10)),
      supabase.schema('Cores').from('job_supplies').select('employee_id, work_date, supply_name, quantity, jobs(job_number)').not('applied_at', 'is', null).is('sms_submission_id', null).gte('work_date', ninetyDaysAgo.toISOString().slice(0, 10)),
    ])
    setSubmissions(subs || [])
    setJobs(j || [])
    setEmployees(emps || [])
    setGearPhotos(photos || [])
    setApprovedDaySet(new Set((approvedDays || []).map(e => `${e.employee_id}|${e.work_date}`)))
    setAppliedSupplies(applied || [])
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh so one admin's action (approve, reject, edit) shows up on
  // another admin's already-open SMS Review without a manual reload — this is
  // exactly the screen Tracy and Niki were both looking at when Niki's per-diem
  // change didn't show up on Tracy's side. Paused while the edit modal is open
  // or an approve/reject/send is in flight, so a background reload can't race it.
  const editingRef = useRef(false)
  useEffect(() => {
    editingRef.current = !!editModal || !!acting
  })
  useEffect(() => {
    const id = setInterval(() => {
      if (!editingRef.current) load({ silent: true })
    }, 10000)
    return () => clearInterval(id)
  }, [load])

  // "Pending" also surfaces still-open conversations (status='collecting') — otherwise a
  // tech who never answers a follow-up question (lunch/PD/supplies) vanishes from view
  // entirely, since it never reaches 'submitted' on its own.
  const visible = submissions.filter(s => {
    if (filterEmployeeIds.length > 0 && !filterEmployeeIds.includes(s.employee_id)) return false
    if (filter === 'all') return true
    if (filter === 'submitted') return s.status === 'submitted' || s.status === 'collecting'
    return s.status === filter
  })

  const employeeName = (id) => employees.find(e => e.id === id)?.name || 'Unknown'
  const getEmployee = (id) => employees.find(e => e.id === id) || { name: 'Unknown', active: null }

  const sortedVisible = [...visible].sort((a, b) => {
    if (sortBy === 'employee') return employeeName(a.employee_id).localeCompare(employeeName(b.employee_id))
    if (sortBy === 'workdate') return (b.work_date || '').localeCompare(a.work_date || '')
    if (sortBy === 'oldest')   return (a.updated_at || '').localeCompare(b.updated_at || '')
    return (b.updated_at || '').localeCompare(a.updated_at || '') // 'recent' (default, matches original fetch order)
  })

  // Scoped to one job on one day for one employee — not every photo ever taken
  // for that job number, which mixes everyone's photos across every date and is
  // meaningless for a recurring job like SHOP that's logged constantly.
  const entryPhotos = (jobId, employeeId, workDate) =>
    gearPhotos.filter(p => p.job_id === jobId && p.employee_id === employeeId && p.work_date === workDate)

  // Supplies already saved (e.g. from Gear Photos) for this submission's
  // employee/day, independent of whatever's parsed into sub.supplies.
  const appliedSuppliesFor = (employeeId, workDate) =>
    appliedSupplies.filter(s => s.employee_id === employeeId && s.work_date === workDate)

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
    const entries = sub.entries || []
    if (entries.some(e => !e.description?.trim())) {
      alert('Every job needs a note describing what was done — click Edit to add one before approving.')
      return
    }
    // Matches the validation saveEdit() enforces — approving straight from the
    // list (without opening Edit) used to skip this, letting a 0/blank-hours
    // entry (e.g. a job mentioned with no stated duration) through silently.
    if (entries.some(e => !(Number(e.hours) > 0))) {
      alert('Every entry needs hours greater than 0 — click Edit to fix it before approving.')
      return
    }
    // Hours can go stale against time_in/stated_time_out when either gets edited
    // without the other (see Aug 6 2026 incident — time was corrected but the
    // job hours weren't, and it slipped through to approval unnoticed).
    if (sub.delta_minutes != null && Math.abs(sub.delta_minutes) > 15) {
      const deltaHrs = deltaMinsToHours(sub.delta_minutes)
      const ok = confirm(`Heads up — this submission's job hours don't match its time span (off by ${Math.abs(deltaHrs)}hrs). Approve anyway?`)
      if (!ok) return
    }

    // Guard against a text-reported supply duplicating one already logged
    // elsewhere for the same employee/day/job — typically a gear photo whose
    // note said the same thing this text did.
    const suppliesToApprove = (sub.supplies || []).filter(s => s.supply_name?.trim())
    if (suppliesToApprove.length > 0) {
      const jobIdFor = (jobNumber) => jobs.find(j => j.job_number.toUpperCase() === (jobNumber || '').toUpperCase())?.id
      const jobIds = [...new Set(suppliesToApprove.map(s => jobIdFor(s.job_number)).filter(Boolean))]
      if (jobIds.length > 0) {
        const { data: existing } = await supabase.schema('Cores').from('job_supplies')
          .select('supply_name, job_id, source_photo_id')
          .eq('employee_id', sub.employee_id).eq('work_date', sub.work_date).in('job_id', jobIds)
          .not('applied_at', 'is', null)
        const dupes = []
        for (const s of suppliesToApprove) {
          const jobId = jobIdFor(s.job_number)
          const hit = (existing || []).find(r => r.job_id === jobId && looksLikeSameSupply(s.supply_name, r.supply_name))
          if (hit) dupes.push({ name: s.supply_name, existing: hit.supply_name, source: hit.source_photo_id ? 'a gear photo' : 'another entry' })
        }
        // Just tell her exactly what's already there and let her decide —
        // she knows whether this is the same item or a second one.
        if (dupes.length === 1) {
          const d = dupes[0]
          if (!confirm(`There's already a "${d.existing}" logged for this job today (from ${d.source}). Do you want to add "${d.name}" as well?`)) return
        } else if (dupes.length > 1) {
          const list = dupes.map(d => `"${d.existing}" (from ${d.source}) — this submission also has "${d.name}"`).join('\n')
          if (!confirm(`Some of these look like they're already logged for this job today:\n\n${list}\n\nApprove anyway?`)) return
        }
      }
    }

    setActing(sub.id)

    // Atomically claim the submission before creating any entries — if this
    // matches zero rows, someone else (another tab/admin) already approved or
    // rejected it in the meantime, so we must not insert a second copy of the
    // entries. Previously the status flip happened last, after inserting, so
    // two concurrent approves could both pass through and duplicate the day's
    // hours (see FINDINGS_2026-08-08.md).
    const { data: claimed, error: claimError } = await supabase.schema('Cores').from('sms_submissions')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', sub.id).in('status', ['submitted', 'collecting'])
      .select('id')
    if (claimError) { alert('Approve failed: ' + claimError.message); setActing(null); return }
    if (!claimed || claimed.length === 0) {
      alert('This submission was already approved or deleted (probably in another tab) — refreshing.')
      await load(); setActing(null); return
    }

    const hasPD = sub.per_diem_location && sub.per_diem_location !== 'none'

    // Map job numbers to IDs — case-insensitive so "shop"/"Shop"/"SHOP" all match
    const jobMap = {}
    jobs.forEach(j => { jobMap[j.job_number.toUpperCase()] = j.id })

    const rows = entries.map((e, i) => ({
      employee_id: sub.employee_id,
      job_id:      jobMap[(e.job_number || '').toUpperCase()] || null,
      work_date:   sub.work_date,
      hours:       Number(e.hours),
      // Real link back to the submission this came from — previously the only
      // connection between the two tables was matching employee_id+work_date,
      // nothing the database could enforce.
      source_submission_id: sub.id,
      // ot_hours left null — the edge function's reg/ot split here is only a
      // same-day estimate for the review-screen preview; computeOTMap derives
      // the real split (incl. weekly threshold) at display/export time.
      // Exception: an entry she's explicitly overridden in the Edit modal
      // (ot_override, set by saveEdit()) writes the real split instead —
      // the same "one legitimate manual override" precedent as AdminDashboard's
      // own Edit modal for an already-approved entry.
      ot_hours:    e.ot_override ? Number(e.ot_hours) : null,
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
      approved_by_name:     getAdminName(),
      approved_at:          new Date().toISOString(),
    }))

    if (rows.length > 0) {
      const { error } = await supabase.schema('Cores').from('timesheet_entries').insert(rows)
      if (error) {
        // We already claimed this submission as approved — put it back so it's
        // not stuck "approved" with no entries and can be retried.
        await supabase.schema('Cores').from('sms_submissions').update({ status: sub.status, updated_at: new Date().toISOString() }).eq('id', sub.id)
        alert('Error creating entries — submission was reverted, try again: ' + error.message)
        setActing(null); return
      }
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
        // Approving the submission is already the deliberate review step —
        // unlike the gear-photo path, there's no separate draft/Apply here.
        applied_at:        new Date().toISOString(),
        applied_by:        getAdminName(),
      }))
      const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').insert(supplyRows)
      if (supplyError) {
        alert(`Timesheet entries were created but supplies failed to save: ${supplyError.message}\nAdd the supplies manually.`)
      }
    }

    await ensureStatPay(sub.employee_id, sub.work_date)
    await load()
    onApproved?.()
    setActing(null)
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  async function reject(sub) {
    const reason = (rejectDrafts[sub.id] || '').trim()
    if (!reason) return
    setActing(sub.id)
    const { error } = await supabase.schema('Cores').from('sms_submissions')
      .update({ status: 'rejected', rejection_reason: reason, updated_at: new Date().toISOString() }).eq('id', sub.id)
    if (error) alert(`Delete failed: ${error.message}`)
    setRejectOpen(o => ({ ...o, [sub.id]: false }))
    await load()
    setActing(null)
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  async function saveNote(sub) {
    const value = (noteDrafts[sub.id] ?? '').trim()
    setActing(sub.id)
    const { error } = await supabase.schema('Cores').from('sms_submissions')
      .update({ admin_note: value || null }).eq('id', sub.id)
    if (error) alert('Error saving note: ' + error.message)
    else {
      setSubmissions(p => p.map(x => x.id === sub.id ? { ...x, admin_note: value || null } : x))
      setNoteDrafts(d => { const n = { ...d }; delete n[sub.id]; return n })
    }
    setActing(null)
  }

  // ── Text the employee a note ─────────────────────────────────────────────
  // Sends an SMS referencing this submission's work date, then reopens it as
  // 'collecting' so a reply merges back into the same submission (edge
  // function's send_admin_note action) instead of landing as a new message.
  async function sendAdminNote(sub) {
    const note = (adminNoteDrafts[sub.id] || '').trim()
    if (!note) return
    setAdminNoteStatus(s => ({ ...s, [sub.id]: 'sending' }))
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ action: 'send_admin_note', submission_id: sub.id, note }),
      })
      const data = await res.json()
      if (!data.ok) {
        setAdminNoteStatus(s => ({ ...s, [sub.id]: `Failed: ${data.error}` }))
        return
      }
      setAdminNoteDrafts(d => { const n = { ...d }; delete n[sub.id]; return n })
      setAdminNoteOpen(o => ({ ...o, [sub.id]: false }))
      setAdminNoteStatus(s => ({ ...s, [sub.id]: 'sent' }))
      await load()
    } catch (e) {
      setAdminNoteStatus(s => ({ ...s, [sub.id]: `Failed: ${e.message}` }))
    }
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
      // Reg/OT are typed directly here, pre-filled from whatever's currently
      // shown in the list (the same reg_hours/ot_hours preview) so she's
      // adjusting real numbers she already saw, not blanks. No more "leave
      // blank to auto-split" — see saveEdit().
      entries:           (sub.entries || []).map(e => ({
        job_number:  e.job_number || '',
        reg_hours:   String(e.reg_hours ?? e.hours ?? ''),
        ot_hours:    String(e.ot_hours ?? 0),
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
    setEditFields(p => ({ ...p, entries: [...p.entries, { job_number: '', reg_hours: '', ot_hours: '0', description: '' }] }))
  const removeEntryRow = (i) =>
    setEditFields(p => ({ ...p, entries: p.entries.filter((_, j) => j !== i) }))

  const setSupplyField = (i, field, value) =>
    setEditFields(p => ({ ...p, supplies: p.supplies.map((s, j) => j === i ? { ...s, [field]: value } : s) }))
  const addSupplyRow = () =>
    setEditFields(p => ({ ...p, supplies: [...p.supplies, { job_number: '', supply_name: '', quantity: '1' }] }))
  const removeSupplyRow = (i) =>
    setEditFields(p => ({ ...p, supplies: p.supplies.filter((_, j) => j !== i) }))

  async function saveEdit() {
    // Drop blank rows. Reg/OT are exactly what she typed — no auto-split
    // here at all. The auto-split assigns OT by entry ORDER (whichever
    // consumed the daily allowance first), which is wrong whenever the boys
    // report their day out of order (e.g. Finn texted "drove to Pictou"
    // before "worked all day" — the drive was really the OT, since it
    // happened after a full 8hr day, but auto-split would have charged OT
    // to whichever entry landed second). She's not filling in a gap in the
    // math, she's just stating the real numbers directly.
    const cleaned = editFields.entries
      .filter(e => e.job_number.trim() || e.description.trim() || e.reg_hours !== '' || e.ot_hours !== '')
      .map(e => ({
        job_number:  e.job_number.trim(),
        reg_hours:   Number(e.reg_hours) || 0,
        ot_hours:    Number(e.ot_hours) || 0,
        description: e.description.trim(),
      }))

    if (cleaned.some(e => !e.job_number)) { alert('Every entry needs a job number'); return }
    if (cleaned.some(e => !((e.reg_hours + e.ot_hours) > 0))) { alert('Every entry needs Reg + OT hours greater than 0'); return }
    if (cleaned.some(e => !e.description)) { alert('Every entry needs a note describing what was done'); return }
    if (cleaned.some(e => e.reg_hours < 0 || e.ot_hours < 0)) { alert("Reg and OT hours can't be negative"); return }

    // Two entries for the same job in one day is a legitimate, common case
    // (e.g. one task on it in the morning, a different task in the
    // afternoon) — so this warns rather than blocks. It exists because this
    // modal is the one write path to entries that doesn't go through the
    // edge function's mergeEntries() — which enforces "one entry per job per
    // day" on every save it makes — so nothing else here would catch an
    // *actually* accidental duplicate (real incident: Nicolae Ileshov,
    // 2026-08-19, two auto-filled entries for the same job from two
    // different writes landing on top of each other).
    const dupJobs = [...new Set(cleaned.map(e => e.job_number.toLowerCase())
      .filter((jn, i, arr) => arr.indexOf(jn) !== i))]
    if (dupJobs.length > 0) {
      const jobLabel = cleaned.find(e => e.job_number.toLowerCase() === dupJobs[0]).job_number
      const ok = confirm(`Job ${jobLabel} appears more than once. If that's two different tasks on the same job, that's fine — Save anyway. If it's the same work listed twice, Cancel and merge them into one entry first.`)
      if (!ok) return
    }

    const entries = cleaned.map(({ job_number, reg_hours, ot_hours, description }) => {
      const reg = Math.round(reg_hours * 100) / 100
      const ot  = Math.round(ot_hours * 100) / 100
      return { job_number, hours: Math.round((reg + ot) * 100) / 100, description, reg_hours: reg, ot_hours: ot, ot_override: true }
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

    // Niki has fixed it up by hand — a collecting submission is now reviewable
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

    // Warn here, not just at approval — this is the moment a time-field edit can
    // silently go stale against the hours (edited one, forgot the other).
    if (updates.delta_minutes != null && Math.abs(updates.delta_minutes) > 15) {
      const deltaHrs = deltaMinsToHours(updates.delta_minutes)
      const ok = confirm(`Heads up — job hours (${fmtHours(totalHours)}hrs) don't match Time In/Out minus lunch (off by ${Math.abs(deltaHrs)}hrs). Save anyway?`)
      if (!ok) return
    }

    // Optimistic-concurrency guard, same reasoning as the edge function's own
    // save loop (added 2026-08-07 after a race dropped a concurrent text) —
    // this modal is the OTHER writer of the same entries column, and had no
    // equivalent protection: an admin editing a submission while a new text
    // comes in for it would otherwise silently clobber the SMS bot's write
    // (or vice versa) with no error either way.
    const { data: saved, error } = await supabase.schema('Cores').from('sms_submissions')
      .update(updates).eq('id', editModal.id).eq('updated_at', editModal.updated_at).select('id')
    if (error) { alert('Error saving: ' + error.message); return }
    if (!saved || saved.length === 0) {
      alert('This submission changed since you opened it (probably a new text came in) — reloading so you can check it before saving again.')
      await load()
      return
    }
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
              placeholder={'Fill in a test message here (format: In 7:30, 4760 6hrs description, lunch 30, no PD)'}
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
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {['submitted', 'approved', 'rejected', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '0.3rem 0.8rem', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: filter === f ? 700 : 400,
              background: filter === f ? '#0066cc' : '#eee', color: filter === f ? '#fff' : '#333',
            }}>
              {f === 'submitted' ? 'Pending' : f === 'rejected' ? 'Deleted' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <MultiSelectDropdown
            options={employees.filter(e => submissions.some(s => s.employee_id === e.id))}
            selectedIds={filterEmployeeIds}
            onChange={setFilterEmployeeIds}
            placeholder="All employees" allLabel="All employees" minWidth={160} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ padding: '0.3rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.85rem', marginLeft: '0.4rem' }}>
            <option value="recent">Sort: Most recent</option>
            <option value="oldest">Sort: Oldest first</option>
            <option value="workdate">Sort: Work date</option>
            <option value="employee">Sort: Employee A–Z</option>
          </select>
          <button onClick={load} style={{ padding: '0.3rem 0.8rem', border: '1px solid #ccc', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: '0.85rem' }}>↺</button>
        </div>
      </div>

      {loading && <div style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>Loading…</div>}

      {!loading && visible.length === 0 && (
        <div style={{ color: '#888', textAlign: 'center', padding: '3rem', border: '2px dashed #ddd', borderRadius: 8 }}>
          No {filter === 'submitted' ? 'pending' : filter === 'rejected' ? 'deleted' : filter} submissions
        </div>
      )}

      {sortedVisible.map(sub => {
        const flags = []
        if (!sub.employee_id)                          flags.push('employee unknown')
        if (!sub.time_in)                              flags.push('start time missing')
        if (!sub.entries || sub.entries.length === 0)  flags.push('no job entries')
        if (sub.lunch_minutes == null)                 flags.push('lunch unknown')
        // No 'per diem unknown' flag — the bot never asks about PD (silent
        // default to 'none' at save time), so a null here just means none,
        // not something the office needs to chase down.
        if (sub.status !== 'approved' && sub.status !== 'rejected' && approvedDaySet.has(`${sub.employee_id}|${sub.work_date}`)) {
          flags.push('⚠️ already has an approved timesheet for this day — check for a duplicate before approving')
        }
        if ((!sub.supplies || sub.supplies.length === 0) && sub.supplies_note === 'photo') flags.push('📷 supplies in gear photo — itemize from Gear Photos tab')
        if (sub.delta_minutes && Math.abs(sub.delta_minutes) > 15) {
          const deltaHrs = deltaMinsToHours(sub.delta_minutes)
          flags.push(`time delta ${deltaHrs > 0 ? '+' : ''}${fmtHours(deltaHrs)}hrs`)
        }
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
                  {sub.status === 'rejected' ? 'deleted' : sub.status}
                </span>
                {flags.map(f => (
                  <span key={f} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: '#ffe0e0', color: '#c00', border: '1px solid #ffaaaa' }}>
                    ⚠ {f}
                  </span>
                ))}
                {sub.admin_note && (
                  <span title={sub.admin_note} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: '#eef2ff', color: '#3949ab', border: '1px solid #c5cae9' }}>
                    📝 note
                  </span>
                )}
                {appliedSuppliesFor(sub.employee_id, sub.work_date).length > 0 && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: '#e6f4ea', color: '#2a7a2a', border: '1px solid #2a7a2a44' }}>
                    🔧 {appliedSuppliesFor(sub.employee_id, sub.work_date).length} supply logged
                  </span>
                )}
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
                      <strong>Δ:</strong> {(() => { const h = deltaMinsToHours(sub.delta_minutes); return `${h > 0 ? '+' : ''}${fmtHours(h)}hrs` })()}
                    </span>
                  )}
                  <span><strong>Per diem:</strong> {sub.per_diem_location && sub.per_diem_location !== 'none' ? sub.per_diem_location : 'No'}</span>
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
                        <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', width: 70, color: '#888' }}>Photos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sub.entries.map((e, i) => {
                        const matchedJob = jobs.find(j => j.job_number.toUpperCase() === (e.job_number || '').toUpperCase())
                        const reg = e.reg_hours ?? e.hours
                        const ot  = e.ot_hours ?? 0
                        const thisEntryPhotos = matchedJob ? entryPhotos(matchedJob.id, sub.employee_id, sub.work_date) : []
                        const photoCount = thisEntryPhotos.length
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
                            <td style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}>
                              {photoCount > 0 ? (
                                <span
                                  onClick={() => setPhotoModal({ title: `${matchedJob.job_number} — ${employeeName(sub.employee_id)} — ${sub.work_date}`, photos: thisEntryPhotos })}
                                  style={{ color: '#0066cc', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                >📷 {photoCount}</span>
                              ) : '—'}
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
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                ) : (
                  <div style={{ color: '#c00', marginBottom: '0.75rem', fontSize: '0.875rem' }}>No job entries</div>
                )}

                {/* Supplies answered without an itemized list ('photo'/'none') */}
                {(!sub.supplies || sub.supplies.length === 0) && sub.supplies_note && (
                  <div style={{ color: '#555', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                    {sub.supplies_note === 'photo' ? '📷 Supplies in gear photo — not itemized by text' : 'No supplies used'}
                  </div>
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

                {/* Supplies already saved from a Gear Photos card — shown regardless of
                    this submission's status, since they're real job_supplies rows that
                    exist independent of approval. Read-only here; edit them back on the
                    photo they came from. */}
                {appliedSuppliesFor(sub.employee_id, sub.work_date).length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#2a7a2a', fontWeight: 600, marginBottom: '0.3rem' }}>
                      ✓ Already saved to the timesheet (from Gear Photos)
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <tbody>
                        {appliedSuppliesFor(sub.employee_id, sub.work_date).map((s, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                            <td style={{ padding: '0.35rem 0.6rem', fontWeight: 600 }}>{s.supply_name}</td>
                            <td style={{ padding: '0.35rem 0.6rem', textAlign: 'right', width: 55 }}>×{s.quantity}</td>
                            <td style={{ padding: '0.35rem 0.6rem', width: 70, color: '#888' }}>{s.jobs?.job_number || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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

                {/* Notes */}
                {(() => {
                  const draft = noteDrafts[sub.id] ?? (sub.admin_note || '')
                  const dirty = draft !== (sub.admin_note || '')
                  return (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.8rem', color: '#888', display: 'block', marginBottom: '0.25rem' }}>Notes</label>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                        <textarea
                          value={draft}
                          onChange={e => setNoteDrafts(d => ({ ...d, [sub.id]: e.target.value }))}
                          placeholder="Add a note for the record..."
                          rows={2}
                          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                        />
                        {dirty && (
                          <button
                            onClick={() => saveNote(sub)}
                            disabled={acting === sub.id}
                            style={{ padding: '0.4rem 0.8rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                          >Save</button>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Actions */}
                {(sub.status === 'submitted' || sub.status === 'collecting') && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
                      onClick={() => setRejectOpen(o => ({ ...o, [sub.id]: !o[sub.id] }))}
                      disabled={!!acting}
                      style={{ padding: '0.4rem 1rem', background: '#fff', color: '#c00', border: '1px solid #c00', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setAdminNoteOpen(o => ({ ...o, [sub.id]: !o[sub.id] }))}
                      disabled={!sub.employee_id}
                      title={!sub.employee_id ? 'No employee identified for this submission' : undefined}
                      style={{ padding: '0.4rem 0.8rem', background: 'transparent', border: '1px solid #ccc', borderRadius: 4, cursor: sub.employee_id ? 'pointer' : 'default', fontSize: '0.85rem', color: sub.employee_id ? '#555' : '#bbb' }}
                    >
                      ✉️ Send Note to: {sub.employee_id ? employeeName(sub.employee_id) : '—'}
                    </button>
                  </div>
                )}

                {/* Reason for declining — required before Delete actually rejects it,
                    so the tech sees more than a bare "declined" chip */}
                {rejectOpen[sub.id] && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                    <textarea
                      value={rejectDrafts[sub.id] || ''}
                      onChange={e => setRejectDrafts(d => ({ ...d, [sub.id]: e.target.value }))}
                      placeholder="Reason for declining — the tech will see this"
                      rows={2}
                      autoFocus
                      style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #c00', borderRadius: 4, fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={() => reject(sub)}
                      disabled={!(rejectDrafts[sub.id] || '').trim() || acting === sub.id}
                      style={{
                        padding: '0.4rem 0.8rem',
                        background: (rejectDrafts[sub.id] || '').trim() ? '#c00' : '#ccc',
                        color: '#fff', border: 'none', borderRadius: 4,
                        cursor: (rejectDrafts[sub.id] || '').trim() ? 'pointer' : 'default',
                        fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap',
                      }}
                    >
                      {acting === sub.id ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                  </div>
                )}

                {/* Text the employee a note — expanded compose box, kept below the action row */}
                {(sub.status === 'submitted' || sub.status === 'collecting') && (
                  <div style={{ marginTop: '0.5rem' }}>
                    {adminNoteOpen[sub.id] && (
                      <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                        <textarea
                          value={adminNoteDrafts[sub.id] || ''}
                          onChange={e => setAdminNoteDrafts(d => ({ ...d, [sub.id]: e.target.value }))}
                          placeholder={`Text ${employeeName(sub.employee_id)} about this submission...`}
                          rows={2}
                          style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                        />
                        <button
                          onClick={() => sendAdminNote(sub)}
                          disabled={!(adminNoteDrafts[sub.id] || '').trim() || adminNoteStatus[sub.id] === 'sending'}
                          style={{
                            padding: '0.4rem 0.8rem',
                            background: (adminNoteDrafts[sub.id] || '').trim() ? '#0066cc' : '#ccc',
                            color: '#fff', border: 'none', borderRadius: 4,
                            cursor: (adminNoteDrafts[sub.id] || '').trim() ? 'pointer' : 'default',
                            fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap',
                          }}
                        >
                          {adminNoteStatus[sub.id] === 'sending' ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    )}
                    {adminNoteStatus[sub.id] && adminNoteStatus[sub.id] !== 'sending' && (
                      <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', color: adminNoteStatus[sub.id] === 'sent' ? '#2a7a2a' : '#c00' }}>
                        {adminNoteStatus[sub.id] === 'sent' ? '✓ Note texted' : adminNoteStatus[sub.id]}
                      </div>
                    )}
                  </div>
                )}

                {sub.status === 'approved' && (
                  <div style={{ color: '#2a7a2a', fontSize: '0.85rem', fontWeight: 600 }}>✓ Approved — entries written to timesheet</div>
                )}
                {sub.status === 'rejected' && (
                  <div style={{ color: '#c00', fontSize: '0.85rem' }}>
                    <div style={{ fontWeight: 600 }}>✗ Deleted</div>
                    {sub.rejection_reason && <div style={{ marginTop: '0.15rem', color: '#888' }}>Reason: {sub.rejection_reason}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Photo modal */}
      {photoModal && (() => {
        const jobPhotos = [...photoModal.photos].sort((a, b) => b.created_at.localeCompare(a.created_at))
        return (
          <div
            onClick={() => setPhotoModal(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: '1.25rem', width: '100%', maxWidth: 700, maxHeight: '80vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>{photoModal.title} — {jobPhotos.length} photo{jobPhotos.length === 1 ? '' : 's'}</h3>
                <button onClick={() => setPhotoModal(null)} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#888' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                {jobPhotos.map(p => (
                  <div key={p.id} style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #eee' }}>
                    <div
                      onClick={() => setPhotoLightbox(p)}
                      style={{ aspectRatio: '4 / 3', background: '#f0f0f0', cursor: 'pointer', overflow: 'hidden' }}
                    >
                      <MediaThumb src={gearPhotoUrl(p.storage_path)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: '#888' }}>
                      {employeeName(p.employee_id)} · {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {photoLightbox && (
        <div
          onClick={() => setPhotoLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', cursor: 'zoom-out' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%' }}>
            <MediaViewer src={gearPhotoUrl(photoLightbox.storage_path)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: '1.5rem', width: 640, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Edit Submission</h3>

            <label style={lbl}>Employee</label>
            <PersonPicker employees={employees} value={editFields.employee_id || ''} clearLabel="— Unknown —"
              onChange={id => setEditFields(p => ({ ...p, employee_id: id }))} inputStyle={inp} />

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
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 65 }}>Reg</th>
                  <th style={{ fontWeight: 600, paddingBottom: 2, width: 65 }}>OT</th>
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
                          placeholder="Fill in job number"
                          style={{ ...inp, borderColor: e.job_number.trim() && !matched ? '#e08080' : '#ccc' }}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          type="number" min="0" step="0.25"
                          value={e.reg_hours}
                          onChange={ev => setEntryField(i, 'reg_hours', ev.target.value)}
                          style={inp}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <input
                          type="number" min="0" step="0.25"
                          value={e.ot_hours}
                          onChange={ev => setEntryField(i, 'ot_hours', ev.target.value)}
                          style={inp}
                        />
                      </td>
                      <td style={{ padding: '0.15rem 0.25rem 0.15rem 0' }}>
                        <textarea
                          rows={2}
                          value={e.description}
                          onChange={ev => setEntryField(i, 'description', ev.target.value)}
                          placeholder="Fill in description"
                          style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }}
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
              Reg and OT are exactly what's typed above — out-time is still recalculated automatically on save.
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
                          placeholder="Fill in supply name"
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
