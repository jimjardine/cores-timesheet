import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-timesheet`

const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer' }

export default function AdminDashboard({ defaultTab = 'timesheets' }) {
  const [activeTab, setActiveTab] = useState(defaultTab)

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

  // ── Email Parser tab ──
  const [inputText, setInputText] = useState('')
  const [senderName, setSenderName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseResult, setParseResult] = useState(null)
  const [emailRecords, setEmailRecords] = useState([])
  const [loadingRecords, setLoadingRecords] = useState(false)

  useEffect(() => {
    loadTimesheets()
    supabase.from('employees').select('id, name').order('name').then(({ data }) => setEmployees(data || []))
    supabase.from('payroll_config').select('key, value').then(({ data }) => setPayrollConfig(Object.fromEntries((data || []).map(r => [r.key, Number(r.value)]))))
    supabase.from('jobs').select('id, job_number, customers(name)').order('job_number').then(({ data }) => setJobs(data || []))
  }, [])

  useEffect(() => {
    if (activeTab === 'email') fetchEmailRecords()
  }, [activeTab])

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
    await supabase.from('timesheet_entries').update({
      work_date:   editFields.work_date,
      job_id:      editFields.job_id,
      hours:       reg + ot,
      ot_hours:    ot,
      description: editFields.description,
      per_diem:    Number(editFields.per_diem),
      sort_order:  Number(editFields.sort_order),
    }).eq('id', editEntry.id)
    await loadTimesheets()
    setEditEntry(null)
    setSavingEdit(false)
  }

  async function deleteEntry(id) {
    await supabase.from('timesheet_entries').delete().eq('id', id)
    setConfirmDeleteId(null)
    await loadTimesheets()
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

  // ── Email parser helpers ──
  async function fetchEmailRecords() {
    setLoadingRecords(true)
    const { data } = await supabase.from('email_timesheets').select('*').order('created_at', { ascending: false }).limit(50)
    setEmailRecords(data || [])
    setLoadingRecords(false)
  }

  async function handleParse() {
    if (!inputText.trim()) return
    setParsing(true)
    setParseResult(null)
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText.trim(), sender_name: senderName.trim() || null }),
      })
      const json = await res.json()
      setParseResult(json)
      if (json.success) { setInputText(''); setSenderName(''); fetchEmailRecords() }
    } catch (err) {
      setParseResult({ error: err.message })
    }
    setParsing(false)
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
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number}{j.customers?.name ? ` — ${j.customers.name}` : ''}</option>)}
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

      <h1>Admin Dashboard</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        <button style={tabStyle('timesheets')} onClick={() => { setActiveTab('timesheets'); setSelectedEmp(null); setSelectedDate(null); setFilterEmployee('') }}>Timesheets</button>
        <button style={tabStyle('email')} onClick={() => setActiveTab('email')}>Email Parser</button>
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
                    padding: '0.35rem 0.85rem', fontSize: '0.85rem', border: '1px solid',
                    borderColor: datePreset === key ? '#0066cc' : '#ddd', borderRadius: '20px', cursor: 'pointer',
                    background: datePreset === key ? '#e6f0ff' : '#fff',
                    color: datePreset === key ? '#0066cc' : '#555',
                    fontWeight: datePreset === key ? 600 : 400,
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
                  </div>
                </div>

                {empEntries.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No entries for this period.</div>
                ) : (() => {
                  const dailyThreshold  = payrollConfig.daily_ot_threshold  ?? 8
                  const weeklyThreshold = payrollConfig.weekly_ot_threshold ?? 40

                  // Entry-level OT attribution — walk entries in date+sort_order, assign reg/OT per entry
                  const byPayWeek = empEntries.reduce((acc, e) => {
                    const weekStart = toYMD(getPayWeekStart(new Date(e.work_date + 'T12:00:00')))
                    if (!acc[weekStart]) acc[weekStart] = []
                    acc[weekStart].push(e)
                    return acc
                  }, {})
                  const entryOtMap = {} // id → { reg, ot }
                  Object.values(byPayWeek).forEach(weekEnts => {
                    const inOrder = [...weekEnts].sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1))
                    let weeklyRegSoFar = 0, dayHoursSoFar = 0, currentDate = null
                    inOrder.forEach(e => {
                      if (e.work_date !== currentDate) { dayHoursSoFar = 0; currentDate = e.work_date }
                      const hrs = Number(e.hours)
                      const dailyRegRemaining  = Math.max(0, dailyThreshold - dayHoursSoFar)
                      const dailyReg           = Math.min(hrs, dailyRegRemaining)
                      const dailyOT            = hrs - dailyReg
                      const weeklyRegRemaining = Math.max(0, weeklyThreshold - weeklyRegSoFar)
                      const actualReg          = Math.min(dailyReg, weeklyRegRemaining)
                      const weeklyOT           = dailyReg - actualReg
                      entryOtMap[e.id]         = { reg: actualReg, ot: dailyOT + weeklyOT }
                      dayHoursSoFar           += hrs
                      weeklyRegSoFar          += actualReg
                    })
                  })

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

      {/* ── Email Parser tab ── */}
      {activeTab === 'email' && (
        <>
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#f0f4ff', borderRadius: '4px', border: '1px solid #c8d8f0' }}>
            <h3 style={{ marginTop: 0 }}>Parse Timesheet Text</h3>
            <p style={{ color: '#555', marginBottom: '1rem' }}>
              Paste an email or text message below. The AI will extract the worker, date, job, hours, and description — regardless of the order or wording.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label><strong>Sender name</strong> <span style={{ color: '#888', fontWeight: 'normal' }}>(optional — if not in the message)</span></label>
              <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="e.g. Cole Davis"
                style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.4rem', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label><strong>Email / message text</strong></label>
              <textarea value={inputText} onChange={e => setInputText(e.target.value)} rows={6}
                placeholder={'e.g. "Hey Jim, Cole here. Worked MV Trident today. 8 hours. Welded the forward bulkhead and painted hull section B."'}
                style={{ display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.4rem', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '0.95rem' }} />
            </div>

            <button onClick={handleParse} disabled={parsing || !inputText.trim()}
              style={{ padding: '0.6rem 1.4rem', background: parsing ? '#aaa' : '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: parsing ? 'default' : 'pointer', fontSize: '1rem' }}>
              {parsing ? 'Parsing...' : 'Parse & Save'}
            </button>

            {parseResult && (
              <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '4px', background: parseResult.success ? '#e6f4ea' : '#fdecea', border: `1px solid ${parseResult.success ? '#a8d5b0' : '#f5c6c6'}` }}>
                {parseResult.success ? (
                  <>
                    <strong style={{ color: '#2d6a38' }}>Saved successfully</strong>
                    <table style={{ marginTop: '0.75rem', borderCollapse: 'collapse', width: '100%' }}>
                      {[['Worker', parseResult.record.worker_name], ['Date', parseResult.record.work_date], ['Job', parseResult.record.job_name], ['Hours', parseResult.record.hours_worked], ['Description', parseResult.record.work_description]].map(([label, value]) => (
                        <tr key={label}>
                          <td style={{ padding: '0.3rem 0.75rem 0.3rem 0', color: '#555', whiteSpace: 'nowrap' }}>{label}</td>
                          <td style={{ padding: '0.3rem 0' }}>{value ?? <em style={{ color: '#aaa' }}>not found</em>}</td>
                        </tr>
                      ))}
                    </table>
                  </>
                ) : (
                  <strong style={{ color: '#c0392b' }}>Error: {parseResult.error}</strong>
                )}
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Recent Parsed Entries ({emailRecords.length})</h3>
              <button onClick={fetchEmailRecords} style={{ padding: '0.4rem 0.9rem', background: '#555', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Refresh</button>
            </div>

            {loadingRecords ? (
              <p style={{ color: '#888' }}>Loading...</p>
            ) : emailRecords.length === 0 ? (
              <p style={{ color: '#888' }}>No entries yet. Parse a message above to get started.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#ddd', borderBottom: '2px solid #999' }}>
                    {['Worker', 'Date', 'Job', 'Hours', 'Description', 'Status'].map(h => (
                      <th key={h} style={{ padding: '0.75rem', textAlign: h === 'Hours' || h === 'Status' ? 'center' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {emailRecords.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={{ padding: '0.75rem' }}>{r.worker_name ?? <em style={{ color: '#aaa' }}>unknown</em>}</td>
                      <td style={{ padding: '0.75rem' }}>{r.work_date ?? '—'}</td>
                      <td style={{ padding: '0.75rem' }}>{r.job_name ?? '—'}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>{r.hours_worked ?? '—'}</td>
                      <td style={{ padding: '0.75rem', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.work_description}>{r.work_description ?? '—'}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span style={{ padding: '0.2rem 0.5rem', borderRadius: '3px', fontSize: '0.85rem', background: r.parse_status === 'parsed' ? '#00aa00' : '#cc3300', color: 'white' }} title={r.parse_error || ''}>
                          {r.parse_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
