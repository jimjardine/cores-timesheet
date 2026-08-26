import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import SmsReview from './SmsReview'
import PersonPicker from './PersonPicker'
import GearPhotos from './GearPhotos'
import ConfettiBurst from './ConfettiBurst'
import { getAdminName } from './PasswordGate'
import { generateDailyTimesheetPDF } from '../utils/timesheetPdf'
import { ensureStatPay, cleanupStatPay } from '../utils/statPay'
import { replaceSupplies, submitManualEntry, fetchDailyOTContext, computeDailyOTSplit } from '../utils/entrySave'
import MultiSelectDropdown from './MultiSelectDropdown'
import MediaThumb from './MediaThumb'
import MediaViewer from './MediaViewer'
import { computeOTMap } from '../utils/otCalc'
import { fmtHours } from '../utils/format'
import { generateWeeklyCompilationPDF, fmtShortDate, fmtHeaderDate, dayName, isWeekend } from '../utils/weeklyCompilationPdf'

const gearPhotoUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl
// Tracy gets a confetti celebration when her own timesheet is saved here —
// a just-for-her touch, not a general feature, so it's a plain ID check
// rather than a new employee flag.
const TRACY_EMPLOYEE_ID = 'e8dfecda-261d-42b8-a2ca-9b43bebacc8c'

