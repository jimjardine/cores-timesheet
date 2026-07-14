import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import SmsReview from './SmsReview'
import GearPhotos from './GearPhotos'
import { generateDailyTimesheetPDF } from '../utils/timesheetPdf'
import { ensureStatPay, cleanupStatPay, isStatHoliday } from '../utils/statPay'
import MultiSelectDropdown from './MultiSelectDropdown'
import { computeOTMap } from '../utils/otCalc'
import { fmtHours } from '../utils/format'
import { generateWeeklyCompilationPDF, fmtShortDate, fmtHeaderDate, dayName, isWeekend } from '../utils/weeklyCompilationPdf'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-timesheet`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer' }
const card = { padding: '1.25rem', background: '#fff', borderRadius: '6px', border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const chip = (color, bg) => ({ display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, color, background: bg })
// Short day+month form (distinct from the component-scoped fmtDate, which includes weekday+year)
const fmtPayDate = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

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
  const [activeTab, setActiveTab] = useState('timesheets')

  // ── Timesheets tab ──
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [filterEmployeeIds, setFilterEmployeeIds] = useState([])
  const [printingAll, setPrintingAll] = useState(false)
  const [printAllProgress, setPrintAllProgress] = useState(null)
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
  const [confirmationWarning, setConfirmationWarning] = useState(null)

  // ── Submission Status tab ──
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
    supabase.schema('Cores').from('job_supplies').select('*, employees(id, name)').order('work_date', { ascending: false }).then(({ data }) => setSupplies(data || []))
    supabase.schema('Cores').from('weekly_summary_posted').select('employee_id, week_start, posted_at').then(({ data }) => setPostedWeeks(Object.fromEntries((data || []).map(r => [`${r.employee_id}|${r.week_start}`, r.posted_at]))))
  }, [])

  // Default the Payroll tab's employee filter to everyone the first time employee
  // data loads — but only once, so it never overrides a user's own selection after.
  useEffect(() => {
    if (payEmployeeIdsDefaulted.current || employees.length === 0) return
    payEmployeeIdsDefaulted.current = true
    setPayEmployeeIds(employees.map(e => e.id))
  }, [employees])

  async function loadTimesheets() {
    setLoadingEntries(true)
    const { data } = await supabase
      .schema('Cores').from('timesheet_entries')
      .select('*, employees(id, name), jobs(id, job_number, description, customers(name), vessels(name))')
      .order('work_date', { ascending: false })
    setEntries(data || [])
    setLoadingEntries(false)
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

    // Fetch existing supplies for this entry
    const { data: existingSupplies } = await supabase
      .schema('Cores').from('job_supplies')
      .select('job_id, supply_name, quantity')
      .eq('employee_id', e.employee_id)
      .eq('work_date', e.work_date)

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

  async function saveEdit() {
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

    // Delete old supplies (tied to whoever/whatever date this entry originally belonged
    // to) and insert updated ones under the current employee/date, in case either changed
    await supabase.schema('Cores').from('job_supplies').delete().eq('employee_id', editEntry.employee_id).eq('work_date', editEntry.work_date)

    const validSupplies = editSupplies.filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
    if (validSupplies.length > 0) {
      const suppliesToInsert = validSupplies.map(s => ({
        job_id: s.job_id,
        employee_id: editFields.employee_id,
        work_date: editFields.work_date,
        supply_name: s.supply_name,
        quantity: Number(s.quantity),
      }))
      const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').insert(suppliesToInsert)
      if (supplyError) {
        alert(`Supplies save failed: ${supplyError.message}`)
        setSavingEdit(false)
        return
      }
    }

    // Save new job if being added
    if (addingNewJob && newJobFields.job_id && newJobFields.hours) {
      // Work on a stat holiday is all OT
      const statDay = await isStatHoliday(editFields.work_date)
      const { error: newJobError } = await supabase.schema('Cores').from('timesheet_entries').insert({
        employee_id: editFields.employee_id,
        work_date: editFields.work_date,
        job_id: newJobFields.job_id,
        hours: Number(newJobFields.hours),
        description: newJobFields.description || '',
        ot_hours: statDay ? Number(newJobFields.hours) : 0,
        per_diem: 0,
        sort_order: 999,
        entry_source: 'manual',
        confirmation_status: 'pending',
      })
      if (newJobError) {
        alert(`Failed to add job: ${newJobError.message}`)
        setSavingEdit(false)
        return
      }
      await requestEntryConfirmation(editFields.employee_id, editFields.work_date)
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
    if (error) alert(`Delete failed: ${error.message}`)
    // If that was the employee's last real entry in the pay week, the auto
    // stat-pay entries for that week are no longer earned — remove them
    else await cleanupStatPay(entry.employee_id, entry.work_date)
    setConfirmDeleteId(null)
    await loadTimesheets()
  }

  async function saveNewJobToTimesheet() {
    if (!newJobFields.job_id || !newJobFields.hours) {
      alert('Pick job and enter hours')
      return
    }

    try {
      // Work on a stat holiday is all OT
      const statDay = await isStatHoliday(editEntry.work_date)
      const { error } = await supabase.schema('Cores').from('timesheet_entries').insert({
        employee_id: editEntry.employee_id,
        work_date: editEntry.work_date,
        job_id: newJobFields.job_id,
        hours: Number(newJobFields.hours),
        description: newJobFields.description || '',
        ot_hours: statDay ? Number(newJobFields.hours) : 0,
        per_diem: 0,
        sort_order: 999,
        entry_source: 'manual',
        confirmation_status: 'pending',
      })

      if (error) {
        alert(`Failed to add job: ${error.message}`)
        return
      }

      await requestEntryConfirmation(editEntry.employee_id, editEntry.work_date)
      await ensureStatPay(editEntry.employee_id, editEntry.work_date)
      await loadTimesheets()
      setAddingNewJob(false)
      setNewJobFields({ job_id: '', hours: '', description: '' })
    } catch (err) {
      alert(`Error: ${err.message}`)
    }
  }

  // Text the employee to confirm a manually-entered timesheet — best-effort,
  // surfaces a dismissible banner on failure rather than blocking with alert()
  async function requestEntryConfirmation(employeeId, workDate) {
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ action: 'request_confirmation', employee_id: employeeId, work_date: workDate }),
      })
      const data = await res.json()
      if (!data.ok) setConfirmationWarning(`Entries saved, but couldn't text the employee to confirm: ${data.error}`)
    } catch (e) {
      setConfirmationWarning(`Entries saved, but the confirmation text failed to send: ${e.message}`)
    }
  }

  async function saveManualEntry() {
    if (!manualFields.employee_id || !manualFields.work_date) {
      alert('Pick employee and date')
      return
    }
    const validEntries = manualFields.entries.filter(e => e.job_id && Number(e.hours) > 0)
    if (validEntries.length === 0) {
      alert('Add at least one job with hours')
      return
    }

    setSavingManual(true)
    try {
      // Fetch payroll config for OT threshold
      const { data: otCfg } = await supabase.schema('Cores').from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single()
      const dailyOTThreshold = otCfg ? Number(otCfg.value) : 8

      // Work on a stat holiday is all OT — the 8 reg hrs come from the auto stat-pay entry
      const statDay = await isStatHoliday(manualFields.work_date)

      // Fetch existing entries for this employee on this date to include in OT calc
      const { data: existingToday } = await supabase.schema('Cores').from('timesheet_entries').select('hours').eq('employee_id', manualFields.employee_id).eq('work_date', manualFields.work_date).eq('is_stat_pay', false)
      let alreadyWorked = (existingToday || []).reduce((s, e) => s + Number(e.hours), 0)

      // Insert entries with OT split
      const toInsert = validEntries.map((e, i) => {
        const hours = Number(e.hours)
        const reg = statDay ? 0 : Math.min(hours, Math.max(0, dailyOTThreshold - alreadyWorked))
        const ot = hours - reg
        alreadyWorked += hours
        return {
          employee_id: manualFields.employee_id,
          work_date: manualFields.work_date,
          job_id: e.job_id,
          hours: hours,
          ot_hours: ot,
          description: e.description || '',
          per_diem: manualFields.per_diem,
          sort_order: manualFields.sort_order + i,
          time_in: manualFields.time_in || null,
          stated_time_out: manualFields.stated_time_out || null,
          lunch_minutes: manualFields.lunch_minutes || null,
          // Nicki typed this in herself — the employee hasn't confirmed it yet
          entry_source: 'manual',
          confirmation_status: 'pending',
        }
      })

      const { error } = await supabase.schema('Cores').from('timesheet_entries').insert(toInsert)
      if (error) {
        alert(`Save failed: ${error.message}`)
        return
      }

      await requestEntryConfirmation(manualFields.employee_id, manualFields.work_date)

      // Insert supplies if any
      const validSupplies = manualFields.supplies.filter(s => s.supply_name && s.job_id && Number(s.quantity) > 0)
      if (validSupplies.length > 0) {
        const suppliesToInsert = validSupplies.map(s => ({
          job_id: s.job_id,
          employee_id: manualFields.employee_id,
          work_date: manualFields.work_date,
          supply_name: s.supply_name,
          quantity: Number(s.quantity),
        }))
        const { error: supplyError } = await supabase.schema('Cores').from('job_supplies').insert(suppliesToInsert)
        if (supplyError) {
          alert(`Supplies save failed: ${supplyError.message}`)
          return
        }
      }

      await ensureStatPay(manualFields.employee_id, manualFields.work_date)
      await loadTimesheets()
      setManualEntry(null)
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
      if (error) { alert('Error updating posted status: ' + error.message); return }
      setPostedWeeks(p => { const n = { ...p }; delete n[key]; return n })
    } else {
      const { data, error } = await supabase.schema('Cores').from('weekly_summary_posted')
        .insert({ employee_id: empId, week_start: weekStart }).select().single()
      if (error) { alert('Error updating posted status: ' + error.message); return }
      setPostedWeeks(p => ({ ...p, [key]: data.posted_at }))
    }
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
  ).sort((a, b) => b.date.localeCompare(a.date) || (a.employee?.name || '').localeCompare(b.employee?.name || ''))

  const totalReg = timesheetRows.reduce((s, r) => s + r.reg, 0)
  const totalOT  = timesheetRows.reduce((s, r) => s + r.ot, 0)
  const totalPD  = timesheetRows.reduce((s, r) => s + r.pd, 0)

  function computeEntryOT(empEntries) {
    return computeOTMap(empEntries, {
      dailyThreshold:  payrollConfig.daily_ot_threshold  ?? 8,
      weeklyThreshold: payrollConfig.weekly_ot_threshold ?? 40,
      statHolidays,
    })
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
        .select('time_in, stated_time_out, calculated_time_out, lunch_minutes')
        .eq('employee_id', emp.id)
        .eq('work_date', workDate)
        .neq('status', 'rejected')
        .order('updated_at', { ascending: false })
        .limit(1),
      supabase
        .schema('Cores').from('job_supplies')
        .select('supply_name, quantity, jobs(job_number)')
        .eq('employee_id', emp.id)
        .eq('work_date', workDate),
    ])
    const submission = subRows?.[0] || null
    // Prefer the times saved on the timesheet entries themselves (works for both
    // manual and SMS-originated entries) — sms_submissions only exists for SMS entries.
    const entryWithTime = dayEntries.find(e => e.time_in || e.stated_time_out)

    generateDailyTimesheetPDF({
      employeeName: emp.name,
      workDate: workDate,
      timeIn: entryWithTime?.time_in || submission?.time_in || null,
      timeOut: entryWithTime?.stated_time_out || submission?.stated_time_out || submission?.calculated_time_out || null,
      lunchMinutes: entryWithTime?.lunch_minutes ?? submission?.lunch_minutes ?? null,
      totalHours,
      jobLines: dayEntries.map(e => ({
        jobNumber: e.jobs?.job_number || '',
        hours: e.hours,
        description: e.description || '',
      })),
      supplyLines: (daySupplies || []).map(s => ({
        jobNumber: s.jobs?.job_number || '',
        quantity: s.quantity,
        supplyName: s.supply_name,
      })),
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
    const isPosted = !!postedWeeks[postedKey(emp.id, weekStart)]
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
          <button onClick={() => generateWeeklyCompilationPDF({ employeeName: emp.name, days, posted: isPosted })} style={{ padding: '0.4rem 1rem', border: '1px solid #0066cc', background: '#fff', color: '#0066cc', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
            Download PDF
          </button>
          <button
            onClick={() => togglePosted(emp.id, weekStart)}
            style={{
              marginLeft: 'auto', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600,
              border: isPosted ? '1px solid #2d6a38' : '1px solid #ccc',
              background: isPosted ? '#e6f4ea' : '#fff',
              color: isPosted ? '#2d6a38' : '#555',
            }}
          >
            {isPosted ? `✓ Posted — ${new Date(postedWeeks[postedKey(emp.id, weekStart)]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Mark as Posted'}
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
                    <td style={{ ...tdStyleWc, textAlign: 'right', color: weekend ? '#ccc' : '#2d6a38' }}>
                      {weekend ? '—' : (d.regHours ? fmtHours(d.regHours) : '')}
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

      {/* ── Edit modal ── */}
      {editEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '1.75rem', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 1.25rem' }}>Edit Entry</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Employee</label>
                <select style={inputStyle} value={editFields.employee_id || ''} onChange={e => setEditFields(f => ({ ...f, employee_id: e.target.value }))}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
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
                  <option value={1}>×1 Standard</option>
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
                  <input type="text" placeholder="supply" style={inputStyle} value={supply.supply_name || ''} onChange={e => {
                    const newSupplies = [...editSupplies]
                    newSupplies[i] = { ...supply, supply_name: e.target.value }
                    setEditSupplies(newSupplies)
                  }} />
                  <input type="number" step="0.5" min="0" placeholder="qty" style={inputStyle} value={supply.quantity || ''} onChange={e => {
                    const newSupplies = [...editSupplies]
                    newSupplies[i] = { ...supply, quantity: e.target.value }
                    setEditSupplies(newSupplies)
                  }} />
                  <button onClick={() => setEditSupplies(editSupplies.filter((_, idx) => idx !== i))} style={{ padding: '0.4rem 0.6rem', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', cursor: 'pointer', color: '#c0392b', fontWeight: 600, fontSize: '0.85rem' }}>✕</button>
                </div>
              ))}
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
                <input type="number" step="0.5" min="0" placeholder="hours" style={{ ...inputStyle, marginTop: '0.5rem' }} value={newJobFields.hours} onChange={e => setNewJobFields(f => ({ ...f, hours: e.target.value }))} />
                <textarea placeholder="description" style={{ ...inputStyle, marginTop: '0.5rem', minHeight: '60px' }} value={newJobFields.description} onChange={e => setNewJobFields(f => ({ ...f, description: e.target.value }))} />
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
                <select style={inputStyle} value={manualFields.employee_id || ''} onChange={e => setManualFields(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem', fontWeight: 600 }}>Date</label>
                <input type="date" style={inputStyle} value={manualFields.work_date} onChange={e => setManualFields(f => ({ ...f, work_date: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time In</label>
                <input type="time" style={inputStyle} value={manualFields.time_in} onChange={e => setManualFields(f => ({ ...f, time_in: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Time Out</label>
                <input type="time" style={inputStyle} value={manualFields.stated_time_out} onChange={e => setManualFields(f => ({ ...f, stated_time_out: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Lunch (min)</label>
                <input type="number" min="0" style={inputStyle} value={manualFields.lunch_minutes} onChange={e => setManualFields(f => ({ ...f, lunch_minutes: Number(e.target.value) }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Per Diem</label>
                <select style={inputStyle} value={manualFields.per_diem || 0} onChange={e => setManualFields(f => ({ ...f, per_diem: Number(e.target.value) }))}>
                  <option value={0}>None</option>
                  <option value={1}>×1 Standard</option>
                  <option value={2}>×2 Double</option>
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
                  <input type="number" step="0.5" min="0" placeholder="hrs" style={inputStyle} value={entry.hours || ''} onChange={e => {
                    const newEntries = [...manualFields.entries]
                    newEntries[i] = { ...entry, hours: e.target.value }
                    setManualFields(f => ({ ...f, entries: newEntries }))
                  }} />
                  <input type="text" placeholder="description" style={inputStyle} value={entry.description || ''} onChange={e => {
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
                  <input type="text" placeholder="supply" style={inputStyle} value={supply.supply_name || ''} onChange={e => {
                    const newSupplies = [...manualFields.supplies]
                    newSupplies[i] = { ...supply, supply_name: e.target.value }
                    setManualFields(f => ({ ...f, supplies: newSupplies }))
                  }} />
                  <input type="number" step="0.5" min="0" placeholder="qty" style={inputStyle} value={supply.quantity || ''} onChange={e => {
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
              <button onClick={() => setManualEntry(null)} style={{ padding: '0.5rem 1.1rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer' }}>Cancel</button>
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
          {confirmationWarning && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', padding: '0.65rem 1rem', background: '#fdf0d5', border: '1px solid #f0d090', borderRadius: '6px', color: '#8a6100', fontSize: '0.9rem' }}>
              <span>{confirmationWarning}</span>
              <button onClick={() => setConfirmationWarning(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#8a6100', fontSize: '1.1rem', lineHeight: 1, padding: 0 }}>×</button>
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
                          {[['Date','left'],['Job','left'],['Customer','left'],['Vessel','left'],['Reg','center'],['OT','center'],['PD','center'],['Description','left'],['','left']].map(([h, align]) => (
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
                              <td style={{ padding: '0.75rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                {isConfirmingDelete ? (
                                  <span>
                                    <span style={{ fontSize: '0.85rem', color: '#c0392b', marginRight: '0.5rem' }}>Delete?</span>
                                    <button onClick={() => deleteEntry(e)} style={{ marginRight: '0.4rem', padding: '0.2rem 0.6rem', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8rem' }}>Yes</button>
                                    <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '0.2rem 0.6rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}>No</button>
                                  </span>
                                ) : (
                                  <span>
                                    <button onClick={() => openEdit(e, reg, ot)} style={{ marginRight: '0.4rem', padding: '0.2rem 0.6rem', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.8rem', color: '#555' }}>Edit</button>
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
                        { label: 'Employee', align: 'left' },
                        { label: 'Date', align: 'left' },
                        { label: 'Jobs', align: 'center' },
                        { label: 'Reg', align: 'center' },
                        { label: 'OT', align: 'center' },
                        { label: 'PD', align: 'center' },
                        { label: '', align: 'right' },
                      ].map((h, i) => (
                        <th key={i} style={{ padding: '0.75rem', textAlign: h.align, fontWeight: 600, color: '#555' }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timesheetRows.map(row => (
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
                        <td style={{ padding: '0.75rem', color: '#aaa', fontSize: '0.85rem', textAlign: 'right' }}>view →</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #ddd', background: '#fafafa', fontWeight: 700 }}>
                      <td style={{ padding: '0.75rem', color: '#333' }}>Total</td>
                      <td colSpan={2} />
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38' }}>{fmtHours(totalReg)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: totalOT > 0 ? '#c0392b' : '#ccc' }}>{fmtHours(totalOT)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: totalPD > 0 ? '#7a5c00' : '#ccc' }}>{totalPD > 0 ? totalPD : '—'}</td>
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

        const rows = employees.map(emp => {
          const ee = entries.filter(e => e.employee_id === emp.id && weekDates.has(e.work_date))
          const submitted = ee.length > 0
          const otMap = submitted ? (() => {
            const empAll = entries.filter(e => e.employee_id === emp.id)
            return computeEntryOT(empAll)
          })() : {}
          return {
            emp, submitted,
            days:  new Set(ee.map(e => e.work_date)).size,
            hours: ee.reduce((s, e) => s + Number(e.hours), 0),
            reg:   ee.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0),
            ot:    ee.reduce((s, e) => s + (otMap[e.id]?.ot  || 0), 0),
            pd:    ee.reduce((s, e) => s + Number(e.per_diem || 0), 0),
          }
        }).sort((a, b) => b.submitted - a.submitted || a.emp.name.localeCompare(b.emp.name))

        const missing = rows.filter(r => !r.submitted)
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
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <span style={{ color: '#2d6a38', fontWeight: 600 }}>{rows.filter(r => r.submitted).length} submitted</span>
                <span style={{ color: '#aaa' }}>·</span>
                <span style={{ color: missing.length > 0 ? '#c0392b' : '#aaa', fontWeight: missing.length > 0 ? 700 : 400 }}>{missing.length} missing</span>
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
                  {['Employee', 'Status', 'Days', 'Total Hrs', 'Reg', 'OT', 'PD'].map((h, i) => (
                    <th key={i} style={{ padding: '0.75rem', textAlign: i > 1 ? 'center' : 'left', fontWeight: 600, color: '#555' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, submitted, days, hours, reg, ot, pd }) => (
                  <tr key={emp.id}
                    style={{ borderBottom: '1px solid #eee', background: submitted ? '' : '#fff9f9', cursor: submitted ? 'pointer' : 'default' }}
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
                    <td style={{ padding: '0.75rem' }}>
                      {submitted
                        ? <span style={{ padding: '0.2rem 0.7rem', borderRadius: '12px', background: '#e6f4ea', color: '#2d6a38', fontWeight: 700, fontSize: '0.85rem' }}>✓ Submitted</span>
                        : <span style={{ padding: '0.2rem 0.7rem', borderRadius: '12px', background: '#fde8e8', color: '#c0392b', fontWeight: 700, fontSize: '0.85rem' }}>✗ Missing</span>}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: '#555' }}>{submitted ? days : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: submitted ? 600 : 400, color: submitted ? '#333' : '#ccc' }}>{submitted ? fmtHours(hours) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: submitted ? '#2d6a38' : '#ccc' }}>{submitted ? fmtHours(reg) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: ot > 0 ? '#c0392b' : '#ccc' }}>{submitted ? fmtHours(ot) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: pd > 0 ? '#7a5c00' : '#ccc' }}>{submitted ? (pd > 0 ? pd : '—') : '—'}</td>
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
                      generateWeeklyCompilationPDF({ employeeName: row.emp.name, days: row.days, posted: !!postedWeeks[postedKey(row.emp.id, weekStart)] })
                      await new Promise(r => setTimeout(r, 300))
                    }
                  }}
                  style={{ padding: '0.4rem 1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                >Print All Weekly PDFs</button>
              )}
            </div>

            {weekData.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px' }}>No entries for this week</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    {['Employee', 'Total Hrs', 'Reg Hrs', 'OT Hrs', 'Per Diem', 'Jobs', 'Supplies', 'Posted', ''].map(h => (
                      <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.9rem', fontWeight: 600, color: '#555' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekData.map((row, i) => {
                    const isPosted = row.emp && !!postedWeeks[postedKey(row.emp.id, weekStart)]
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
                        {isPosted && (
                          <span style={{ padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600, background: '#e6f4ea', color: '#2d6a38', border: '1px solid #2d6a3844' }}>✓ Posted</span>
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
                              onClick={() => generateWeeklyCompilationPDF({ employeeName: row.emp.name, days: row.days, posted: isPosted })}
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
      {activeTab === 'sms' && <SmsReview />}
      {activeTab === 'photos' && <GearPhotos />}

    </div>
  )
}
