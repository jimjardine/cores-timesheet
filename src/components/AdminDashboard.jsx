import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import SmsReview from './SmsReview'
import { generateDailyTimesheetPDF } from '../utils/timesheetPdf'


const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer' }

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('timesheets')

  // ── Timesheets tab ──
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [datePreset, setDatePreset] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [payrollConfig, setPayrollConfig] = useState({})
  const [jobs, setJobs] = useState([])

  // ── Edit / delete ──
  const [editEntry, setEditEntry] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [exportSummaries, setExportSummaries] = useState(true)

  // ── Manual entry ──
  const [manualEntry, setManualEntry] = useState(null)
  const [manualFields, setManualFields] = useState({
    employee_id: '', work_date: new Date().toISOString().split('T')[0],
    time_in: '07:00', stated_time_out: '15:30', lunch_minutes: 30,
    entries: [{ job_id: '', hours: '', description: '' }],
    per_diem: 0, sort_order: 1
  })
  const [savingManual, setSavingManual] = useState(false)

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
    supabase.from('employees').select('*').order('name').then(({ data }) => setEmployees(data || []))
    supabase.from('payroll_config').select('key, value').then(({ data }) => setPayrollConfig(Object.fromEntries((data || []).map(r => [r.key, Number(r.value)]))))
    supabase.from('jobs').select('*, vessels(name)').order('job_number').then(({ data }) => setJobs(data || []))
  }, [])

  async function loadTimesheets() {
    setLoadingEntries(true)
    const { data } = await supabase
      .from('timesheet_entries')
      .select('*, employees(id, name), jobs(id, job_number, description, customers(name), vessels(name))')
      .order('work_date', { ascending: false })
    setEntries(data || [])
    setLoadingEntries(false)
  }

  function openEdit(e, computedReg, computedOT) {
    setEditEntry(e)
    setEditFields({
      work_date:   e.work_date,
      job_id:      e.job_id,
      reg_hours:   (computedReg ?? Number(e.hours) - Number(e.ot_hours ?? 0)).toFixed(1),
      ot_hours:    (computedOT  ?? Number(e.ot_hours ?? 0)).toFixed(1),
      description: e.description || '',
      per_diem:    e.per_diem ?? 0,
      sort_order:  e.sort_order ?? 1,
    })
  }

  async function saveEdit() {
    setSavingEdit(true)
    const reg = Number(editFields.reg_hours) || 0
    const ot  = Number(editFields.ot_hours)  || 0
    const { error } = await supabase.from('timesheet_entries').update({
      work_date:   editFields.work_date,
      job_id:      editFields.job_id,
      hours:       reg + ot,
      ot_hours:    ot,
      description: editFields.description,
      per_diem:    Number(editFields.per_diem),
      sort_order:  Number(editFields.sort_order),
    }).eq('id', editEntry.id)
    if (error) {
      alert(`Save failed: ${error.message}`)
      setSavingEdit(false)
      return
    }
    await loadTimesheets()
    setEditEntry(null)
    setSavingEdit(false)
  }

  async function deleteEntry(id) {
    const { error } = await supabase.from('timesheet_entries').delete().eq('id', id)
    if (error) alert(`Delete failed: ${error.message}`)
    setConfirmDeleteId(null)
    await loadTimesheets()
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
      const { data: otCfg } = await supabase.from('payroll_config').select('value').eq('key', 'daily_ot_threshold').single()
      const dailyOTThreshold = otCfg ? Number(otCfg.value) : 8

      // Fetch existing entries for this employee on this date to include in OT calc
      const { data: existingToday } = await supabase.from('timesheet_entries').select('hours').eq('employee_id', manualFields.employee_id).eq('work_date', manualFields.work_date)
      let alreadyWorked = (existingToday || []).reduce((s, e) => s + Number(e.hours), 0)

      // Insert entries with OT split
      const toInsert = validEntries.map((e, i) => {
        const hours = Number(e.hours)
        const reg = Math.min(hours, Math.max(0, dailyOTThreshold - alreadyWorked))
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
        }
      })

      const { error } = await supabase.from('timesheet_entries').insert(toInsert)
      if (error) {
        alert(`Save failed: ${error.message}`)
        return
      }
      await loadTimesheets()
      setManualEntry(null)
      setManualFields({
        employee_id: '', work_date: new Date().toISOString().split('T')[0],
        time_in: '07:00', stated_time_out: '15:30', lunch_minutes: 30,
        entries: [{ job_id: '', hours: '', description: '' }],
        per_diem: 0, sort_order: 1
      })
    } finally {
      setSavingManual(false)
    }
  }

  // ── Date helpers ──
  function toYMD(d) { return d.toISOString().split('T')[0] }
  function getPayWeekStart(date) {
    const d = new Date(date)
    d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7))
    d.setHours(0, 0, 0, 0)
    return d
  }
  function applyPreset(preset) {
    setDatePreset(preset)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = toYMD(today)
    if (preset === 'all')        { setDateFrom(''); setDateTo(''); return }
    if (preset === 'this-week')  { const s = getPayWeekStart(today); const e = new Date(s); e.setDate(e.getDate() + 6); setDateFrom(toYMD(s)); setDateTo(toYMD(e) > todayStr ? todayStr : toYMD(e)); return }
    if (preset === 'last-week')  { const s = getPayWeekStart(today); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return }
    if (preset === 'this-month') { setDateFrom(toYMD(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(todayStr); return }
    if (preset === 'last-30')    { const s = new Date(today); s.setDate(s.getDate() - 30); setDateFrom(toYMD(s)); setDateTo(todayStr); return }
  }

  // ── Filtering & grouping ──
  const filteredEntries = entries.filter(e => {
    if (dateFrom && e.work_date < dateFrom) return false
    if (dateTo   && e.work_date > dateTo)   return false
    if (filterEmployee && e.employees?.name !== filterEmployee) return false
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
    const dailyThreshold  = payrollConfig.daily_ot_threshold  ?? 8
    const weeklyThreshold = payrollConfig.weekly_ot_threshold ?? 40
    const byPayWeek = empEntries.reduce((acc, e) => {
      const ws = toYMD(getPayWeekStart(new Date(e.work_date + 'T12:00:00')))
      if (!acc[ws]) acc[ws] = []
      acc[ws].push(e)
      return acc
    }, {})
    const map = {}
    Object.values(byPayWeek).forEach(weekEnts => {
      const inOrder = [...weekEnts].sort((a, b) =>
        a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1)
      )
      let weeklyRegSoFar = 0, dayHoursSoFar = 0, currentDate = null
      inOrder.forEach(e => {
        if (e.work_date !== currentDate) { dayHoursSoFar = 0; currentDate = e.work_date }
        const hrs = Number(e.hours)
        if (e.ot_hours !== null && e.ot_hours !== undefined) {
          const ot = Number(e.ot_hours), reg = hrs - ot
          map[e.id] = { reg, ot, manual: true }
          dayHoursSoFar += hrs; weeklyRegSoFar += reg
        } else {
          const dailyRegRemaining  = Math.max(0, dailyThreshold - dayHoursSoFar)
          const dailyReg           = Math.min(hrs, dailyRegRemaining)
          const weeklyRegRemaining = Math.max(0, weeklyThreshold - weeklyRegSoFar)
          const actualReg          = Math.min(dailyReg, weeklyRegRemaining)
          map[e.id]                = { reg: actualReg, ot: (hrs - dailyReg) + (dailyReg - actualReg) }
          dayHoursSoFar           += hrs; weeklyRegSoFar += actualReg
        }
      })
    })
    return map
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
              Number(e.hours).toFixed(1), reg.toFixed(1), ot.toFixed(1), pd, e.description || '', '', '', '']))
          })
          if (exportSummaries) rows.push(csvRow(['Job Summary', name, weekLabel, jobNum, customer, '', '', '', '', '', jobReg.toFixed(1), jobOT.toFixed(1), jobPD]))
          weekReg += jobReg; weekOT += jobOT; weekPD += jobPD
        })

        if (exportSummaries) rows.push(csvRow(['Period Total', name, weekLabel, '', '', '', '', '', '', '', weekReg.toFixed(1), weekOT.toFixed(1), weekPD]))
        empReg += weekReg; empOT += weekOT; empPD += weekPD
      })

      rows.push('')
      grandReg += empReg; grandOT += empOT; grandPD += empPD
    })

    if (exportSummaries) {
      Object.values(jobTotals)
        .sort((a, b) => a.jobNum.localeCompare(b.jobNum))
        .forEach(({ jobNum, customer, reg, ot, pd }) => {
          rows.push(csvRow(['Job Total', '', '', jobNum, customer, '', '', '', '', '', reg.toFixed(1), ot.toFixed(1), pd]))
        })
      rows.push('')
      rows.push(csvRow(['Grand Total', '', '', '', '', '', '', '', '', '', grandReg.toFixed(1), grandOT.toFixed(1), grandPD]))
    }
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))
    link.download = selectedDate ? `timesheets-${selectedDate}.csv` : 'timesheets.csv'
    link.click()
  }

  async function handlePrintTimesheet() {
    if (!selectedEmp || !selectedDate) return
    const dayEntries = entries.filter(e => e.employee_id === selectedEmp.id && e.work_date === selectedDate)
      .sort((a, b) => (a.sort_order ?? 1) - (b.sort_order ?? 1))
    const totalHours = dayEntries.reduce((s, e) => s + Number(e.hours), 0)

    // Most recent non-rejected submission — maybeSingle() errors if the employee
    // has more than one row for the date (e.g. a rejected attempt plus the real one)
    const { data: subRows } = await supabase
      .from('sms_submissions')
      .select('time_in, stated_time_out, calculated_time_out, lunch_minutes')
      .eq('employee_id', selectedEmp.id)
      .eq('work_date', selectedDate)
      .neq('status', 'rejected')
      .order('updated_at', { ascending: false })
      .limit(1)
    const submission = subRows?.[0] || null

    generateDailyTimesheetPDF({
      employeeName: selectedEmp.name,
      workDate: selectedDate,
      timeIn: submission?.time_in || null,
      timeOut: submission?.stated_time_out || submission?.calculated_time_out || null,
      lunchMinutes: submission?.lunch_minutes ?? null,
      totalHours,
      jobLines: dayEntries.map(e => ({
        jobNumber: e.jobs?.job_number || '',
        hours: e.hours,
        description: e.description || '',
      })),
    })
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

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>

      {/* ── Edit modal ── */}
      {editEntry && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '1.75rem', width: '480px', maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 1.25rem' }}>Edit Entry</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
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
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem' }}>Sort Order</label>
                <input type="number" min="1" style={inputStyle} {...ef('sort_order')} />
              </div>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
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
        <button style={tabStyle('timesheets')} onClick={() => { setActiveTab('timesheets'); setSelectedEmp(null); setSelectedDate(null); setFilterEmployee('') }}>Timesheets</button>
        <button style={tabStyle('submission')} onClick={() => setActiveTab('submission')}>Submission Status</button>
        <button style={tabStyle('sms')} onClick={() => setActiveTab('sms')}>SMS Review</button>
      </div>

      {/* ── Timesheets tab ── */}
      {activeTab === 'timesheets' && (
        <>
          {/* Filters — always visible */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <select value={filterEmployee} onChange={e => {
                setFilterEmployee(e.target.value)
                setSelectedEmp(null)
                setSelectedDate(null)
              }} style={{ padding: '0.45rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.95rem', minWidth: '200px' }}>
                <option value="">All employees</option>
                {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {[['all','All time'],['this-week','This pay week'],['last-week','Last pay week'],['this-month','This month'],['last-30','Last 30 days'],['custom','Custom']].map(([key, label]) => (
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
                    ← {filterEmployee || 'All employees'}
                  </button>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedEmp.name}</span>
                  <span style={{ color: '#555', fontSize: '0.95rem' }}>{selectedDate ? fmtDate(selectedDate) : 'All dates'}</span>
                  <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{empTotal.toFixed(1)} hrs</span>
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
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38', fontWeight: 600 }}>{reg.toFixed(1)}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: ot > 0 ? '#c0392b' : '#ddd', fontWeight: ot > 0 ? 600 : 400 }}>{ot > 0 ? ot.toFixed(1) : '—'}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'center', color: perDiem > 0 ? '#8B4513' : '#ddd' }}>{perDiem > 0 ? `×${perDiem}` : '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#555' }}>{e.description ?? '—'}</td>
                              <td style={{ padding: '0.75rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                {isConfirmingDelete ? (
                                  <span>
                                    <span style={{ fontSize: '0.85rem', color: '#c0392b', marginRight: '0.5rem' }}>Delete?</span>
                                    <button onClick={() => deleteEntry(e.id)} style={{ marginRight: '0.4rem', padding: '0.2rem 0.6rem', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8rem' }}>Yes</button>
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
                  <span style={{ color: '#2d6a38' }}>{totalReg.toFixed(1)} reg</span>
                  {totalOT > 0 && <><span style={{ color: '#aaa', margin: '0 0.4rem' }}>·</span><span style={{ color: '#c0392b' }}>{totalOT.toFixed(1)} OT</span></>}
                  {totalPD > 0 && <><span style={{ color: '#aaa', margin: '0 0.4rem' }}>·</span><span style={{ color: '#7a5c00' }}>{totalPD} PD</span></>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#555', cursor: 'pointer' }}>
                    <input type="checkbox" checked={exportSummaries} onChange={e => setExportSummaries(e.target.checked)} />
                    Include summaries
                  </label>
                  <button onClick={() => setManualEntry(true)} style={{ padding: '0.45rem 1rem', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>+ Add Manual Entry</button>
                  <button onClick={handleExport} style={{ padding: '0.45rem 1rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>Export CSV</button>
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
                          setFilterEmployee(row.employee?.name || '')
                          setSelectedEmp(row.employee)
                          setSelectedDate(row.date)
                        }}
                        onMouseEnter={e => hoverRow(e, true)}
                        onMouseLeave={e => hoverRow(e, false)}>
                        <td style={{ padding: '0.75rem', ...linkStyle }}>{row.employee?.name}</td>
                        <td style={{ padding: '0.75rem', color: '#555' }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', color: '#888' }}>{row.jobIds.size}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#2d6a38' }}>{row.reg.toFixed(1)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: row.ot > 0 ? 600 : 400, color: row.ot > 0 ? '#c0392b' : '#ccc' }}>{row.ot.toFixed(1)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', color: row.pd > 0 ? '#7a5c00' : '#ccc' }}>{row.pd > 0 ? row.pd : '—'}</td>
                        <td style={{ padding: '0.75rem', color: '#aaa', fontSize: '0.85rem', textAlign: 'right' }}>view →</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #ddd', background: '#fafafa', fontWeight: 700 }}>
                      <td style={{ padding: '0.75rem', color: '#333' }}>Total</td>
                      <td colSpan={2} />
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38' }}>{totalReg.toFixed(1)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: totalOT > 0 ? '#c0392b' : '#ccc' }}>{totalOT.toFixed(1)}</td>
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
        }).sort((a, b) => a.submitted - b.submitted || a.emp.name.localeCompare(b.emp.name))

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
                      setFilterEmployee(emp.name)
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
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: submitted ? 600 : 400, color: submitted ? '#333' : '#ccc' }}>{submitted ? hours.toFixed(1) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: submitted ? '#2d6a38' : '#ccc' }}>{submitted ? reg.toFixed(1) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: ot > 0 ? '#c0392b' : '#ccc' }}>{submitted ? ot.toFixed(1) : '—'}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', color: pd > 0 ? '#7a5c00' : '#ccc' }}>{submitted ? (pd > 0 ? pd : '—') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })()}

      {/* ── SMS Review tab ── */}
      {activeTab === 'sms' && <SmsReview />}

    </div>
  )
}