const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer' }
const card = { padding: '1.25rem', background: '#fff', borderRadius: '6px', border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const chip = (color, bg) => ({ display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, color, background: bg })
// Short day+month form (distinct from the component-scoped fmtDate, which includes weekday+year)
const fmtPayDate = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
// Full date+time for signature timestamps on the printed timesheet PDF
const fmtSignedAt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const calculateExpectedHours = (timeIn, timeOut, lunchMinutes) => {
  if (!timeIn || !timeOut) return null
  const [inH, inM] = timeIn.split(':').map(Number)
  const [outH, outM] = timeOut.split(':').map(Number)
  const inMinutes = inH * 60 + inM
  const outMinutes = outH * 60 + outM
  const gross = (outMinutes - inMinutes) / 60
  const lunch = (lunchMinutes || 0) / 60
  return Math.max(0, gross - lunch)
}

export default function AdminDashboard() {
  // Real URL per sub-tab (mounted at /dashboard/*) instead of local state, so
  // back/forward steps through Timesheets/Payroll/SMS Review/etc instead of
  // leaving the app on the first back press. setActiveTab keeps its old name
  // and call signature so every existing setActiveTab('x') call site below
  // works unchanged.
  const navigate = useNavigate()
  const location = useLocation()
  const activeTab = location.pathname.replace(/^\/dashboard\/?/, '') || 'sms'
  const setActiveTab = (tab) => navigate(`/dashboard/${tab}`)

  // ── Timesheets tab ──
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [celebrate, setCelebrate] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [filterEmployeeIds, setFilterEmployeeIds] = useState([])
  const [printingAll, setPrintingAll] = useState(false)
  const [printAllProgress, setPrintAllProgress] = useState(null)
  const [printingAllPosted, setPrintingAllPosted] = useState(false)
  const [printAllPostedProgress, setPrintAllPostedProgress] = useState(null)
  const [datePreset, setDatePreset] = useState('this-week')
  const [dateFrom, setDateFrom] = useState(() => toYMD(getPayWeekStart(new Date())))
  const [dateTo, setDateTo] = useState(() => {
    const s = getPayWeekStart(new Date())
    const e = new Date(s); e.setDate(e.getDate() + 6)
    return toYMD(e)
  })
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [payrollConfig, setPayrollConfig] = useState({})
  const [statHolidays, setStatHolidays] = useState(new Set())
  const [jobs, setJobs] = useState([])
  const [supplies, setSupplies] = useState([])
  const [postedWeeks, setPostedWeeks] = useState({})
  const [gearPhotos, setGearPhotos] = useState([])
  const [photoGroup, setPhotoGroup] = useState(null)
  const [photoLightbox, setPhotoLightbox] = useState(null)
  // Timesheets/Job Reports only ever show APPROVED entries — a text sitting
  // in SMS Review still counts as "not logged yet" as far as those pages are
  // concerned, which reads as missing data unless flagged.
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0)
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  // ── Payroll / Weekly Summary tabs ──
  const payWeeks = recentPayWeeks(8)
  const [payWeekStart, setPayWeekStart] = useState(payWeeks[0])
  const [payEmployeeIds, setPayEmployeeIds] = useState([])
  const payEmployeeIdsDefaulted = useRef(false)
  const [payEmpDropdownOpen, setPayEmpDropdownOpen] = useState(false)
  const [viewingWeeklyCompilation, setViewingWeeklyCompilation] = useState(null)

  // ── Edit / delete ──
  const [editEntry, setEditEntry] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [editSupplies, setEditSupplies] = useState([])
  const [timesheetJobs, setTimesheetJobs] = useState([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [addingNewJob, setAddingNewJob] = useState(false)
  const [newJobFields, setNewJobFields] = useState({ job_id: '', hours: '', description: '' })
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [revertingId, setRevertingId] = useState(null)
  const [exportSummaries, setExportSummaries] = useState(true)

  // ── Manual entry ──
  const [manualEntry, setManualEntry] = useState(null)
  const [manualFields, setManualFields] = useState({
    employee_id: '', work_date: toYMD(new Date()),
    time_in: '07:00', stated_time_out: '15:30', lunch_minutes: 30,
    entries: [{ job_id: '', hours: '', description: '' }],
    supplies: [{ job_id: '', supply_name: '', quantity: 1 }],
    per_diem: 0, sort_order: 1
  })
  const [savingManual, setSavingManual] = useState(false)
  // Tracks the last { hours, lunch_minutes, stated_time_out } we auto-filled (see
  // defaultScheduleFor) so a later employee/date change can tell "still the
  // untouched default" apart from "admin actually typed something" — a field
  // counts as safe to overwrite only if it still matches the form's own pristine
  // default OR the last thing we auto-filled; a real edit is never touched.
  const [autoFilled, setAutoFilled] = useState({ hours: null, lunch_minutes: null, stated_time_out: null, description: null, job_id: null })
  const PRISTINE_MANUAL_DEFAULTS = { hours: '', lunch_minutes: 30, stated_time_out: '15:30', description: '', job_id: '' }

  // ── Submission Status tab ──
  // Separate from `entries` (approved timesheet_entries only) — this tab's
  // "Status" column has always meant "approved", which reads as "Missing" for
  // someone who texted in but is still waiting on an admin to approve it.
  // Fetched once here, same broad-then-filter-client-side pattern as entries.
  const [pendingSubs, setPendingSubs] = useState([])
  const [subEmployeeFilter, setSubEmployeeFilter] = useState('')
  const [subPreset, setSubPreset] = useState('this-week')
  const [subWeekStart, setSubWeekStart] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7))
    return d.toISOString().split('T')[0]
  })

  function applySubPreset(preset) {
    setSubPreset(preset)
    if (preset === 'custom') return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const thisWeek = new Date(today); thisWeek.setDate(today.getDate() - ((today.getDay() - 4 + 7) % 7))
    if (preset === 'this-week') { setSubWeekStart(thisWeek.toISOString().split('T')[0]); return }
    if (preset === 'last-week') { const lw = new Date(thisWeek); lw.setDate(lw.getDate() - 7); setSubWeekStart(lw.toISOString().split('T')[0]); return }
    // For broader ranges snap to the most recent pay week with entries, default this week
    setSubWeekStart(thisWeek.toISOString().split('T')[0])
  }

  useEffect(() => {
    loadTimesheets()
    supabase.schema('Cores').from('employees').select('*').order('name').then(({ data }) => setEmployees(data || []))
    supabase.schema('Cores').from('payroll_config').select('key, value').then(({ data }) => setPayrollConfig(Object.fromEntries((data || []).map(r => [r.key, Number(r.value)]))))
    supabase.schema('Cores').from('stat_holidays').select('holiday_date').then(({ data }) => setStatHolidays(new Set((data || []).map(r => r.holiday_date))))
    supabase.schema('Cores').from('jobs').select('*, vessels(name)').order('job_number').then(({ data }) => setJobs(data || []))
    // Excludes still-drafting GearPhotos supply lines (applied_at null) — not real until Applied.
    supabase.schema('Cores').from('job_supplies').select('*, employees(id, name)').not('applied_at', 'is', null).order('work_date', { ascending: false }).then(({ data }) => setSupplies(data || []))
    supabase.schema('Cores').from('gear_photos').select('*').then(({ data }) => setGearPhotos(data || []))
    supabase.schema('Cores').from('weekly_summary_posted').select('employee_id, week_start, posted_at, posted_by').then(({ data }) => setPostedWeeks(Object.fromEntries((data || []).map(r => [`${r.employee_id}|${r.week_start}`, { posted_at: r.posted_at, posted_by: r.posted_by }]))))
  }, [])

  // Auto-refresh so one admin's edit (e.g. Niki zeroing out a per diem) shows up
  // on another admin's already-open screen (e.g. Tracy's) without a manual reload.
  // Silent (no loading-spinner flash) and paused while an edit/manual-entry modal
  // is open so a background reload can't race a save or reset in-progress typing.
  const editingRef = useRef(false)
  useEffect(() => {
    editingRef.current = !!(editEntry || manualEntry || addingNewJob)
  })
  useEffect(() => {
    const id = setInterval(() => {
      if (!editingRef.current) loadTimesheets({ silent: true })
    }, 10000)
    return () => clearInterval(id)
  }, [])

  // Default the Payroll tab's employee filter to everyone the first time employee
  // data loads — but only once, so it never overrides a user's own selection after.
  useEffect(() => {
    if (payEmployeeIdsDefaulted.current || employees.length === 0) return
    payEmployeeIdsDefaulted.current = true
    setPayEmployeeIds(employees.map(e => e.id))
  }, [employees])

  // silent=true skips the loading-state flash — used by the background poll so
  // it doesn't blank out the Timesheets tab (loadingEntries===true replaces the
  // whole results area, see render) every 30s, and doesn't alert() on a
  // transient network hiccup the admin never asked to see.
  async function loadTimesheets({ silent = false } = {}) {
    if (!silent) setLoadingEntries(true)
    const { data, error } = await supabase
      .schema('Cores').from('timesheet_entries')
      .select('*, employees(id, name), jobs(id, job_number, description, customers(name), vessels(name))')
      .order('work_date', { ascending: false })
    if (error) {
      if (!silent) alert(`Failed to load timesheets: ${error.message}`)
      else console.error('Background refresh failed:', error.message)
      if (!silent) setLoadingEntries(false)
      return
    }
    setEntries(data || [])
    if (!silent) setLoadingEntries(false)
    // Approving/submitting/etc changes this, so refresh it alongside entries
    // (SmsReview's onApproved calls this) rather than only on mount —
    // otherwise the banner, and the Submission Status tab's Pending column,
    // could read stale right after the exact action that would resolve them.
    const { data: pending, error: pendingError } = await supabase.schema('Cores').from('sms_submissions')
      .select('employee_id, work_date, status').in('status', ['submitted', 'collecting'])
    if (pendingError) {
      if (!silent) alert(`Failed to load pending submission count: ${pendingError.message}`)
      else console.error('Background refresh failed:', pendingError.message)
      return
    }
    setPendingSubmissionCount(pending?.length || 0)
    setPendingSubs(pending || [])
  }

  async function openEdit(e, computedReg, computedOT) {
    setEditEntry(e)
    setEditFields({
      employee_id: e.employee_id,
      work_date:   e.work_date,
      job_id:      e.job_id,
      reg_hours:   fmtHours(computedReg ?? Number(e.hours) - Number(e.ot_hours ?? 0)),
      ot_hours:    fmtHours(computedOT  ?? Number(e.ot_hours ?? 0)),
      description: e.description || '',
      per_diem:    e.per_diem ?? 0,
      sort_order:  e.sort_order ?? 1,
      time_in:          e.time_in ? e.time_in.substring(0, 5) : '',
      stated_time_out:  e.stated_time_out ? e.stated_time_out.substring(0, 5) : '',
      lunch_minutes:    e.lunch_minutes ?? '',
    })

    // Fetch all entries for this employee on this date to get all jobs on the timesheet
    const { data: allEntries } = await supabase
      .schema('Cores').from('timesheet_entries')
      .select('job_id')
      .eq('employee_id', e.employee_id)
      .eq('work_date', e.work_date)

    const jobIdsOnTimesheet = allEntries ? [...new Set(allEntries.map(entry => entry.job_id))] : [e.job_id]
    setTimesheetJobs(jobIdsOnTimesheet)

    // Fetch existing supplies for this entry — applied only, since a
    // still-drafting GearPhotos line isn't part of what this editor manages
    // and replaceSupplies() (on Save) never touches unapplied rows anyway.
    const { data: existingSupplies } = await supabase
      .schema('Cores').from('job_supplies')
      .select('job_id, supply_name, quantity')
      .eq('employee_id', e.employee_id)
      .eq('work_date', e.work_date)
      .not('applied_at', 'is', null)

    if (existingSupplies && existingSupplies.length > 0) {
      setEditSupplies(existingSupplies.map(s => ({
        job_id: s.job_id,
        supply_name: s.supply_name,
        quantity: s.quantity
      })))
    } else {
      setEditSupplies([{ job_id: '', supply_name: '', quantity: 1 }])
    }
  }

  // Same per-employee OT-threshold lookup computeEntryOT uses — passed into
  // fetchDailyOTContext so the preview shown before a manual entry is
  // approved agrees with what computeOTMap will actually charge once it is.
  const employeeThresholdFor = (employeeId) => {
    const emp = employees.find(e => e.id === employeeId)
    return emp && (emp.ot_daily_threshold != null || emp.ot_friday_threshold != null)
      ? { daily: emp.ot_daily_threshold, friday: emp.ot_friday_threshold }
      : null
  }

  async function saveEdit() {
    if (!editFields.description?.trim()) { alert('Add a note describing what was done'); return }
    if (addingNewJob && newJobFields.job_id && newJobFields.hours && !newJobFields.description?.trim()) {
      alert('Add a note describing the new job')
      return
    }
    setSavingEdit(true)
    const reg = Number(editFields.reg_hours) || 0
    const ot  = Number(editFields.ot_hours)  || 0
    const { error } = await supabase.schema('Cores').from('timesheet_entries').update({
      employee_id: editFields.employee_id,
      work_date:   editFields.work_date,
      job_id:      editFields.job_id,
      hours:       reg + ot,
      ot_hours:    ot,
      description: editFields.description,
      per_diem:    Number(editFields.per_diem),
      sort_order:  Number(editFields.sort_order),
      time_in:         editFields.time_in || null,
      stated_time_out: editFields.stated_time_out || null,
      lunch_minutes:   editFields.lunch_minutes === '' ? null : Number(editFields.lunch_minutes),
    }).eq('id', editEntry.id)
    if (error) {
      alert(`Save failed: ${error.message}`)
      setSavingEdit(false)
      return
    }

    // job_supplies is keyed by (employee_id, work_date) only — no link to a
    // specific entry — so replaceSupplies is a blind delete-then-insert for
    // that employee/date. Safe when employee/date are unchanged (editSupplies
    // was seeded from that same employee/date in openEdit, so it's a faithful
    // round-trip). If either changed, editSupplies still reflects the OLD
    // employee/date — writing it to the NEW one would destroy whatever real
    // supplies the destination already had logged. So: skip supplies
    // entirely on a reassignment rather than guess at merging two unrelated
    // lists; the admin can fix supplies for the new employee/date separately.
    const reassigned = editFields.employee_id !== editEntry.employee_id || editFields.work_date !== editEntry.work_date
    if (!reassigned) {
      const { error: supplyError } = await replaceSupplies(supabase, editFields.employee_id, editFields.work_date, editSupplies)
      if (supplyError) {
        alert(`Supplies save failed: ${supplyError.message}`)
        setSavingEdit(false)
        return
      }
    } else if (editSupplies.some(s => s.supply_name?.trim())) {
      alert('Entry moved to a different employee/date — supplies were left as-is rather than moved, to avoid overwriting anything already logged there. Add them separately if needed.')
    }

    // Save new job if being added — goes to SMS Review for approval, same as
    // any other manual entry, rather than landing live on the timesheet
    if (addingNewJob && newJobFields.job_id && newJobFields.hours) {
      const jobNumberFor = (jobId) => jobs.find(j => j.id === jobId)?.job_number || ''
      const hours = Number(newJobFields.hours)
      const { statDay, dailyOTThreshold, alreadyWorked } = await fetchDailyOTContext(
        supabase, editFields.employee_id, editFields.work_date,
        { employeeThreshold: employeeThresholdFor(editFields.employee_id), newHoursTotal: hours }
      )
      const { reg, ot } = computeDailyOTSplit(hours, alreadyWorked, dailyOTThreshold, statDay)
      const { error: newJobError } = await submitManualEntry(supabase, {
        employeeId: editFields.employee_id, workDate: editFields.work_date,
        entries: [{
          job_number: jobNumberFor(newJobFields.job_id), hours,
          description: newJobFields.description.trim(),
          reg_hours: Math.round(reg * 100) / 100, ot_hours: Math.round(ot * 100) / 100,
        }],
        adminName: getAdminName(),
      })
      if (newJobError) {
        alert(`Failed to add job: ${newJobError.message}`)
        setSavingEdit(false)
        return
      }
      setAddingNewJob(false)
      setNewJobFields({ job_id: '', hours: '', description: '' })
    }

    await ensureStatPay(editFields.employee_id, editFields.work_date)
    // If the entry moved to a different date and/or a different employee, the OLD
    // employee's OLD date may have lost its last real entry — clean up any now-unearned
    // stat pay there
    if (editFields.work_date !== editEntry.work_date || editFields.employee_id !== editEntry.employee_id) {
      await cleanupStatPay(editEntry.employee_id, editEntry.work_date)
    }
    await loadTimesheets()
    setEditEntry(null)
    setSavingEdit(false)
  }

  async function deleteEntry(entry) {
    const { error } = await supabase.schema('Cores').from('timesheet_entries').delete().eq('id', entry.id)
    if (error) { alert(`Delete failed: ${error.message}`); return }
    // job_supplies has no FK back to timesheet_entries — matched by
    // employee/job/day instead. Only clean it up if this was the LAST entry
    // for that combo; if a sibling entry still shares the same employee+job+
    // date (e.g. two separate tasks logged the same job the same day), wiping
    // supplies here would take that surviving entry's supplies out too.
    const { data: siblings } = await supabase.schema('Cores').from('timesheet_entries')
      .select('id').eq('employee_id', entry.employee_id).eq('job_id', entry.job_id).eq('work_date', entry.work_date)
    if (!siblings || siblings.length === 0) {
      // Applied only — a still-drafting GearPhotos line for this job/day isn't
      // tied to this entry's existence and must survive the entry being deleted.
      const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').delete()
        .eq('employee_id', entry.employee_id).eq('job_id', entry.job_id).eq('work_date', entry.work_date)
        .not('applied_at', 'is', null)
      if (supplyError) alert(`Entry deleted, but couldn't clean up its supplies: ${supplyError.message}`)
    }
    // If that was the employee's last real entry in the pay week, the auto
    // stat-pay entries for that week are no longer earned — remove them
    await cleanupStatPay(entry.employee_id, entry.work_date)
    setConfirmDeleteId(null)
    await loadTimesheets()
  }

  // The only path to changing an approved SMS-sourced entry's hours: send it
  // back to SMS Review instead of editing it in place, so every change to an
  // already-approved timesheet still goes through the approve step again —
  // never silently altered behind that gate.
  async function revertToPending(entry) {
    if (!entry.source_submission_id) {
      alert("This entry isn't linked to a submission — there's nothing to revert it to.")
      return
    }
    // job_supplies logged from the same text (not from a gear photo — those
    // carry source_photo_id instead) get cleaned up along with the entries
    // below. A supply already marked billed is real billing history, though —
    // deleting it would lose that, so it's detached (sms_submission_id
    // cleared) instead of removed: it survives, still billed, just no longer
    // tied to this submission, and won't get recreated as a duplicate when
    // she re-approves. Only genuinely unbilled ones are deleted outright,
    // since those are safe to regenerate from the corrected text.
    const { data: supplyRows } = await supabase.schema('Cores').from('job_supplies')
      .select('id, billed_at').eq('sms_submission_id', entry.source_submission_id)
    const billedCount = (supplyRows || []).filter(s => s.billed_at).length

    const baseMsg = `Revert this to pending? This deletes the approved timesheet entry (and any other job lines from the same text) and reopens the submission in SMS Review — it'll need to be re-approved after she fixes it.`
    const billedMsg = billedCount > 0
      ? `\n\nHeads up: ${billedCount} supply line${billedCount > 1 ? 's' : ''} from this submission ${billedCount > 1 ? 'have' : 'has'} already been marked billed — ${billedCount > 1 ? 'they' : 'it'} will be kept (still billed), just unlinked from this submission.`
      : ''
    if (!confirm(baseMsg + billedMsg)) return

    setRevertingId(entry.id)
    const { error: delEntriesErr } = await supabase.schema('Cores').from('timesheet_entries')
      .delete().eq('source_submission_id', entry.source_submission_id)
    if (delEntriesErr) { alert(`Revert failed: ${delEntriesErr.message}`); setRevertingId(null); return }

    const { error: delSuppliesErr } = await supabase.schema('Cores').from('job_supplies')
      .delete().eq('sms_submission_id', entry.source_submission_id).is('billed_at', null)
    if (delSuppliesErr) alert(`Entry reverted, but couldn't remove its supplies: ${delSuppliesErr.message}`)

    if (billedCount > 0) {
      const { error: detachErr } = await supabase.schema('Cores').from('job_supplies')
        .update({ sms_submission_id: null }).eq('sms_submission_id', entry.source_submission_id).not('billed_at', 'is', null)
      if (detachErr) alert(`Entry reverted, but couldn't preserve its billed supplies: ${detachErr.message}`)
    }

    const { error: statusErr } = await supabase.schema('Cores').from('sms_submissions')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', entry.source_submission_id)
    if (statusErr) alert(`Entry reverted, but couldn't reopen the submission in SMS Review: ${statusErr.message}`)

    await cleanupStatPay(entry.employee_id, entry.work_date)
    setRevertingId(null)
    await loadTimesheets()
  }

  // Goes to SMS Review for approval, same as any other manual entry, rather
  // than landing live on the timesheet
  async function saveNewJobToTimesheet() {
    if (!newJobFields.job_id || !newJobFields.hours) {
      alert('Pick job and enter hours')
      return
    }
    if (!newJobFields.description?.trim()) {
      alert('Add a note describing what was done')
      return
    }

    try {
      const jobNumberFor = (jobId) => jobs.find(j => j.id === jobId)?.job_number || ''
      const hours = Number(newJobFields.hours)
      const { statDay, dailyOTThreshold, alreadyWorked } = await fetchDailyOTContext(
        supabase, editEntry.employee_id, editEntry.work_date,
        { employeeThreshold: employeeThresholdFor(editEntry.employee_id), newHoursTotal: hours }
      )
      const { reg, ot } = computeDailyOTSplit(hours, alreadyWorked, dailyOTThreshold, statDay)

      const { error } = await submitManualEntry(supabase, {
        employeeId: editEntry.employee_id, workDate: editEntry.work_date,
        entries: [{
          job_number: jobNumberFor(newJobFields.job_id), hours,
          description: newJobFields.description.trim(),
          reg_hours: Math.round(reg * 100) / 100, ot_hours: Math.round(ot * 100) / 100,
        }],
        adminName: getAdminName(),
      })

      if (error) {
        alert(`Failed to add job: ${error.message}`)
        return
      }

      await loadTimesheets()
      setAddingNewJob(false)
      setNewJobFields({ job_id: '', hours: '', description: '' })
    } catch (err) {
      alert(`Error: ${err.message}`)
    }
  }

  async function saveManualEntry() {
    if (!manualFields.employee_id || !manualFields.work_date) {
      alert('Pick employee and date')
      return
    }
    // Hours may be 0 — that's how a day with no real work still gets logged
    // (so it shows as submitted instead of looking like a missing day).
    const validEntries = manualFields.entries.filter(e => e.job_id && e.hours !== '' && Number(e.hours) >= 0)
    if (validEntries.length === 0) {
      alert('Add at least one job (0 hours is fine if no work was done)')
      return
    }
    if (validEntries.some(e => !e.description?.trim())) {
      alert('Add a note describing what was done for each job')
      return
    }

    setSavingManual(true)
    try {
      // Goes to SMS Review for Niki to approve — same gate a text goes
      // through. The office typing this in is a report, not an approval;
      // treating it as one let an entry land live with nobody having
      // reviewed it (2026-08-26 incident). Applies to every employee,
      // Tracy included — there's no more per-employee approval bypass here.
      const jobNumberFor = (jobId) => jobs.find(j => j.id === jobId)?.job_number || ''
      const newHoursTotal = validEntries.reduce((s, e) => s + Number(e.hours), 0)
      const { statDay, dailyOTThreshold, alreadyWorked: startAlready } = await fetchDailyOTContext(
        supabase, manualFields.employee_id, manualFields.work_date,
        { employeeThreshold: employeeThresholdFor(manualFields.employee_id), newHoursTotal }
      )
      let alreadyWorked = startAlready
      const entries = validEntries.map(e => {
        const hours = Number(e.hours)
        const { reg, ot } = computeDailyOTSplit(hours, alreadyWorked, dailyOTThreshold, statDay)
        alreadyWorked += hours
        return {
          job_number: jobNumberFor(e.job_id), hours, description: e.description.trim(),
          reg_hours: Math.round(reg * 100) / 100, ot_hours: Math.round(ot * 100) / 100,
        }
      })
      const supplies = (manualFields.supplies || [])
        .filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
        .map(s => ({ job_number: jobNumberFor(s.job_id), supply_name: s.supply_name, quantity: Number(s.quantity) }))

      const { error } = await submitManualEntry(supabase, {
        employeeId: manualFields.employee_id, workDate: manualFields.work_date,
        timeIn: manualFields.time_in, statedTimeOut: manualFields.stated_time_out,
        lunchMinutes: manualFields.lunch_minutes, hasPerDiem: Number(manualFields.per_diem) > 0,
        entries, supplies, adminName: getAdminName(),
      })
      if (error) {
        alert(`Save failed: ${error.message}`)
        return
      }

      // A little just-for-her celebration on save
      if (manualFields.employee_id === TRACY_EMPLOYEE_ID) setCelebrate(true)

      await loadTimesheets()
      setManualEntry(null)
      setAutoFilled({ hours: null, lunch_minutes: null, stated_time_out: null, description: null, job_id: null })
      setManualFields({
        employee_id: '', work_date: toYMD(new Date()),
        time_in: '07:00', stated_time_out: '15:30', lunch_minutes: 30,
        entries: [{ job_id: '', hours: '', description: '' }],
        supplies: [{ job_id: '', supply_name: '', quantity: 1 }],
        per_diem: 0, sort_order: 1
      })
    } finally {
      setSavingManual(false)
    }
  }

  // ── Date helpers ──
  // Local calendar date — toISOString() is UTC and rolls to tomorrow after 9pm Atlantic
  function toYMD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  function getPayWeekStart(date) {
    const d = new Date(date)
    d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7))
    d.setHours(0, 0, 0, 0)
    return d
  }
  function getPayWeekDays(s) {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d })
  }
  function recentPayWeeks(n = 8) {
    const weeks = []; let s = getPayWeekStart(new Date())
    for (let i = 0; i < n; i++) { weeks.push(new Date(s)); s.setDate(s.getDate() - 7) }
    return weeks
  }

  function postedKey(empId, weekStart) { return `${empId}|${weekStart}` }

  async function togglePosted(empId, weekStart) {
    const key = postedKey(empId, weekStart)
    if (postedWeeks[key]) {
      const { error } = await supabase.schema('Cores').from('weekly_summary_posted').delete().eq('employee_id', empId).eq('week_start', weekStart)
      if (error) { alert('Error updating posted to Sage status: ' + error.message); return }
      setPostedWeeks(p => { const n = { ...p }; delete n[key]; return n })
    } else {
      const { data, error } = await supabase.schema('Cores').from('weekly_summary_posted')
        .insert({ employee_id: empId, week_start: weekStart, posted_by: getAdminName() }).select().single()
      if (error) { alert('Error updating posted to Sage status: ' + error.message); return }
      setPostedWeeks(p => ({ ...p, [key]: { posted_at: data.posted_at, posted_by: data.posted_by } }))
    }
  }

  // Same "are you sure, this week isn't over yet" guard the Weekly Compilation
  // view's button already had — shared so the new inline toggles (Timesheets
  // list, per-entry rows) get the same protection against posting a week
  // that's still being worked.
  function togglePostedWithGuard(empId, weekStart, isPosted) {
    if (!isPosted) {
      const weekEndDate = new Date(weekStart + 'T12:00:00')
      weekEndDate.setDate(weekEndDate.getDate() + 6)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      if (weekEndDate > today) {
        const label = weekEndDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
        if (!confirm(`This pay week isn't finished yet (ends ${label}) — mark as posted anyway?`)) return
      }
    }
    togglePosted(empId, weekStart)
  }

  // Compact "Posted to Sage" badge/link for a row keyed by employee+work_date
  // (Timesheets list, per-entry rows) — posting is per employee-week, so this
  // resolves the row's date to its pay week and reads/writes the same
  // postedWeeks state the Weekly Compilation view and Weekly Summary tab use.
  // Clickable both ways (post and un-post) — same fully reversible posture as
  // everything else in this app.
  function postedToSageControl(empId, workDate) {
    if (!empId) return null
    const weekStart = toYMD(getPayWeekStart(new Date(workDate + 'T12:00:00')))
    const info = postedWeeks[postedKey(empId, weekStart)]
    if (info) {
      const dateLabel = info.posted_at ? new Date(info.posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
      return (
        <span
          onClick={e => { e.stopPropagation(); togglePostedWithGuard(empId, weekStart, true) }}
          title={`Posted to Sage${dateLabel ? ' ' + dateLabel : ''}${info.posted_by ? ' by ' + info.posted_by : ''} — click to un-post`}
          style={{ cursor: 'pointer', padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600, background: '#e6f4ea', color: '#2d6a38', whiteSpace: 'nowrap' }}
        >✓ Posted to Sage</span>
      )
    }
    return (
      <span
        onClick={e => { e.stopPropagation(); togglePostedWithGuard(empId, weekStart, false) }}
        style={{ cursor: 'pointer', color: '#0066cc', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
      >Post to Sage</span>
    )
  }

  function downloadCSV(rows, filename) {
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))
    link.download = filename
    link.click()
  }

  function downloadWeeklySummary() {
    const weekEnd = new Date(payWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekStart = toYMD(payWeekStart)
    const weekEndStr = toYMD(weekEnd)

    const weekEntries = entries.filter(e => e.work_date >= weekStart && e.work_date <= weekEndStr)
    const empIds = [...new Set(weekEntries.map(e => e.employee_id))]
    const otMap = computeEntryOT(weekEntries)

    const byEmp = {}
    weekEntries.forEach(e => {
      if (!byEmp[e.employee_id]) byEmp[e.employee_id] = []
      byEmp[e.employee_id].push(e)
    })

    const rows = ['Employee,Total Hours,Reg Hours,OT Hours,Per Diem,Job Numbers,Hours by Job,Supplies Used']
    empIds.forEach(eid => {
      const emp = employees.find(e => e.id === eid)
      const empEntries = byEmp[eid] || []
      const empSupplies = supplies.filter(s => s.employee_id === eid && s.work_date >= weekStart && s.work_date <= weekEndStr)

      const totalHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
      const regHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
      const otHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.ot || 0), 0)
      const perDiem = empEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0)
      const jobNums = [...new Set(empEntries.map(e => e.jobs?.job_number).filter(Boolean))].join(', ')
      const jobHours = empEntries.map(e => `${e.jobs?.job_number}:${e.hours}hrs`).join(' | ')
      const suppliesStr = empSupplies.length > 0 ? empSupplies.map(s => `${s.supply_name}x${s.quantity}`).join('; ') : 'none'

      rows.push([
        emp?.name || 'Unknown',
        totalHours.toFixed(2),
        regHours.toFixed(2),
        otHours.toFixed(2),
        perDiem > 0 ? perDiem : 'none',
        jobNums,
        jobHours,
        suppliesStr
      ].map(v => `"${v}"`).join(','))
    })

    downloadCSV(rows, `weekly-summary-${weekStart}-to-${weekEndStr}.csv`)
  }

  function exportPayrollCSV() {
    const weekEnd = new Date(payWeekStart); weekEnd.setDate(weekEnd.getDate() + 6)
    const days = getPayWeekDays(payWeekStart)
    const weekDates = new Set(days.map(toYMD))
    const weekEntries = entries.filter(e => payEmployeeIds.includes(e.employee_id) && weekDates.has(e.work_date))
    const otMap = computeEntryOT(weekEntries)
    const rows = ['Employee,Day,Date,Job #,Customer,Total Hours,Reg Hours,OT Hours,Per Diem,Description,Week From,Week To']
    weekEntries
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1))
      .forEach(e => {
        const { reg = 0, ot = 0 } = otMap[e.id] || {}
        rows.push([
          e.employees?.name,
          new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }),
          e.work_date, e.jobs?.job_number, e.jobs?.customers?.name,
          fmtHours(e.hours), fmtHours(reg), fmtHours(ot),
          Number(e.per_diem || 0),
          `"${(e.description || '').replace(/"/g, '""')}"`,
          toYMD(payWeekStart), toYMD(weekEnd),
        ].join(','))
      })
    const fileTag = payEmployeeIds.length === 1
      ? (employees.find(e => e.id === payEmployeeIds[0])?.name?.replace(/\s+/g, '-') || 'unknown')
      : payEmployeeIds.length === employees.length ? 'everyone' : `${payEmployeeIds.length}-employees`
    downloadCSV(rows, `payroll-${fileTag}-${toYMD(payWeekStart)}.csv`)
  }

  function applyPreset(preset) {
    setDatePreset(preset)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = toYMD(today)
    if (preset === 'all')        { setDateFrom(''); setDateTo(''); return }
    if (preset === 'today')      { setDateFrom(todayStr); setDateTo(todayStr); return }
    if (preset === 'this-week')  { const s = getPayWeekStart(today); const e = new Date(s); e.setDate(e.getDate() + 6); setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return }
    if (preset === 'last-week')  { const s = getPayWeekStart(today); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return }
    if (preset === 'this-month') { setDateFrom(toYMD(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(toYMD(new Date(today.getFullYear(), today.getMonth() + 1, 0))); return }
    if (preset === 'last-30')    { const s = new Date(today); s.setDate(s.getDate() - 30); setDateFrom(toYMD(s)); setDateTo(todayStr); return }
  }

  // ── Filtering & grouping ──
  const filteredEntries = entries.filter(e => {
    if (dateFrom && e.work_date < dateFrom) return false
    if (dateTo   && e.work_date > dateTo)   return false
    if (filterEmployeeIds.length > 0 && !filterEmployeeIds.includes(e.employee_id)) return false
    return true
  })

  // Build OT map for all employees using full (unfiltered) entries for accurate weekly context
  const listOtMap = (() => {
    const empIds = [...new Set(filteredEntries.map(e => e.employee_id))]
    const map = {}
    empIds.forEach(empId => {
      const empAll = entries.filter(e => e.employee_id === empId)
      Object.assign(map, computeEntryOT(empAll))
    })
    return map
  })()

  // Column-driven sort for the Timesheets list view — clicking a header toggles
  // sortCol/sortDir; ties fall back to the original default order (date desc,
  // then employee name) so rows with equal values don't jump around.
  const timesheetSortComparators = {
    employee: (a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || ''),
    date:     (a, b) => a.date.localeCompare(b.date),
    jobs:     (a, b) => a.jobIds.size - b.jobIds.size,
    reg:      (a, b) => a.reg - b.reg,
    ot:       (a, b) => a.ot - b.ot,
    pd:       (a, b) => a.pd - b.pd,
  }
  const timesheetRows = Object.values(
    filteredEntries.reduce((acc, e) => {
      const key = `${e.employee_id}_${e.work_date}`
      if (!acc[key]) acc[key] = { key, employee: e.employees, date: e.work_date, entries: [], hours: 0, reg: 0, ot: 0, pd: 0, jobIds: new Set() }
      acc[key].entries.push(e)
      acc[key].hours += Number(e.hours)
      acc[key].reg   += listOtMap[e.id]?.reg ?? 0
      acc[key].ot    += listOtMap[e.id]?.ot  ?? 0
      acc[key].pd    += Number(e.per_diem || 0)
      acc[key].jobIds.add(e.job_id)
      return acc
    }, {})
  ).sort((a, b) => {
    const primary = timesheetSortComparators[sortCol](a, b) * (sortDir === 'asc' ? 1 : -1)
    if (primary !== 0) return primary
    return b.date.localeCompare(a.date) || (a.employee?.name || '').localeCompare(b.employee?.name || '')
  })

  const totalReg = timesheetRows.reduce((s, r) => s + r.reg, 0)
  const totalOT  = timesheetRows.reduce((s, r) => s + r.ot, 0)
  const totalPD  = timesheetRows.reduce((s, r) => s + r.pd, 0)

  function computeEntryOT(empEntries) {
    const employeeThresholds = Object.fromEntries(
      employees
        .filter(e => e.ot_daily_threshold != null || e.ot_friday_threshold != null)
        .map(e => [e.id, { daily: e.ot_daily_threshold, friday: e.ot_friday_threshold }])
    )
    return computeOTMap(empEntries, {
      dailyThreshold:  payrollConfig.daily_ot_threshold  ?? 8,
      weeklyThreshold: payrollConfig.weekly_ot_threshold ?? 40,
      statHolidays,
      employeeThresholds,
    })
  }

  // Pre-fill convenience for employees on a fixed weekly schedule (e.g. Tracy:
  // 8.75/day Mon-Thu, 5 on Friday) — not used for OT itself, that's computeEntryOT.
  // Time Out is derived from a 7:00 start + the threshold hours + lunch, so it
  // always lines up with Hours instead of drifting from the form's generic
  // 15:30 default. Friday has no lunch (matches her actual past Friday entries,
  // both logged with none); Mon-Thu gets 15 min.
  function defaultScheduleFor(employeeId, workDate) {
    const emp = employees.find(e => e.id === employeeId)
    if (!emp || (emp.ot_daily_threshold == null && emp.ot_friday_threshold == null)) return null
    const dow = new Date(workDate + 'T12:00:00').getDay()
    if (dow === 0 || dow === 6) return null // weekend — no default, OT-eligible from the first hour anyway
    const isFriday = dow === 5
    const hours = isFriday ? emp.ot_friday_threshold : emp.ot_daily_threshold
    if (hours == null) return null
    const lunchMinutes = isFriday ? 0 : 15
    const outTotalMinutes = 7 * 60 + Math.round(hours * 60) + lunchMinutes
    const stated_time_out = `${String(Math.floor(outTotalMinutes / 60) % 24).padStart(2, '0')}:${String(outTotalMinutes % 60).padStart(2, '0')}`
    const job_id = jobs.find(j => j.job_number === 'SHOP')?.id ?? null
    return { hours, lunch_minutes: lunchMinutes, stated_time_out, description: 'Paperwork', job_id }
  }

  // Shared by the Employee and Date fields in the manual-entry modal — either one
  // changing can bring a fixed-schedule employee's default into or out of scope.
  // `patch` is the field actually being changed, e.g. {employee_id} or {work_date}.
  function applyManualFieldChange(patch) {
    const employee_id = patch.employee_id ?? manualFields.employee_id
    const work_date = patch.work_date ?? manualFields.work_date
    const sched = defaultScheduleFor(employee_id, work_date)
    const next = { ...patch }
    const nextAuto = { ...autoFilled }
    let autoChanged = false
    let entryPatch = null

    if (sched) {
      if (manualFields.entries.length === 1) {
        if (manualFields.entries[0].hours === PRISTINE_MANUAL_DEFAULTS.hours || manualFields.entries[0].hours === autoFilled.hours) {
          entryPatch = { ...entryPatch, hours: String(sched.hours) }
          nextAuto.hours = String(sched.hours); autoChanged = true
        }
        if (manualFields.entries[0].description === PRISTINE_MANUAL_DEFAULTS.description || manualFields.entries[0].description === autoFilled.description) {
          entryPatch = { ...entryPatch, description: sched.description }
          nextAuto.description = sched.description; autoChanged = true
        }
        if (sched.job_id != null && (manualFields.entries[0].job_id === PRISTINE_MANUAL_DEFAULTS.job_id || manualFields.entries[0].job_id === autoFilled.job_id)) {
          entryPatch = { ...entryPatch, job_id: sched.job_id }
          nextAuto.job_id = sched.job_id; autoChanged = true
        }
      }
      if (manualFields.lunch_minutes === PRISTINE_MANUAL_DEFAULTS.lunch_minutes || manualFields.lunch_minutes === autoFilled.lunch_minutes) {
        next.lunch_minutes = sched.lunch_minutes
        nextAuto.lunch_minutes = sched.lunch_minutes; autoChanged = true
      }
      if (manualFields.stated_time_out === PRISTINE_MANUAL_DEFAULTS.stated_time_out || manualFields.stated_time_out === autoFilled.stated_time_out) {
        next.stated_time_out = sched.stated_time_out
        nextAuto.stated_time_out = sched.stated_time_out; autoChanged = true
      }
    }
    if (entryPatch) next.entries = [{ ...manualFields.entries[0], ...entryPatch }]

    if (autoChanged) setAutoFilled(nextAuto)
    setManualFields(f => ({ ...f, ...next }))
  }

  // Opposite direction from applyManualFieldChange's Hours→Time Out derivation:
  // once Time In/Out/Lunch are directly edited for a fixed-schedule employee,
  // those actual times are the source of truth, so Hours recomputes from them
  // instead of staying frozen at the schedule default — same math as the
  // mismatch warning in the Edit modal (calculateExpectedHours), just written
  // into the field instead of only flagged. Unconditional (no untouched-field
  // guard): a deliberately entered time always wins over whatever Hours held.
  function applyManualTimeChange(patch) {
    const next = { ...patch }
    const emp = employees.find(e => e.id === manualFields.employee_id)
    const hasCustomSchedule = emp && (emp.ot_daily_threshold != null || emp.ot_friday_threshold != null)
    const timeIn  = patch.time_in ?? manualFields.time_in
    const timeOut = patch.stated_time_out ?? manualFields.stated_time_out
    const lunch    = patch.lunch_minutes ?? manualFields.lunch_minutes

    if (hasCustomSchedule && manualFields.entries.length === 1 && timeIn && timeOut) {
      const hrs = calculateExpectedHours(timeIn, timeOut, lunch)
      if (hrs != null && hrs >= 0) {
        next.entries = [{ ...manualFields.entries[0], hours: String(Math.round(hrs * 100) / 100) }]
      }
    }
    setManualFields(f => ({ ...f, ...next }))
  }

  function openPhotoGroup(title, photos) {
    setPhotoGroup({ title, photos: [...photos].sort((a, b) => b.created_at.localeCompare(a.created_at)) })
  }

  function handleExport() {
    const toExport = selectedDate
      ? filteredEntries.filter(e => e.work_date === selectedDate)
      : filteredEntries

    // Compute OT using all entries for each employee (need full week context)
    const empIds = [...new Set(toExport.map(e => e.employee_id))]
    const otMap = {}
    empIds.forEach(empId => {
      const empAll = entries.filter(e => e.employee_id === empId)
      Object.assign(otMap, computeEntryOT(empAll))
    })

    const sorted = [...toExport].sort((a, b) =>
      (a.employees?.name || '').localeCompare(b.employees?.name || '') ||
      a.work_date.localeCompare(b.work_date) ||
      (a.sort_order ?? 1) - (b.sort_order ?? 1)
    )

    // Group by employee
    const byEmp = []
    sorted.forEach(e => {
      const last = byEmp[byEmp.length - 1]
      if (last && last.id === e.employee_id) { last.entries.push(e) }
      else byEmp.push({ id: e.employee_id, name: e.employees?.name || 'Unknown', entries: [e] })
    })

    // 13 columns: Type (Detail | Job Summary | Period Total | Grand Total), Employee, Date, Job, Customer, Total Hours, Reg Hours, OT Hours, Per Diem, Description, Period Reg, Period OT, Period PD
    const csvRow = cols => cols.map(c => c === '' || c == null ? '' : String(c).includes(',') ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')
    const rows = [csvRow(['Type','Employee','Date','Job','Customer','Total Hours','Reg Hours','OT Hours','Per Diem','Description','Period Reg','Period OT','Period PD'])]
    let grandReg = 0, grandOT = 0, grandPD = 0
    const jobTotals = {} // job_id → { jobNum, customer, reg, ot, pd }

    byEmp.forEach(({ name, entries }) => {
      let empReg = 0, empOT = 0, empPD = 0

      // Group by pay week
      const weekMap = {}
      entries.forEach(e => {
        const ws = toYMD(getPayWeekStart(new Date(e.work_date + 'T12:00:00')))
        if (!weekMap[ws]) weekMap[ws] = []
        weekMap[ws].push(e)
      })

      Object.keys(weekMap).sort().forEach(ws => {
        const weekEntries = weekMap[ws]
        const weekEnd = new Date(ws + 'T12:00:00')
        weekEnd.setDate(weekEnd.getDate() + 6)
        const weekLabel = `${fmtDate(ws)} – ${fmtDate(toYMD(weekEnd))}`
        let weekReg = 0, weekOT = 0, weekPD = 0

        // Group by job within the week
        const jobMap = {}
        weekEntries.forEach(e => {
          const key = e.job_id
          if (!jobMap[key]) jobMap[key] = { jobNum: e.jobs?.job_number || '', customer: e.jobs?.customers?.name || '', entries: [] }
          jobMap[key].entries.push(e)
        })

        Object.values(jobMap).forEach(({ jobNum, customer, entries: jobEntries }) => {
          let jobReg = 0, jobOT = 0, jobPD = 0
          jobEntries.sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1))
          jobEntries.forEach(e => {
            const { reg = 0, ot = 0 } = otMap[e.id] || {}
            const pd = Number(e.per_diem || 0)
            jobReg += reg; jobOT += ot; jobPD += pd
            if (!jobTotals[e.job_id]) jobTotals[e.job_id] = { jobNum: e.jobs?.job_number || '', customer: e.jobs?.customers?.name || '', reg: 0, ot: 0, pd: 0 }
            jobTotals[e.job_id].reg += reg; jobTotals[e.job_id].ot += ot; jobTotals[e.job_id].pd += pd
            rows.push(csvRow(['Detail', e.employees?.name, e.work_date, e.jobs?.job_number, e.jobs?.customers?.name,
              fmtHours(e.hours), fmtHours(reg), fmtHours(ot), pd, e.description || '', '', '', '']))
          })
          if (exportSummaries) rows.push(csvRow(['Job Summary', name, weekLabel, jobNum, customer, '', '', '', '', '', fmtHours(jobReg), fmtHours(jobOT), jobPD]))
          weekReg += jobReg; weekOT += jobOT; weekPD += jobPD
        })

        if (exportSummaries) rows.push(csvRow(['Period Total', name, weekLabel, '', '', '', '', '', '', '', fmtHours(weekReg), fmtHours(weekOT), weekPD]))
        empReg += weekReg; empOT += weekOT; empPD += weekPD
      })

      rows.push('')
      grandReg += empReg; grandOT += empOT; grandPD += empPD
    })

    if (exportSummaries) {
      Object.values(jobTotals)
        .sort((a, b) => a.jobNum.localeCompare(b.jobNum))
        .forEach(({ jobNum, customer, reg, ot, pd }) => {
          rows.push(csvRow(['Job Total', '', '', jobNum, customer, '', '', '', '', '', fmtHours(reg), fmtHours(ot), pd]))
        })
      rows.push('')
      rows.push(csvRow(['Grand Total', '', '', '', '', '', '', '', '', '', fmtHours(grandReg), fmtHours(grandOT), grandPD]))
    }
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))
    link.download = selectedDate ? `timesheets-${selectedDate}.csv` : 'timesheets.csv'
    link.click()
  }

  async function printTimesheetFor(emp, workDate) {
    const dayEntries = entries.filter(e => e.employee_id === emp.id && e.work_date === workDate)
      .sort((a, b) => (a.sort_order ?? 1) - (b.sort_order ?? 1))
    const totalHours = dayEntries.reduce((s, e) => s + Number(e.hours), 0)

    // Most recent non-rejected submission — maybeSingle() errors if the employee
    // has more than one row for the date (e.g. a rejected attempt plus the real one)
    const [{ data: subRows }, { data: daySupplies }] = await Promise.all([
      supabase
        .schema('Cores').from('sms_submissions')
        .select('time_in, stated_time_out, calculated_time_out, lunch_minutes, from_phone, updated_at')
        .eq('employee_id', emp.id)
        .eq('work_date', workDate)
        .neq('status', 'rejected')
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase
        .schema('Cores').from('job_supplies')
        .select('supply_name, quantity, description, jobs(job_number)')
        .eq('employee_id', emp.id)
        .eq('work_date', workDate)
        // Customer-facing PDF — a still-drafting GearPhotos line must never
        // print here before she's actually applied it.
        .not('applied_at', 'is', null),
    ])
    const submission = subRows?.[0] || null
    // Prefer the times saved on the timesheet entries themselves (works for both
    // manual and SMS-originated entries) — sms_submissions only exists for SMS entries.
    const entryWithTime = dayEntries.find(e => e.time_in || e.stated_time_out)

    // Employee "signature" — only stamp a name when every entry for the day
    // traces back to the employee themselves (their own SMS text, their own
    // logged-in app session, or a reply confirming a manually-added entry).
    // Any entry still `pending` confirmation leaves the line blank for a wet
    // signature, same as today.
    let employeeSignature = null
    if (dayEntries.length > 0 && dayEntries.every(e =>
      e.entry_source === 'sms' || e.entry_source === 'self' ||
      (e.entry_source === 'manual' && e.confirmation_status === 'confirmed')
    )) {
      const sources = new Set(dayEntries.map(e => e.entry_source))
      if (sources.size === 1 && sources.has('sms') && submission) {
        employeeSignature = { name: emp.name, subtitle: `Submitted via SMS · ${submission.from_phone} · ${fmtSignedAt(submission.updated_at)}` }
      } else if (sources.size === 1 && sources.has('self')) {
        const latest = dayEntries.reduce((max, e) => (e.created_at > max ? e.created_at : max), dayEntries[0].created_at)
        employeeSignature = { name: emp.name, subtitle: `Entered via employee app · ${fmtSignedAt(latest)}` }
      } else if (sources.size === 1 && sources.has('manual')) {
        const latest = dayEntries.reduce((max, e) => ((e.confirmed_at || '') > max ? e.confirmed_at : max), dayEntries[0].confirmed_at || '')
        const reply = dayEntries.find(e => e.confirmation_reply_text)?.confirmation_reply_text
        employeeSignature = { name: emp.name, subtitle: `Confirmed via SMS reply${reply ? ` "${reply}"` : ''} · ${fmtSignedAt(latest)}` }
      } else {
        // Mixed sources on the same day (e.g. an SMS day plus a self-added job)
        // — still fully confirmed, just no single channel to name.
        const timestamps = dayEntries.map(e => e.confirmed_at || e.created_at).filter(Boolean).sort()
        employeeSignature = { name: emp.name, subtitle: `Confirmed by employee · ${fmtSignedAt(timestamps[timestamps.length - 1])}` }
      }
    }

    // Supervisor "signature" — stamped at approval (SmsReview approve()) or
    // creation (manual entries are entered directly by the office) time.
    const approver = dayEntries.find(e => e.approved_by_name)
    const supervisorSignature = approver
      ? { name: approver.approved_by_name, subtitle: `Approved · ${fmtSignedAt(approver.approved_at)}` }
      : null

    const dayWeekStart = toYMD(getPayWeekStart(new Date(workDate + 'T12:00:00')))
    const dayPostedInfo = postedWeeks[postedKey(emp.id, dayWeekStart)]

    generateDailyTimesheetPDF({
      employeeName: emp.name,
      workDate: workDate,
      timeIn: entryWithTime?.time_in || submission?.time_in || null,
      timeOut: entryWithTime?.stated_time_out || submission?.stated_time_out || submission?.calculated_time_out || null,
      lunchMinutes: entryWithTime?.lunch_minutes ?? submission?.lunch_minutes ?? null,
      totalHours,
      perDiem: dayEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0),
      jobLines: dayEntries.map(e => ({
        jobNumber: e.jobs?.job_number || '',
        hours: e.hours,
        description: e.description || '',
      })),
      supplyLines: (daySupplies || []).map(s => ({
        jobNumber: s.jobs?.job_number || '',
        quantity: s.quantity,
        supplyName: s.supply_name,
        description: s.description || '',
      })),
      employeeSignature,
      supervisorSignature,
      postedAt: dayPostedInfo?.posted_at,
      postedBy: dayPostedInfo?.posted_by,
    })
  }

  async function handlePrintTimesheet() {
    if (!selectedEmp || !selectedDate) return
    await printTimesheetFor(selectedEmp, selectedDate)
  }

  async function handlePrintAllTimesheets() {
    if (timesheetRows.length === 0 || printingAll) return
    setPrintingAll(true)
    setPrintAllProgress({ done: 0, total: timesheetRows.length })
    for (let i = 0; i < timesheetRows.length; i++) {
      const row = timesheetRows[i]
      if (row.employee) {
        await printTimesheetFor(row.employee, row.date)
        // Small gap between downloads so the browser doesn't treat them as a popup flood
        await new Promise(r => setTimeout(r, 300))
      }
      setPrintAllProgress({ done: i + 1, total: timesheetRows.length })
    }
    setPrintingAll(false)
    setPrintAllProgress(null)
  }

  const tabStyle = (tab) => ({
    padding: '0.6rem 1.4rem', border: 'none', cursor: 'pointer', fontSize: '1rem',
    borderBottom: activeTab === tab ? '3px solid #0066cc' : '3px solid transparent',
    background: 'none', fontWeight: activeTab === tab ? 'bold' : 'normal',
    color: activeTab === tab ? '#0066cc' : '#555',
  })

  const fmtDate = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  const ef = (field) => ({ value: editFields[field] ?? '', onChange: e => setEditFields(f => ({ ...f, [field]: e.target.value })) })
  const inputStyle = { padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }

  // ── Weekly Compilation (on-screen match of the printed PDF) ──
  if (viewingWeeklyCompilation) {
    const { emp, days, weekStart } = viewingWeeklyCompilation
    const postedInfo = postedWeeks[postedKey(emp.id, weekStart)]
    const isPosted = !!postedInfo
    const totalReg = days.reduce((s, d) => s + Number(d.regHours || 0), 0)
    const totalOT = days.reduce((s, d) => s + Number(d.otHours || 0), 0)
    const totalPD = days.reduce((s, d) => s + Number(d.perDiems || 0), 0)
    const thStyleWc = { padding: '0.6rem 0.5rem', textAlign: 'left', fontSize: '0.8rem', fontWeight: 700, borderBottom: '2px solid #333' }
    const tdStyleWc = { padding: '0.5rem', borderBottom: '1px solid #eee' }

    return (
      <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button onClick={() => setViewingWeeklyCompilation(null)} style={{ padding: '0.3rem 0.9rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#555', fontSize: '0.9rem' }}>
            ← Weekly Summary
          </button>
          <button onClick={() => generateWeeklyCompilationPDF({ employeeName: emp.name, days, postedAt: postedInfo?.posted_at, postedBy: postedInfo?.posted_by })} style={{ padding: '0.4rem 1rem', border: '1px solid #0066cc', background: '#fff', color: '#0066cc', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
            Download PDF
          </button>
          <button
            onClick={() => togglePostedWithGuard(emp.id, weekStart, isPosted)}
            style={{
              marginLeft: 'auto', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600,
              border: isPosted ? '1px solid #2d6a38' : '1px solid #ccc',
              background: isPosted ? '#e6f4ea' : '#fff',
              color: isPosted ? '#2d6a38' : '#555',
            }}
          >
            {isPosted ? `✓ Posted to Sage — ${new Date(postedInfo.posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${postedInfo.posted_by ? ` by ${postedInfo.posted_by}` : ''}` : 'Post to Sage'}
          </button>
        </div>

        <div style={{ ...card, padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '0.03em' }}>CORES</div>
              <div style={{ fontSize: '0.6rem', letterSpacing: '0.1em', color: '#888' }}>WORLDWIDE</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>WEEKLY COMPILATION</div>
              <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>DAILY WORK HOURS</div>
            </div>
            <div style={{ width: 70 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div><strong>NAME:</strong> {emp.name}</div>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <div><strong>From</strong> {fmtHeaderDate(days[0].date)}</div>
              <div><strong>To</strong> {fmtHeaderDate(days[6].date)}</div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyleWc}>Day</th>
                <th style={thStyleWc}>Date</th>
                <th style={{ ...thStyleWc, textAlign: 'right' }}>Reg Hours</th>
                <th style={{ ...thStyleWc, textAlign: 'right' }}>O/T Hours</th>
                <th style={{ ...thStyleWc, textAlign: 'right' }}>Per Diems</th>
                <th style={{ ...thStyleWc, textAlign: 'center' }}>Posted</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => {
                const weekend = isWeekend(d.date)
                return (
                  <tr key={d.date} style={weekend ? { background: '#fafafa' } : {}}>
                    <td style={tdStyleWc}>{dayName(d.date)}</td>
                    <td style={{ ...tdStyleWc, color: '#888' }}>{fmtShortDate(d.date)}</td>
                    <td style={{ ...tdStyleWc, textAlign: 'right', color: weekend && !d.regHours ? '#ccc' : '#2d6a38' }}>
                      {d.regHours ? fmtHours(d.regHours) : (weekend ? '—' : '')}
                    </td>
                    <td style={{ ...tdStyleWc, textAlign: 'right', background: weekend ? '#e5e5e5' : 'transparent', color: d.otHours ? '#c0392b' : '#ccc', fontWeight: d.otHours ? 600 : 400 }}>
                      {d.otHours ? fmtHours(d.otHours) : ''}
                    </td>
                    <td style={{ ...tdStyleWc, textAlign: 'right', color: '#8B4513' }}>{d.perDiems || ''}</td>
                    <td style={{ ...tdStyleWc, textAlign: 'center', color: '#2d6a38', fontWeight: 700 }}>{isPosted ? '✓' : ''}</td>
                  </tr>
                )
              })}
              <tr style={{ fontWeight: 700, borderTop: '2px solid #333' }}>
                <td colSpan={2} style={tdStyleWc}>TOTAL</td>
                <td style={{ ...tdStyleWc, textAlign: 'right', color: '#2d6a38' }}>{fmtHours(totalReg)}</td>
                <td style={{ ...tdStyleWc, textAlign: 'right', color: totalOT ? '#c0392b' : '#333' }}>{fmtHours(totalOT)}</td>
                <td style={{ ...tdStyleWc, textAlign: 'right', color: '#8B4513' }}>{totalPD || ''}</td>
                <td style={{ ...tdStyleWc, textAlign: 'center', color: '#2d6a38' }}>{isPosted ? '✓' : ''}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '1.5rem' }}>Document# CW-OAD-F002 rev.0</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <ConfettiBurst active={celebrate} onDone={() => setCelebrate(false)} />

      {/* ── Edit modal ── */}
      {editEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '1.75rem', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 1.25rem' }}>Edit Entry</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Employee</label>
                <PersonPicker employees={employees} value={editFields.employee_id || ''} allowClear={false}
                  onChange={id => setEditFields(f => ({ ...f, employee_id: id }))} inputStyle={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Date</label>
                <input type="date" style={inputStyle} {...ef('work_date')} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#2d6a38', marginBottom: '0.3rem', fontWeight: 600 }}>Reg Hours</label>
                <input type="number" step="0.5" min="0" style={{ ...inputStyle, borderColor: '#2d6a38' }} {...ef('reg_hours')} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#c0392b', marginBottom: '0.3rem', fontWeight: 600 }}>OT Hours</label>
                <input type="number" step="0.5" min="0" style={{ ...inputStyle, borderColor: '#c0392b' }}
                  value={editFields.ot_hours ?? ''}
                  onChange={e => setEditFields(f => ({ ...f, ot_hours: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time In</label>
                <input type="time" style={inputStyle} value={editFields.time_in || ''} onChange={e => setEditFields(f => ({ ...f, time_in: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time Out</label>
                <input type="time" style={inputStyle} value={editFields.stated_time_out || ''} onChange={e => setEditFields(f => ({ ...f, stated_time_out: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Lunch (min)</label>
                <input type="number" min="0" style={inputStyle} value={editFields.lunch_minutes ?? ''} onChange={e => setEditFields(f => ({ ...f, lunch_minutes: e.target.value }))} />
              </div>
              {editFields.time_in && editFields.stated_time_out && (() => {
                const expectedHours = calculateExpectedHours(editFields.time_in, editFields.stated_time_out, editFields.lunch_minutes)
                const enteredHours = Number(editFields.reg_hours || 0) + Number(editFields.ot_hours || 0)
                const mismatch = expectedHours && Math.abs(expectedHours - enteredHours) > 0.1
                return mismatch ? (
                  <div style={{ gridColumn: '1 / -1', padding: '0.75rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', fontSize: '0.85rem', color: '#856404' }}>
                    ⚠️ <strong>Time mismatch:</strong> {editFields.time_in} to {editFields.stated_time_out} minus {editFields.lunch_minutes || 0}min = {fmtHours(expectedHours)}hrs, but you entered {fmtHours(enteredHours)}hrs
                  </div>
                ) : null
              })()}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Job</label>
                <select style={inputStyle} value={editFields.job_id || ''} onChange={e => setEditFields(f => ({ ...f, job_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} ({j.vessels?.name || 'Unknown'})</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Description</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }} {...ef('description')} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Per Diem</label>
                <select style={inputStyle} value={editFields.per_diem ?? 0} onChange={e => setEditFields(f => ({ ...f, per_diem: e.target.value }))}>
                  <option value={0}>None</option>
                  <option value={0.5}>×0.5 Half</option>
                  <option value={1}>×1 Standard</option>
                  <option value={1.5}>×1.5</option>
                  <option value={2}>×2 Double</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#555' }}>Supplies</div>
              {editSupplies.map((supply, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 0.8fr 0.6fr 0.4fr', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'end' }}>
                  <select style={inputStyle} value={supply.job_id || ''} onChange={e => {
                    const newSupplies = [...editSupplies]
                    newSupplies[i] = { ...supply, job_id: e.target.value }
                    setEditSupplies(newSupplies)
                  }}>
                    <option value="">— select job —</option>
                    {jobs.filter(j => timesheetJobs.includes(j.id) || j.id === editEntry.job_id).map(j => <option key={j.id} value={j.id}>{j.job_number}</option>)}
                  </select>
                  <input type="text" placeholder="Fill in supply name" style={inputStyle} value={supply.supply_name || ''} onChange={e => {
                    const newSupplies = [...editSupplies]
                    newSupplies[i] = { ...supply, supply_name: e.target.value }
                    setEditSupplies(newSupplies)
                  }} />
                  <input type="number" step="0.5" min="0" placeholder="Fill in qty" style={inputStyle} value={supply.quantity || ''} onChange={e => {
                    const newSupplies = [...editSupplies]
                    newSupplies[i] = { ...supply, quantity: e.target.value }
                    setEditSupplies(newSupplies)
                  }} />
                  <button onClick={() => setEditSupplies(editSupplies.filter((_, idx) => idx !== i))} style={{ padding: '0.4rem 0.6rem', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', cursor: 'pointer', color: '#c0392b', fontWeight: 600, fontSize: '0.85rem' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setEditSupplies([...editSupplies, { job_id: '', supply_name: '', quantity: 1 }])} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', cursor: 'pointer', fontSize: '0.85rem', marginTop: '0.25rem' }}>+ Add supply</button>
            </div>

            {!addingNewJob ? (
              <button onClick={() => setAddingNewJob(true)} style={{ padding: '0.6rem 1rem', border: '1px solid #0066cc', borderRadius: '4px', background: '#f0f5ff', cursor: 'pointer', color: '#0066cc', fontWeight: 600, fontSize: '0.9rem', marginTop: '1rem', width: '100%' }}>+ Add another job to this timesheet</button>
            ) : (
              <div style={{ border: '1px solid #e0e0e0', borderRadius: '4px', padding: '1rem', marginTop: '1rem', background: '#f9f9f9' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: '#555' }}>Add Job</div>
                <select style={inputStyle} value={newJobFields.job_id} onChange={e => setNewJobFields(f => ({ ...f, job_id: e.target.value }))} placeholder="Select job">
                  <option value="">— select job —</option>
                  {jobs.filter(j => j.status === 'open').map(j => <option key={j.id} value={j.id}>{j.job_number}</option>)}
                </select>
                <input type="number" step="0.5" min="0" placeholder="Fill in hours" style={{ ...inputStyle, marginTop: '0.5rem' }} value={newJobFields.hours} onChange={e => setNewJobFields(f => ({ ...f, hours: e.target.value }))} />
                <textarea placeholder="Fill in description" style={{ ...inputStyle, marginTop: '0.5rem', minHeight: '60px' }} value={newJobFields.description} onChange={e => setNewJobFields(f => ({ ...f, description: e.target.value }))} />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setEditEntry(null)} style={{ padding: '0.5rem 1.1rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit} style={{ padding: '0.5rem 1.1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual entry modal ── */}
      {manualEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '1.75rem', width: '540px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', margin: '2rem auto' }}>
            <h3 style={{ margin: '0 0 1.25rem' }}>Add Manual Timesheet</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem', fontWeight: 600 }}>Employee</label>
                <PersonPicker employees={employees} value={manualFields.employee_id || ''} allowClear={false}
                  placeholder="— select —" onChange={id => applyManualFieldChange({ employee_id: id })} inputStyle={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem', fontWeight: 600 }}>Date</label>
                <input type="date" style={inputStyle} value={manualFields.work_date} onChange={e => applyManualFieldChange({ work_date: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time In</label>
                <input type="time" style={inputStyle} value={manualFields.time_in} onChange={e => applyManualTimeChange({ time_in: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time Out</label>
                <input type="time" style={inputStyle} value={manualFields.stated_time_out} onChange={e => applyManualTimeChange({ stated_time_out: e.target.value })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Lunch (min)</label>
                <input type="number" min="0" style={inputStyle} value={manualFields.lunch_minutes} onChange={e => applyManualTimeChange({ lunch_minutes: Number(e.target.value) })} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Per Diem</label>
                <select style={inputStyle} value={manualFields.per_diem || 0} onChange={e => setManualFields(f => ({ ...f, per_diem: Number(e.target.value) }))}>
                  <option value={0}>None</option>
                  <option value={1}>Yes</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#555' }}>Jobs</div>
              {manualFields.entries.map((entry, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 1.5fr 0.4fr', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'end' }}>
                  <select style={inputStyle} value={entry.job_id || ''} onChange={e => {
                    const newEntries = [...manualFields.entries]
                    newEntries[i] = { ...entry, job_id: e.target.value }
                    setManualFields(f => ({ ...f, entries: newEntries }))
                  }}>
                    <option value="">— select job —</option>
                    {jobs.filter(j => j.status === 'open').map(j => <option key={j.id} value={j.id}>{j.job_number} ({j.vessels?.name || 'Unknown'})</option>)}
                  </select>
                  <input type="number" step="0.5" min="0" placeholder="Fill in hours" style={inputStyle} value={entry.hours || ''} onChange={e => {
                    const newEntries = [...manualFields.entries]
                    newEntries[i] = { ...entry, hours: e.target.value }
                    setManualFields(f => ({ ...f, entries: newEntries }))
                  }} />
                  <input type="text" placeholder="Fill in description" style={inputStyle} value={entry.description || ''} onChange={e => {
                    const newEntries = [...manualFields.entries]
                    newEntries[i] = { ...entry, description: e.target.value }
                    setManualFields(f => ({ ...f, entries: newEntries }))
                  }} />
                  <button onClick={() => setManualFields(f => ({ ...f, entries: f.entries.filter((_, idx) => idx !== i) }))} style={{ padding: '0.4rem 0.6rem', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', cursor: 'pointer', color: '#c0392b', fontWeight: 600, fontSize: '0.85rem' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setManualFields(f => ({ ...f, entries: [...f.entries, { job_id: '', hours: '', description: '' }] }))} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', cursor: 'pointer', fontSize: '0.85rem', marginTop: '0.25rem' }}>+ Add job</button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: '#555' }}>Supplies</div>
              {manualFields.supplies.map((supply, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 0.6fr 0.8fr 0.4fr', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'end' }}>
                  <select style={inputStyle} value={supply.job_id || ''} onChange={e => {
                    const newSupplies = [...manualFields.supplies]
                    newSupplies[i] = { ...supply, job_id: e.target.value }
                    setManualFields(f => ({ ...f, supplies: newSupplies }))
                  }}>
                    <option value="">— select job —</option>
                    {manualFields.entries.filter(e => e.job_id).map(e => {
                      const job = jobs.find(j => j.id === e.job_id)
                      return job ? <option key={job.id} value={job.id}>{job.job_number}</option> : null
                    })}
                  </select>
                  <input type="text" placeholder="Fill in supply name" style={inputStyle} value={supply.supply_name || ''} onChange={e => {
                    const newSupplies = [...manualFields.supplies]
                    newSupplies[i] = { ...supply, supply_name: e.target.value }
                    setManualFields(f => ({ ...f, supplies: newSupplies }))
                  }} />
                  <input type="number" step="0.5" min="0" placeholder="Fill in qty" style={inputStyle} value={supply.quantity || ''} onChange={e => {
                    const newSupplies = [...manualFields.supplies]
                    newSupplies[i] = { ...supply, quantity: e.target.value }
                    setManualFields(f => ({ ...f, supplies: newSupplies }))
                  }} />
                  <button onClick={() => setManualFields(f => ({ ...f, supplies: f.supplies.filter((_, idx) => idx !== i) }))} style={{ padding: '0.4rem 0.6rem', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', cursor: 'pointer', color: '#c0392b', fontWeight: 600, fontSize: '0.85rem' }}>✕</button>
                </div>
              ))}
              <button onClick={() => setManualFields(f => ({ ...f, supplies: [...f.supplies, { job_id: '', supply_name: '', quantity: 1 }] }))} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', cursor: 'pointer', fontSize: '0.85rem', marginTop: '0.25rem' }}>+ Add supply</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => { setManualEntry(null); setAutoFilled({ hours: null, lunch_minutes: null, stated_time_out: null, description: null, job_id: null }) }} style={{ padding: '0.5rem 1.1rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveManualEntry} disabled={savingManual} style={{ padding: '0.5rem 1.1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                {savingManual ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h1>Admin Dashboard</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        <button style={tabStyle('timesheets')} onClick={() => { setActiveTab('timesheets'); setSelectedEmp(null); setSelectedDate(null); setFilterEmployeeIds([]) }}>Timesheets</button>
        <button style={tabStyle('payroll')} onClick={() => setActiveTab('payroll')}>Payroll</button>
        <button style={tabStyle('weekly-summary')} onClick={() => setActiveTab('weekly-summary')}>Weekly Summary</button>
        <button style={tabStyle('sms')} onClick={() => setActiveTab('sms')}>SMS Review</button>
        <button style={tabStyle('photos')} onClick={() => setActiveTab('photos')}>Gear Photos</button>
        <button style={tabStyle('submission')} onClick={() => setActiveTab('submission')}>Submission Status</button>
      </div>

      {/* ── Timesheets tab ── */}
      {activeTab === 'timesheets' && (
        <>
          {pendingSubmissionCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', padding: '0.65rem 1rem', background: '#eaf2fc', border: '1px solid #b8d4f5', borderRadius: '6px', color: '#0a4a8a', fontSize: '0.9rem' }}>
              <span>Only approved entries show up here — {pendingSubmissionCount} submission{pendingSubmissionCount === 1 ? ' is' : 's are'} still waiting in SMS Review.</span>
              <button onClick={() => setActiveTab('sms')} style={{ padding: '0.3rem 0.8rem', border: '1px solid #0066cc', background: '#fff', color: '#0066cc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Review now →</button>
            </div>
          )}
          {/* Filters — always visible */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <MultiSelectDropdown
                options={employees}
                selectedIds={filterEmployeeIds}
                onChange={ids => { setFilterEmployeeIds(ids); setSelectedEmp(null); setSelectedDate(null) }}
                placeholder="All employees" allLabel="All employees" />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {[['all','All time'],['today','Today'],['this-week','This pay week'],['last-week','Last pay week'],['this-month','This month'],['last-30','Last 30 days'],['custom','Custom']].map(([key, label]) => (
                  <button key={key} onClick={() => applyPreset(key)} style={{
                    padding: '0.4rem 1rem', fontSize: '0.875rem', border: '1.5px solid',
                    borderColor: datePreset === key ? '#0066cc' : '#d1d5db', borderRadius: '999px', cursor: 'pointer',
                    background: datePreset === key ? '#0066cc' : '#fff',
                    color: datePreset === key ? '#fff' : '#555',
                    fontWeight: datePreset === key ? 700 : 400,
                    transition: 'all 0.15s',
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {datePreset === 'custom' && (
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.6rem 0.9rem', background: '#f8faff', border: '1px solid #d0e0f8', borderRadius: '6px' }}>
                <span style={{ color: '#555', fontSize: '0.9rem', fontWeight: 600 }}>From</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }} />
                <span style={{ color: '#aaa' }}>→</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }} />
                {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ padding: '0.3rem 0.7rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#888', fontSize: '0.85rem' }}>Clear</button>}
              </div>
            )}
          </div>

          {loadingEntries ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa' }}>Loading...</div>
          ) : selectedEmp ? (() => {
            const empEntries = filteredEntries.filter(e => !selectedDate || e.work_date === selectedDate)
            const empTotal = empEntries.reduce((s, e) => s + Number(e.hours), 0)

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  <button onClick={() => { setSelectedEmp(null); setSelectedDate(null) }}
                    style={{ padding: '0.3rem 0.9rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#555', fontSize: '0.9rem' }}>
                    ← {filterEmployeeIds.length === 1
                      ? (employees.find(e => e.id === filterEmployeeIds[0])?.name || 'All employees')
                      : filterEmployeeIds.length === 0 ? 'All employees' : `${filterEmployeeIds.length} employees`}
                  </button>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedEmp.name}</span>
                  <span style={{ color: '#555', fontSize: '0.95rem' }}>{selectedDate ? fmtDate(selectedDate) : 'All dates'}</span>
                  <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{fmtHours(empTotal)} hrs</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#555', cursor: 'pointer' }}>
                      <input type="checkbox" checked={exportSummaries} onChange={e => setExportSummaries(e.target.checked)} />
                      Include summaries
                    </label>
                    <button onClick={handleExport} style={{ padding: '0.35rem 0.9rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Export CSV</button>
                    {selectedDate && (
                      <button onClick={handlePrintTimesheet} style={{ padding: '0.35rem 0.9rem', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Print Timesheet</button>
                    )}
                  </div>
                </div>

                {empEntries.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No entries for this period.</div>
                ) : (() => {
                  // Reuse the shared calculator over the employee's FULL history so
                  // manual ot_hours and weekly-threshold context survive date filtering
                  const entryOtMap = computeEntryOT(entries.filter(e => e.employee_id === selectedEmp.id))

                  // Display: date desc, sort_order asc within each date
                  const sorted = [...empEntries].sort((a, b) =>
                    b.work_date.localeCompare(a.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1)
                  )
                  return (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                          {[['Date','left'],['Job','left'],['Customer','left'],['Vessel','left'],['Reg','center'],['OT','center'],['PD','center'],['Description','left'],['Photos','center'],['','left']].map(([h, align]) => (
                            <th key={h} style={{ padding: '0.75rem', textAlign: align, fontWeight: 600, color: h === 'OT' ? '#c0392b' : h === 'PD' ? '#8B4513' : '#555' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(e => {
                          const { reg = 0, ot = 0 } = entryOtMap[e.id] || {}
                          const perDiem = Number(e.per_diem || 0)
                          const isConfirmingDelete = confirmDeleteId === e.id
                          return (
                            <tr key={e.id} style={{ borderBottom: '1px solid #eee', background: isConfirmingDelete ? '#fff5f5' : '' }}
                              onMouseEnter={ev => { if (!isConfirmingDelete) hoverRow(ev, true) }}
                              onMouseLeave={ev => { if (!isConfirmingDelete) hoverRow(ev, false) }}>
                              <td style={{ padding: '0.75rem', color: '#555', whiteSpace: 'nowrap' }}>{fmtDate(e.work_date)}</td>
                              <td style={{ padding: '0.75rem', ...linkStyle }}>{e.jobs?.job_number ?? '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#666' }}>{e.jobs?.customers?.name ?? '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#888' }}>{e.jobs?.vessels?.name ?? '—'}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38', fontWeight: 600 }}>{fmtHours(reg)}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: ot > 0 ? '#c0392b' : '#ddd', fontWeight: ot > 0 ? 600 : 400 }}>{ot > 0 ? fmtHours(ot) : '—'}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: perDiem > 0 ? '#8B4513' : '#ddd' }}>{perDiem > 0 ? `×${perDiem}` : '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#555' }}>
                                {e.description ?? '—'}
                                {e.entry_source === 'manual' && e.confirmation_status === 'pending' && (
                                  <span title="Waiting on the employee to reply and confirm this entry" style={{ marginLeft: '0.5rem', padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600, background: '#fdf0d5', color: '#8a6100', whiteSpace: 'nowrap' }}>Awaiting confirmation</span>
                                )}
                                {e.entry_source === 'manual' && e.confirmation_status === 'confirmed' && (
                                  <span title={`Confirmed${e.confirmed_at ? ' ' + new Date(e.confirmed_at).toLocaleString() : ''}${e.confirmation_reply_text ? ` — replied "${e.confirmation_reply_text}"` : ''}`} style={{ marginLeft: '0.5rem', padding: '0.1rem 0.45rem', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 600, background: '#e3f3e3', color: '#2d6a38', whiteSpace: 'nowrap' }}>✓ Confirmed</span>
                                )}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                {(() => {
                                  const entryPhotos = gearPhotos.filter(p =>
                                    p.job_id === e.job_id && p.employee_id === e.employee_id && p.work_date === e.work_date)
                                  return entryPhotos.length > 0 ? (
                                    <span style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                      onClick={() => openPhotoGroup(`${e.jobs?.job_number ?? '?'} — ${selectedEmp.name} — ${fmtDate(e.work_date)}`, entryPhotos)}>
                                      📷 {entryPhotos.length}
                                    </span>
                                  ) : <span style={{ color: '#ccc' }}>—</span>
                                })()}
                              </td>
                              <td style={{ padding: '0.75rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                {isConfirmingDelete ? (
                                  <span>
                                    <span style={{ fontSize: '0.85rem', color: '#c0392b', marginRight: '0.5rem' }}>Delete?</span>
                                    <button onClick={() => deleteEntry(e)} style={{ marginRight: '0.4rem', padding: '0.2rem 0.6rem', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8rem' }}>Yes</button>
                                    <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '0.2rem 0.6rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>No</button>
                                  </span>
                                ) : e.entry_source === 'sms' ? (
                                  // Approved SMS-sourced entries aren't edited in place — hours only
                                  // ever change by going back through SMS Review and re-approving.
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {postedToSageControl(e.employee_id, e.work_date)}
                                    <button onClick={() => revertToPending(e)} disabled={revertingId === e.id}
                                      title="Send this back to SMS Review to change hours, then re-approve it"
                                      style={{ padding: '0.2rem 0.6rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: revertingId === e.id ? 'default' : 'pointer', fontSize: '0.8rem', color: '#555' }}>
                                      {revertingId === e.id ? 'Reverting…' : '↩ Revert to Pending'}
                                    </button>
                                    <button onClick={() => setConfirmDeleteId(e.id)} disabled={revertingId === e.id} style={{ padding: '0.2rem 0.6rem', border: '1px solid #ffaaaa', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem', color: '#c0392b' }}>Delete</button>
                                  </span>
                                ) : (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {postedToSageControl(e.employee_id, e.work_date)}
                                    <button onClick={() => openEdit(e, reg, ot)} style={{ padding: '0.2rem 0.6rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem', color: '#555' }}>Edit</button>
                                    <button onClick={() => setConfirmDeleteId(e.id)} style={{ padding: '0.2rem 0.6rem', border: '1px solid #ffaaaa', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem', color: '#c0392b' }}>Delete</button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
              </div>
            )
          })() : (
            /* ── List view ── */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{timesheetRows.length} timesheets</span>
                  <span style={{ color: '#aaa', margin: '0 0.5rem' }}>·</span>
                  <span style={{ color: '#2d6a38' }}>{fmtHours(totalReg)} reg</span>
                  {totalOT > 0 && <><span style={{ color: '#aaa', margin: '0 0.4rem' }}>·</span><span style={{ color: '#c0392b' }}>{fmtHours(totalOT)} OT</span></>}
                  {totalPD > 0 && <><span style={{ color: '#aaa', margin: '0 0.4rem' }}>·</span><span style={{ color: '#7a5c00' }}>{totalPD} PD</span></>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#555', cursor: 'pointer' }}>
                    <input type="checkbox" checked={exportSummaries} onChange={e => setExportSummaries(e.target.checked)} />
                    Include summaries
                  </label>
                  <button onClick={() => setManualEntry(true)} style={{ padding: '0.45rem 1rem', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>+ Add Manual Entry</button>
                  <button onClick={handleExport} style={{ padding: '0.45rem 1rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>Export CSV</button>
                  <button onClick={handlePrintAllTimesheets} disabled={printingAll || timesheetRows.length === 0}
                    style={{ padding: '0.45rem 1rem', background: printingAll ? '#99b8d9' : '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: printingAll ? 'default' : 'pointer', fontSize: '0.9rem' }}>
                    {printingAll ? `Printing ${printAllProgress?.done ?? 0}/${printAllProgress?.total ?? 0}…` : `Print All PDFs (${timesheetRows.length})`}
                  </button>
                </div>
              </div>

              {timesheetRows.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No timesheets found for the selected filters.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      {[
                        { key: 'employee', label: 'Employee', align: 'left' },
                        { key: 'date', label: 'Date', align: 'left' },
                        { key: 'jobs', label: 'Jobs', align: 'center' },
                        { key: 'reg', label: 'Reg', align: 'center' },
                        { key: 'ot', label: 'OT', align: 'center' },
                        { key: 'pd', label: 'PD', align: 'center' },
                        { key: null, label: 'Photos', align: 'center' },
                        { key: null, label: '', align: 'right' },
                      ].map((h) => (
                        <th key={h.key || h.label || 'actions'}
                          onClick={h.key ? () => {
                            if (sortCol === h.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                            else { setSortCol(h.key); setSortDir('asc') }
                          } : undefined}
                          style={{ padding: '0.75rem', textAlign: h.align, fontWeight: 600, color: '#555', cursor: h.key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
                          {h.label}{sortCol === h.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timesheetRows.map(row => {
                      const rowPhotos = gearPhotos.filter(p => p.employee_id === row.employee?.id && p.work_date === row.date)
                      return (
                      <tr key={row.key} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                        onClick={() => {
                          setFilterEmployeeIds(row.employee ? [row.employee.id] : [])
                          setSelectedEmp(row.employee)
                          setSelectedDate(row.date)
                        }}
                        onMouseEnter={e => hoverRow(e, true)}
                        onMouseLeave={e => hoverRow(e, false)}>
                        <td style={{ padding: '0.75rem', ...linkStyle }}>{row.employee?.name}</td>
                        <td style={{ padding: '0.75rem', color: '#555' }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', color: '#888' }}>{row.jobIds.size}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#2d6a38' }}>{fmtHours(row.reg)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: row.ot > 0 ? 600 : 400, color: row.ot > 0 ? '#c0392b' : '#ccc' }}>{fmtHours(row.ot)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', color: row.pd > 0 ? '#7a5c00' : '#ccc' }}>{row.pd > 0 ? row.pd : '—'}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                          {rowPhotos.length > 0 ? (
                            <span style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              onClick={e => { e.stopPropagation(); openPhotoGroup(`${row.employee?.name} — ${fmtDate(row.date)}`, rowPhotos) }}>
                              📷 {rowPhotos.length}
                            </span>
                          ) : <span style={{ color: '#ccc' }}>—</span>}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
                            {postedToSageControl(row.employee?.id, row.date)}
                            <span style={{ color: '#aaa', fontSize: '0.85rem' }}>view →</span>
                          </span>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #ddd', background: '#fafafa', fontWeight: 700 }}>
                      <td style={{ padding: '0.75rem', color: '#333' }}>Total</td>
                      <td colSpan={2} />
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38' }}>{fmtHours(totalReg)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: totalOT > 0 ? '#c0392b' : '#ccc' }}>{fmtHours(totalOT)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: totalPD > 0 ? '#7a5c00' : '#ccc' }}>{totalPD > 0 ? totalPD : '—'}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Submission Status tab ── */}
      {activeTab === 'submission' && (() => {
        const ws = new Date(subWeekStart + 'T12:00:00')
        const weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6)
        const weekDates = new Set(Array.from({ length: 7 }, (_, i) => {
          const d = new Date(ws); d.setDate(d.getDate() + i); return d.toISOString().split('T')[0]
        }))

        // Build recent pay weeks for dropdown
        const recentWeeks = []
        const cur = new Date(ws)
        for (let i = 0; i < 8; i++) {
          recentWeeks.push(cur.toISOString().split('T')[0])
          cur.setDate(cur.getDate() - 7)
        }

        // Weekdays only — nobody expects a Sat/Sun entry by default, so
        // counting weekends as "missing" would make every employee look
        // short every single week regardless of actual attendance.
        const weekdayDates = [...weekDates].filter(d => {
          const dow = new Date(d + 'T12:00:00').getDay()
          return dow !== 0 && dow !== 6
        })

        const rows = employees.filter(emp => !subEmployeeFilter || emp.id === subEmployeeFilter).map(emp => {
          const approvedDates = new Set(entries.filter(e => e.employee_id === emp.id && weekDates.has(e.work_date)).map(e => e.work_date))
          const pendingDates = new Set(
            pendingSubs.filter(s => s.employee_id === emp.id && weekDates.has(s.work_date) && !approvedDates.has(s.work_date)).map(s => s.work_date)
          )
          const missingDates = weekdayDates.filter(d => !approvedDates.has(d) && !pendingDates.has(d))
          const submitted = approvedDates.size > 0
          return {
            emp, submitted,
            approvedCount: approvedDates.size,
            pendingCount: pendingDates.size,
            missingCount: missingDates.length,
          }
        }).sort((a, b) => b.missingCount - a.missingCount || a.emp.name.localeCompare(b.emp.name))

        const totalApproved = rows.reduce((s, r) => s + r.approvedCount, 0)
        const totalPending = rows.reduce((s, r) => s + r.pendingCount, 0)
        const totalMissing = rows.reduce((s, r) => s + r.missingCount, 0)
        const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[['this-week','This pay week'],['last-week','Last pay week'],['custom','Custom']].map(([key, label]) => (
                  <button key={key} onClick={() => applySubPreset(key)} style={{
                    padding: '0.4rem 1rem', fontSize: '0.875rem', border: '1.5px solid',
                    borderColor: subPreset === key ? '#0066cc' : '#d1d5db', borderRadius: '999px', cursor: 'pointer',
                    background: subPreset === key ? '#0066cc' : '#fff',
                    color: subPreset === key ? '#fff' : '#555',
                    fontWeight: subPreset === key ? 700 : 400,
                    transition: 'all 0.15s',
                  }}>{label}</button>
                ))}
                <PersonPicker employees={employees} value={subEmployeeFilter} onChange={setSubEmployeeFilter} />
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <span style={{ color: '#2d6a38', fontWeight: 600 }}>{totalApproved} approved</span>
                <span style={{ color: '#aaa' }}>·</span>
                <span style={{ color: totalPending > 0 ? '#a06b00' : '#aaa', fontWeight: totalPending > 0 ? 700 : 400 }}>{totalPending} pending</span>
                <span style={{ color: '#aaa' }}>·</span>
                <span style={{ color: totalMissing > 0 ? '#c0392b' : '#aaa', fontWeight: totalMissing > 0 ? 700 : 400 }}>{totalMissing} missing</span>
              </div>
            </div>
            {subPreset === 'custom' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', padding: '0.6rem 0.9rem', background: '#f8faff', border: '1px solid #d0e0f8', borderRadius: '6px' }}>
                <span style={{ color: '#555', fontSize: '0.9rem', fontWeight: 600 }}>Pay week:</span>
                <select value={subWeekStart} onChange={e => setSubWeekStart(e.target.value)}
                  style={{ padding: '0.35rem 0.7rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }}>
                  {recentWeeks.map(w => {
                    const we = new Date(w + 'T12:00:00'); we.setDate(we.getDate() + 6)
                    return <option key={w} value={w}>{fmtDate(w)} – {fmtDate(we.toISOString().split('T')[0])}</option>
                  })}
                </select>
              </div>
            )}
            <div style={{ marginBottom: '1.5rem', color: '#777', fontSize: '0.9rem' }}>
              Week of {fmtDate(subWeekStart)} – {fmtDate(new Date(new Date(subWeekStart + 'T12:00:00').setDate(new Date(subWeekStart + 'T12:00:00').getDate() + 6)).toISOString().split('T')[0])}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  {['Employee', 'Approved', 'Pending', 'Missing'].map((h, i) => (
                    <th key={i} style={{ padding: '0.75rem', textAlign: i > 0 ? 'center' : 'left', fontWeight: 600, color: '#555' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, submitted, approvedCount, pendingCount, missingCount }) => (
                  <tr key={emp.id}
                    style={{ borderBottom: '1px solid #eee', background: missingCount > 0 ? '#fff9f9' : '', cursor: submitted ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!submitted) return
                      const we = new Date(ws); we.setDate(we.getDate() + 6)
                      setFilterEmployeeIds([emp.id])
                      setSelectedEmp(emp)
                      setSelectedDate(null)
                      setDateFrom(subWeekStart)
                      setDateTo(we.toISOString().split('T')[0])
                      setDatePreset('custom')
                      setActiveTab('timesheets')
                    }}
                    onMouseEnter={e => { if (submitted) hoverRow(e, true) }}
                    onMouseLeave={e => hoverRow(e, false)}>
                    <td style={{ padding: '0.75rem', fontWeight: 600, ...(submitted ? linkStyle : {}) }}>{emp.name}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      {approvedCount > 0
                        ? <span style={{ color: '#2d6a38', fontWeight: 600 }}>{approvedCount}</span>
                        : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      {pendingCount > 0
                        ? <span style={{ color: '#a06b00', fontWeight: 600 }}>{pendingCount}</span>
                        : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      {missingCount > 0
                        ? <span style={{ color: '#c0392b', fontWeight: 700 }}>{missingCount}</span>
                        : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* ── Payroll tab ── */}
      {activeTab === 'payroll' && (() => {
        const dailyThreshold  = payrollConfig.daily_ot_threshold  ?? 8
        const weeklyThreshold = payrollConfig.weekly_ot_threshold ?? 40
        const otMultiplier    = payrollConfig.ot_multiplier        ?? 1.5
        const statMultiplier  = payrollConfig.stat_multiplier ?? 1.5
        const perDiemRate     = payrollConfig.per_diem_rate        ?? 0

        const days       = getPayWeekDays(payWeekStart)
        const weekDates  = new Set(days.map(toYMD))
        const weekEntries = entries.filter(e => payEmployeeIds.includes(e.employee_id) && weekDates.has(e.work_date))
        const byDate     = weekEntries.reduce((acc, e) => { if (!acc[e.work_date]) acc[e.work_date] = []; acc[e.work_date].push(e); return acc }, {})

        const entryOtMap = computeEntryOT(weekEntries)

        const dayBreakdowns = days.map(day => {
          const ymd        = toYMD(day)
          const dayEntries = (byDate[ymd] || []).slice().sort((a, b) => (a.sort_order ?? 1) - (b.sort_order ?? 1))
          const dayHours   = dayEntries.reduce((s, e) => s + Number(e.hours), 0)
          const dayPerDiem = dayEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0)
          const isStat     = statHolidays.has(ymd)
          const isToday    = ymd === toYMD(new Date())
          const isWeekendDay = day.getDay() === 0 || day.getDay() === 6
          const regularHours = dayEntries.reduce((s, e) => s + (entryOtMap[e.id]?.reg ?? 0), 0)
          const otHours      = dayEntries.reduce((s, e) => s + (entryOtMap[e.id]?.ot ?? 0), 0)

          return { ymd, day, dayEntries, dayHours, regularHours, otHours, isStat, dayPerDiem, isToday, isWeekend: isWeekendDay }
        })

        const totalHours   = dayBreakdowns.reduce((s, d) => s + d.dayHours, 0)
        const totalRegular = dayBreakdowns.reduce((s, d) => s + d.regularHours, 0)
        const totalOT      = dayBreakdowns.reduce((s, d) => s + d.otHours, 0)
        const totalPerDiem = dayBreakdowns.reduce((s, d) => s + d.dayPerDiem, 0)
        const statDays     = dayBreakdowns.filter(d => d.isStat && d.dayEntries.some(e => !e.is_stat_pay))

        const thStyle = { padding: '0.65rem 0.75rem', textAlign: 'center', fontWeight: 600, color: '#555', whiteSpace: 'nowrap', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }

        return (
          <div>
            {/* Selectors */}
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', color: '#555', fontWeight: 600, marginBottom: '0.4rem' }}>Employee</label>
                <button
                  onClick={() => setPayEmpDropdownOpen(o => !o)}
                  style={{ padding: '0.5rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '220px', textAlign: 'left', background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: payEmployeeIds.length ? '#333' : '#999' }}>
                    {payEmployeeIds.length === 0
                      ? '— select —'
                      : payEmployeeIds.length === employees.length
                        ? 'Everyone'
                        : payEmployeeIds.length <= 2
                          ? payEmployeeIds.map(id => employees.find(e => e.id === id)?.name).filter(Boolean).join(', ')
                          : `${payEmployeeIds.length} selected`}
                  </span>
                  <span style={{ color: '#aaa' }}>▾</span>
                </button>
                {payEmpDropdownOpen && (
                  <>
                    <div onClick={() => setPayEmpDropdownOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                    <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem', background: '#fff', border: '1px solid #ccc', borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: '260px', maxHeight: '320px', overflowY: 'auto', zIndex: 20 }}>
                      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid #eee' }}>
                        <button onClick={() => setPayEmployeeIds(employees.map(e => e.id))} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Select all</button>
                        <button onClick={() => setPayEmployeeIds([])} style={{ background: 'none', border: 'none', color: '#0066cc', cursor: 'pointer', fontSize: '0.82rem', padding: 0 }}>Clear</button>
                      </div>
                      {employees.map(e => (
                        <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                          <input
                            type="checkbox"
                            checked={payEmployeeIds.includes(e.id)}
                            onChange={ev => setPayEmployeeIds(prev => ev.target.checked ? [...prev, e.id] : prev.filter(id => id !== e.id))}
                          />
                          {e.name}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label style={{ display: 'block', color: '#555', fontWeight: 600, marginBottom: '0.4rem' }}>Pay Week</label>
                <select value={toYMD(payWeekStart)} onChange={e => setPayWeekStart(new Date(e.target.value + 'T12:00:00'))} style={{ padding: '0.5rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '230px' }}>
                  {payWeeks.map(w => { const end = new Date(w); end.setDate(end.getDate() + 6); return <option key={toYMD(w)} value={toYMD(w)}>Thu {fmtPayDate(toYMD(w))} – Wed {fmtPayDate(toYMD(end))}</option> })}
                </select>
              </div>
              <button onClick={exportPayrollCSV} style={{ padding: '0.5rem 1rem', background: '#2d6a38', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Export CSV</button>
            </div>

            {payEmployeeIds.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: '3rem', color: '#aaa' }}>Select one or more employees to view the pay week</div>
            ) : (
              <>
                {/* Summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: 'Total Hours',   value: fmtHours(totalHours),   color: '#1a1a2e' },
                    { label: `Regular (≤${dailyThreshold}h/day, ≤${weeklyThreshold}h/wk)`, value: fmtHours(totalRegular), color: '#2d6a38' },
                    { label: `OT @ ${otMultiplier}×`, value: fmtHours(totalOT), color: '#c0392b' },
                    { label: `Per Diem${perDiemRate > 0 ? ` ($${(totalPerDiem * perDiemRate).toFixed(2)})` : ''}`, value: totalPerDiem > 0 ? `×${totalPerDiem}` : '—', color: '#8B4513' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={card}>
                      <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
                      <div style={{ color: '#888', fontSize: '0.8rem', marginTop: '0.2rem' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Stat holiday notice */}
                {statDays.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '0.6rem 1rem', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '6px', fontSize: '0.9rem', color: '#7a5c00' }}>
                    Worked on stat holiday{statDays.length > 1 ? 's' : ''} this week (8h stat pay granted separately; worked hours are OT):
                    {' '}{statDays.map(d => `${d.day.toLocaleDateString('en-GB', { weekday: 'short' })} ${fmtPayDate(d.ymd)}`).join(', ')}
                  </div>
                )}

                {/* Day-by-day table */}
                <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '13%' }} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Name</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Job</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Hours</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayBreakdowns.map(({ ymd, day, dayEntries, dayHours, regularHours, otHours, isStat, dayPerDiem, isToday, isWeekend }) => (
                      <React.Fragment key={ymd}>
                        <tr style={{ background: isStat && dayHours > 0 ? '#fdf6e3' : isToday ? '#eaf7ee' : '#eef0f3' }}>
                          <td colSpan={4} style={{ padding: '0.5rem 0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.6rem' }}>
                              <span style={{ fontWeight: 700, color: isWeekend ? '#999' : '#1a1a2e' }}>
                                {day.toLocaleDateString('en-GB', { weekday: 'long' })}
                              </span>
                              <span style={{ color: '#888', fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>{fmtPayDate(ymd)}</span>
                              {isStat && <span style={chip('#7a5c00', '#ffe082')}>STAT +{statMultiplier}×</span>}
                              <span style={{ flex: 1 }} />
                              {dayHours > 0 && <span style={{ fontWeight: 700, color: '#1a1a2e', fontSize: '0.9rem' }}>{fmtHours(dayHours)} total</span>}
                              {regularHours > 0 && <span style={chip('#2d6a38', '#e9f5eb')}>{fmtHours(regularHours)} reg</span>}
                              {otHours > 0 && <span style={chip('#c0392b', '#fbeaea')}>{fmtHours(otHours)} OT</span>}
                              {dayPerDiem > 0 && <span style={chip('#8B4513', '#f3e7da')}>×{dayPerDiem} PD</span>}
                            </div>
                          </td>
                        </tr>
                        {dayEntries.length === 0 ? (
                          <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td colSpan={4} style={{ padding: '0.6rem 0.75rem', color: '#ccc', fontSize: '0.85rem' }}>No entries</td>
                          </tr>
                        ) : dayEntries.map(e => {
                          const { reg = 0, ot = 0 } = entryOtMap[e.id] || {}
                          return (
                            <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{e.employees?.name}</td>
                              <td style={{ padding: '0.6rem 0.75rem' }}>
                                <span style={{ color: '#0066cc', fontWeight: 600 }}>{e.jobs?.job_number}</span>
                                <span style={{ color: '#aaa', fontSize: '0.85rem', marginLeft: '0.4rem' }}>{e.jobs?.customers?.name}</span>
                              </td>
                              <td style={{ padding: '0.6rem 0.75rem' }}>
                                <span style={chip('#2d6a38', '#e9f5eb')}>{fmtHours(reg)} reg</span>
                                {ot > 0 && <span style={{ ...chip('#c0392b', '#fbeaea'), marginLeft: '0.3rem' }}>{fmtHours(ot)} OT</span>}
                              </td>
                              <td style={{ padding: '0.6rem 0.75rem', color: '#777', fontSize: '0.85rem' }}>{e.description || '—'}</td>
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    ))}
                    <tr style={{ background: '#fafafa', borderTop: '1px solid #e5e5e5', fontWeight: 700 }}>
                      <td colSpan={2} style={{ padding: '0.65rem 0.75rem' }}>Total</td>
                      <td style={{ padding: '0.65rem 0.75rem' }}>{fmtHours(totalHours)}</td>
                      <td style={{ padding: '0.65rem 0.75rem', color: '#888', fontSize: '0.8rem', fontWeight: 400 }}>
                        {fmtHours(totalRegular)} reg
                        {totalOT > 0 && `, ${fmtHours(totalOT)} OT`}
                        {statDays.length > 0 && `, ${statDays.length} stat day${statDays.length > 1 ? 's' : ''}`}
                        {totalPerDiem > 0 && `, ×${totalPerDiem} PD`}
                        {' '}· {weekEntries.length} entr{weekEntries.length === 1 ? 'y' : 'ies'}
                      </td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── Weekly Summary tab ── */}
      {activeTab === 'weekly-summary' && (() => {
        const weekEnd = new Date(payWeekStart)
        weekEnd.setDate(weekEnd.getDate() + 6)
        const weekStart = toYMD(payWeekStart)
        const weekEndStr = toYMD(weekEnd)
        const weekEntries = entries.filter(e => e.work_date >= weekStart && e.work_date <= weekEndStr)
        const empIds = [...new Set(weekEntries.map(e => e.employee_id))]
        const otMap = computeEntryOT(weekEntries)
        const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(payWeekStart); d.setDate(d.getDate() + i); return toYMD(d) })

        const weekData = empIds.map(eid => {
          const emp = employees.find(e => e.id === eid)
          const empEntries = weekEntries.filter(e => e.employee_id === eid)
          const totalHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
          const regHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
          const otHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.ot || 0), 0)
          const perDiem = empEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0)
          const jobNums = [...new Set(empEntries.map(e => e.jobs?.job_number).filter(Boolean))].join(', ')
          const empSupplies = supplies.filter(s => s.employee_id === eid && s.work_date >= weekStart && s.work_date <= weekEndStr)
          const days = weekDates.map(dateYMD => {
            const dayEntries = empEntries.filter(e => e.work_date === dateYMD)
            return {
              date: dateYMD,
              regHours: dayEntries.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0),
              otHours: dayEntries.reduce((s, e) => s + (otMap[e.id]?.ot || 0), 0),
              perDiems: dayEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0),
            }
          })
          return { emp, totalHours, regHours, otHours, perDiem, jobNums, supplies: empSupplies, days }
        }).sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || ''))

        return (
          <div>
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ color: '#555', fontWeight: 600 }}>Pay Week:</label>
                <select value={weekStart} onChange={e => setPayWeekStart(new Date(e.target.value + 'T12:00:00'))} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                  {payWeeks.map(w => {
                    const end = new Date(w); end.setDate(end.getDate() + 6)
                    return <option key={toYMD(w)} value={toYMD(w)}>{fmtPayDate(toYMD(w))} – {fmtPayDate(toYMD(end))}</option>
                  })}
                </select>
              </div>
              <button onClick={() => downloadWeeklySummary()} style={{ padding: '0.4rem 1rem', background: '#2d6a38', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Download CSV</button>
              {weekData.length > 0 && (
                <button
                  onClick={async () => {
                    for (const row of weekData) {
                      if (!row.emp) continue
                      const info = postedWeeks[postedKey(row.emp.id, weekStart)]
                      generateWeeklyCompilationPDF({ employeeName: row.emp.name, days: row.days, postedAt: info?.posted_at, postedBy: info?.posted_by })
                      await new Promise(r => setTimeout(r, 300))
                    }
                  }}
                  style={{ padding: '0.4rem 1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                >Print All Weekly PDFs</button>
              )}
              {(() => {
                const postedRows = weekData.filter(row => row.emp && !!postedWeeks[postedKey(row.emp.id, weekStart)])
                return (
                  <button
                    onClick={async () => {
                      if (printingAllPosted || postedRows.length === 0) return
                      setPrintingAllPosted(true)
                      setPrintAllPostedProgress({ done: 0, total: postedRows.length })
                      for (let i = 0; i < postedRows.length; i++) {
                        const row = postedRows[i]
                        const info = postedWeeks[postedKey(row.emp.id, weekStart)]
                        generateWeeklyCompilationPDF({ employeeName: row.emp.name, days: row.days, postedAt: info?.posted_at, postedBy: info?.posted_by })
                        await new Promise(r => setTimeout(r, 300))
                        setPrintAllPostedProgress({ done: i + 1, total: postedRows.length })
                      }
                      setPrintingAllPosted(false)
                    }}
                    disabled={printingAllPosted || postedRows.length === 0}
                    title={postedRows.length === 0 ? 'No weeks posted to Sage yet for this pay week' : undefined}
                    style={{
                      padding: '0.4rem 1rem', borderRadius: '4px', fontWeight: 600,
                      border: 'none', color: '#fff',
                      background: (printingAllPosted || postedRows.length === 0) ? '#9dbfa0' : '#2d6a38',
                      cursor: (printingAllPosted || postedRows.length === 0) ? 'not-allowed' : 'pointer',
                    }}
                  >{printingAllPosted ? `Printing ${printAllPostedProgress?.done ?? 0}/${printAllPostedProgress?.total ?? 0}…` : `Print All Posted to Sage (${postedRows.length})`}</button>
                )
              })()}
            </div>

            {weekData.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px' }}>No entries for this week</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    {['Employee', 'Total Hrs', 'Reg Hrs', 'OT Hrs', 'Per Diem', 'Jobs', 'Supplies', 'Posted to Sage', ''].map(h => (
                      <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.9rem', fontWeight: 600, color: '#555' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekData.map((row, i) => {
                    const postedInfo = row.emp && postedWeeks[postedKey(row.emp.id, weekStart)]
                    const isPosted = !!postedInfo
                    return (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.75rem', fontWeight: 600, ...(row.emp ? linkStyle : {}) }} onClick={() => row.emp && setViewingWeeklyCompilation({ emp: row.emp, days: row.days, weekStart })}>{row.emp?.name || 'Unknown'}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>{fmtHours(row.totalHours)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38' }}>{fmtHours(row.regHours)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: row.otHours > 0 ? '#c0392b' : '#ccc', fontWeight: row.otHours > 0 ? 600 : 400 }}>{fmtHours(row.otHours)}</td>
                      <td style={{ padding: '0.75rem', color: row.perDiem > 0 ? '#8B4513' : '#555', fontSize: '0.9rem' }}>{row.perDiem > 0 ? `×${row.perDiem}` : '—'}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#0066cc' }}>{row.jobNums || '—'}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#555' }}>{row.supplies.length > 0 ? `${row.supplies.length} items` : '—'}</td>
                      <td style={{ padding: '0.75rem' }}>
                        {row.emp && (
                          <span
                            onClick={() => togglePostedWithGuard(row.emp.id, weekStart, isPosted)}
                            title={isPosted
                              ? `Posted to Sage ${new Date(postedInfo.posted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${postedInfo.posted_by ? ' by ' + postedInfo.posted_by : ''} — click to un-post`
                              : 'Click to mark posted to Sage'}
                            style={{
                              cursor: 'pointer', padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600,
                              background: isPosted ? '#e6f4ea' : '#f5f5f5',
                              color: isPosted ? '#2d6a38' : '#888',
                              border: isPosted ? '1px solid #2d6a3844' : '1px solid #ddd',
                            }}
                          >{isPosted ? '✓ Posted to Sage' : 'Not posted'}</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', display: 'flex', gap: '0.4rem' }}>
                        {row.emp && (
                          <>
                            <button
                              onClick={() => setViewingWeeklyCompilation({ emp: row.emp, days: row.days, weekStart })}
                              style={{ padding: '0.3rem 0.7rem', border: '1px solid #ccc', background: '#fff', color: '#555', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                            >View</button>
                            <button
                              onClick={() => generateWeeklyCompilationPDF({ employeeName: row.emp.name, days: row.days, postedAt: postedInfo?.posted_at, postedBy: postedInfo?.posted_by })}
                              style={{ padding: '0.3rem 0.7rem', border: '1px solid #0066cc', background: '#fff', color: '#0066cc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                            >PDF</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            )}
          </div>
        )
      })()}

      {/* ── SMS Review tab ── */}
      {activeTab === 'sms' && <SmsReview onApproved={loadTimesheets} />}
      {activeTab === 'photos' && <GearPhotos />}

      {photoGroup && (() => {
        const groupPhotos = photoGroup.photos
        return (
          <div
            onClick={() => setPhotoGroup(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 700, maxHeight: '80vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>{photoGroup.title} — {groupPhotos.length} photo{groupPhotos.length === 1 ? '' : 's'}</h3>
                <button onClick={() => setPhotoGroup(null)} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#888' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                {groupPhotos.map(p => (
                  <div key={p.id} style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #eee' }}>
                    <div
                      onClick={() => setPhotoLightbox(p)}
                      style={{ aspectRatio: '4 / 3', background: '#f0f0f0', cursor: 'pointer', overflow: 'hidden' }}
                    >
                      <MediaThumb src={gearPhotoUrl(p.storage_path)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: '#888' }}>
                      {jobs.find(j => j.id === p.job_id)?.job_number ? `${jobs.find(j => j.id === p.job_id).job_number} · ` : ''}
                      {employees.find(e => e.id === p.employee_id)?.name || 'Unknown'} · {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', cursor: 'zoom-out' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%' }}>
            <MediaViewer src={gearPhotoUrl(photoLightbox.storage_path)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
          </div>
        </div>
      )}

    </div>
  )
}
