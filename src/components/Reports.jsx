import React, { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

const card = { padding: '1.25rem', background: '#fff', borderRadius: '6px', border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const badge = (s) => ({ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: s === 'open' ? '#e6f4ea' : '#f0f0f0', color: s === 'open' ? '#2d6a38' : '#666' })
const clickRow = { cursor: 'pointer' }
const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }

function getPayWeekStart(date) {
  const d = new Date(date)
  const diff = (d.getDay() - 4 + 7) % 7
  d.setDate(d.getDate() - diff)
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
function fmtDate(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
// Local calendar date — toISOString() is UTC and rolls to tomorrow after 9pm Atlantic
function toYMD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function Reports() {
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [customers, setCustomers] = useState([])
  const [vessels, setVessels] = useState([])
  const [employees, setEmployees] = useState([])
  const [entries, setEntries] = useState([])
  const [supplies, setSupplies] = useState([])

  // Navigation
  const [activeTab, setActiveTab] = useState('jobs')
  const [selectedJob, setSelectedJob] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [navHistory, setNavHistory] = useState([])

  // Global job status filter
  const [jobStatus, setJobStatus] = useState('open')

  // Tab-specific filters
  const [jobNumberFilter, setJobNumberFilter] = useState('')
  const [customerFilterTab, setCustomerFilterTab] = useState('all')
  const [vesselFilterTab, setVesselFilterTab] = useState('all')
  const [employeeFilterTab, setEmployeeFilterTab] = useState('all')

  // Payroll tab
  const payWeeks = recentPayWeeks(8)
  const [payWeekStart, setPayWeekStart] = useState(payWeeks[0])

  const [payEmployee, setPayEmployee] = useState('')
  const [payrollConfig, setPayrollConfig] = useState({})
  const [statHolidays, setStatHolidays] = useState(new Set())

  // Date range filter
  const [datePreset, setDatePreset] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  function applyPreset(preset) {
    setDatePreset(preset)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = toYMD(today)
    if (preset === 'all') { setDateFrom(''); setDateTo(''); return }
    if (preset === 'this-week') {
      const s = getPayWeekStart(today)
      const e = new Date(s); e.setDate(e.getDate() + 6)
      setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return
    }
    if (preset === 'last-week') {
      const s = getPayWeekStart(today); s.setDate(s.getDate() - 7)
      const e = new Date(s); e.setDate(e.getDate() + 6)
      setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return
    }
    if (preset === 'this-month') {
      const s = new Date(today.getFullYear(), today.getMonth(), 1)
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      setDateFrom(toYMD(s)); setDateTo(toYMD(e)); return
    }
    if (preset === 'last-30') {
      const s = new Date(today); s.setDate(s.getDate() - 30)
      setDateFrom(toYMD(s)); setDateTo(todayStr); return
    }
  }

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [jobsRes, custRes, vesselRes, empRes, entriesRes, configRes, holidaysRes, suppliesRes] = await Promise.all([
      supabase.schema('Cores').from('jobs').select('*, customers(name), vessels(name)').order('job_number'),
      supabase.schema('Cores').from('customers').select('*').order('name'),
      supabase.schema('Cores').from('vessels').select('*').order('name'),
      supabase.schema('Cores').from('employees').select('*').order('name'),
      supabase.schema('Cores').from('timesheet_entries').select('*, employees(id, name), jobs(id, job_number, description, status, customers(name), vessels(name))').order('work_date', { ascending: false }),
      supabase.schema('Cores').from('payroll_config').select('key, value'),
      supabase.schema('Cores').from('stat_holidays').select('holiday_date'),
      supabase.schema('Cores').from('job_supplies').select('*, employees(id, name)').order('work_date', { ascending: false }),
    ])
    setJobs(jobsRes.data || [])
    setCustomers(custRes.data || [])
    setVessels(vesselRes.data || [])
    setEmployees(empRes.data || [])
    setEntries(entriesRes.data || [])
    setSupplies(suppliesRes.data || [])
    setPayrollConfig(Object.fromEntries((configRes.data || []).map(r => [r.key, Number(r.value)])))
    setStatHolidays(new Set((holidaysRes.data || []).map(r => r.holiday_date)))
    setLoading(false)
  }

  // ── Filtering ──
  const filteredEntries = entries.filter(e => {
    if (jobStatus !== 'all' && e.jobs?.status !== jobStatus) return false
    if (dateFrom && e.work_date < dateFrom) return false
    if (dateTo   && e.work_date > dateTo)   return false
    return true
  })
  const filteredSupplies = supplies.filter(s => {
    if (dateFrom && s.work_date < dateFrom) return false
    if (dateTo   && s.work_date > dateTo)   return false
    return true
  })
  const jobsWithEntriesInPeriod = new Set(filteredEntries.map(e => e.job_id))
  const filteredJobs = jobs.filter(j => {
    if (jobStatus !== 'all' && j.status !== jobStatus) return false
    if (datePreset !== 'all' && !jobsWithEntriesInPeriod.has(j.id)) return false
    return true
  })
  const dateLabel = datePreset === 'all' ? 'All time'
    : datePreset === 'this-week' ? 'This pay week'
    : datePreset === 'last-week' ? 'Last pay week'
    : datePreset === 'this-month' ? 'This month'
    : datePreset === 'last-30' ? 'Last 30 days'
    : dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom ? `From ${dateFrom}` : dateTo ? `To ${dateTo}` : 'Custom'

  // ── Derived maps ──
  const hoursPerJob = filteredEntries.reduce((acc, e) => { acc[e.job_id] = (acc[e.job_id] || 0) + Number(e.hours); return acc }, {})
  const crewPerJob  = filteredEntries.reduce((acc, e) => { if (!acc[e.job_id]) acc[e.job_id] = new Set(); acc[e.job_id].add(e.employees?.name); return acc }, {})
  const hoursPerEmp = filteredEntries.reduce((acc, e) => { const id = e.employee_id; acc[id] = (acc[id] || 0) + Number(e.hours); return acc }, {})
  const totalHours  = filteredEntries.reduce((s, e) => s + Number(e.hours), 0)
  const openJobs    = jobs.filter(j => j.status === 'open').length
  const shownJobs   = filteredJobs.length

  // ── Navigation helpers ──
  function goToJob(job) {
    setNavHistory(h => [...h, { selectedJob, selectedEmployee, activeTab }])
    setSelectedJob(job)
    setSelectedEmployee(null)
  }
  function goToEmployee(emp) {
    setNavHistory(h => [...h, { selectedJob, selectedEmployee, activeTab }])
    setSelectedJob(null)
    setSelectedEmployee(emp)
  }
  function goBack() {
    if (!navHistory.length) return
    const prev = navHistory[navHistory.length - 1]
    setNavHistory(h => h.slice(0, -1))
    setSelectedJob(prev.selectedJob)
    setSelectedEmployee(prev.selectedEmployee)
    setActiveTab(prev.activeTab)
  }
  function switchTab(tab, opts = {}) {
    setNavHistory([])
    setSelectedJob(null)
    setSelectedEmployee(null)
    setActiveTab(tab)
    if (opts.status !== undefined) setJobStatus(opts.status)
    if (opts.customer !== undefined) setCustomerFilter(opts.customer)
  }

  function backLabel() {
    if (!navHistory.length) return '← Back'
    const prev = navHistory[navHistory.length - 1]
    if (prev.selectedJob) return `← ${prev.selectedJob.job_number}`
    if (prev.selectedEmployee) return `← ${prev.selectedEmployee.name}`
    const labels = { jobs: '← Jobs Overview', customer: '← By Customer', vessel: '← By Vessel', employee: '← All Employees', payroll: '← Payroll' }
    return labels[prev.activeTab] || '← Back'
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

    // Get entries for this week
    const weekEntries = entries.filter(e => e.work_date >= weekStart && e.work_date <= weekEndStr)
    const empIds = [...new Set(weekEntries.map(e => e.employee_id))]
    const otMap = computeAllOT(weekEntries)

    // Group by employee
    const byEmp = {}
    weekEntries.forEach(e => {
      if (!byEmp[e.employee_id]) byEmp[e.employee_id] = []
      byEmp[e.employee_id].push(e)
    })

    const rows = ['Employee,Total Hours,Reg Hours,OT Hours,Per Diem,Job Numbers,Hours by Job,Supplies Used']
    empIds.forEach(eid => {
      const emp = employees.find(e => e.id === eid)
      const empEntries = byEmp[eid] || []
      const empSupplies = supplies.filter(s => empEntries.some(e => e.id === s.timesheet_entry_id || e.work_date === toYMD(new Date(s.created_at))))

      const totalHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
      const regHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
      const otHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.ot || 0), 0)
      const perDiem = [...new Set(empEntries.map(e => e.per_diem).filter(Boolean))].join('; ')
      const jobNums = [...new Set(empEntries.map(e => e.jobs?.job_number).filter(Boolean))].join(', ')
      const jobHours = empEntries.map(e => `${e.jobs?.job_number}:${e.hours}hrs`).join(' | ')
      const suppliesStr = empSupplies.length > 0 ? empSupplies.map(s => `${s.supply_name}x${s.quantity}`).join('; ') : 'none'

      rows.push([
        emp?.name || 'Unknown',
        totalHours.toFixed(2),
        regHours.toFixed(2),
        otHours.toFixed(2),
        perDiem || 'none',
        jobNums,
        jobHours,
        suppliesStr
      ].map(v => `"${v}"`).join(','))
    })

    downloadCSV(rows, `weekly-summary-${weekStart}-to-${weekEndStr}.csv`)
  }

  const dateFileSuffix = dateFrom && dateTo ? `${dateFrom}-to-${dateTo}`
    : dateFrom ? `from-${dateFrom}` : dateTo ? `to-${dateTo}` : 'all-time'

  const csvDateFrom = dateFrom || ''
  const csvDateTo   = dateTo   || ''

  function exportEntries(entriesToExport, title, filename) {
    // Need full employee entries for accurate weekly OT context
    const empIds = [...new Set(entriesToExport.map(e => e.employee_id))]
    const allEmpEntries = entries.filter(e => empIds.includes(e.employee_id))
    const otMap = computeAllOT(allEmpEntries)
    const rows = ['Employee,Date,Job #,Customer,Vessel,Total Hours,Reg Hours,OT Hours,Per Diem,Description,Date From,Date To']
    entriesToExport
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1))
      .forEach(e => {
        const { reg = 0, ot = 0 } = otMap[e.id] || {}
        rows.push([
          e.employees?.name,
          e.work_date,
          e.jobs?.job_number,
          e.jobs?.customers?.name,
          e.jobs?.vessels?.name,
          Number(e.hours).toFixed(1),
          reg.toFixed(1),
          ot.toFixed(1),
          Number(e.per_diem || 0),
          `"${(e.description || '').replace(/"/g, '""')}"`,
          csvDateFrom,
          csvDateTo,
        ].join(','))
      })
    downloadCSV(rows, filename)
  }

  const exportBtn = (entriesToExport, title, filename) => (
    <button onClick={() => exportEntries(entriesToExport, title, filename)}
      style={{ marginLeft: 'auto', padding: '0.35rem 0.9rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
      Export CSV
    </button>
  )

  // Compute reg/OT per entry for any set of entries (handles multiple employees + weeks)
  function computeAllOT(entriesToProcess) {
    const dailyThreshold  = payrollConfig.daily_ot_threshold  ?? 8
    const weeklyThreshold = payrollConfig.weekly_ot_threshold ?? 40
    const map = {}
    // Group by employee, then by pay week
    const byEmp = entriesToProcess.reduce((acc, e) => {
      if (!acc[e.employee_id]) acc[e.employee_id] = {}
      const ws = toYMD(getPayWeekStart(new Date(e.work_date + 'T12:00:00')))
      if (!acc[e.employee_id][ws]) acc[e.employee_id][ws] = []
      acc[e.employee_id][ws].push(e)
      return acc
    }, {})
    Object.values(byEmp).forEach(weeks => {
      Object.values(weeks).forEach(weekEnts => {
        const inOrder = [...weekEnts].sort((a, b) =>
          a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1)
        )
        let weeklyRegSoFar = 0, dayHoursSoFar = 0, currentDate = null
        inOrder.forEach(e => {
          if (e.work_date !== currentDate) { dayHoursSoFar = 0; currentDate = e.work_date }
          const hrs = Number(e.hours)
          if (e.is_stat_pay) {
            // Auto-granted stat pay: straight 8 reg, doesn't consume the weekly
            // reg allowance and doesn't count as hours worked that day
            map[e.id] = { reg: hrs, ot: 0, manual: true }
          } else if (e.ot_hours !== null && e.ot_hours !== undefined) {
            const ot = Number(e.ot_hours), reg = hrs - ot
            map[e.id] = { reg, ot, manual: true }
            dayHoursSoFar += hrs; weeklyRegSoFar += reg
          } else if (statHolidays.has(e.work_date)) {
            // Work on a stat holiday is all OT
            map[e.id] = { reg: 0, ot: hrs }
            dayHoursSoFar += hrs
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
    })
    return map
  }

  // Single-week version used by payroll tab display
  function computeEntryOT(weekEntries) {
    return computeAllOT(weekEntries)
  }

  function exportCurrentTab() {
    const otMap = computeAllOT(filteredEntries)

    if (activeTab === 'jobs') {
      // Aggregate reg/OT per job across all filtered entries
      const regPerJob = {}, otPerJob = {}, pdPerJob = {}
      filteredEntries.forEach(e => {
        const { reg = 0, ot = 0 } = otMap[e.id] || {}
        regPerJob[e.job_id] = (regPerJob[e.job_id] || 0) + reg
        otPerJob[e.job_id]  = (otPerJob[e.job_id]  || 0) + ot
        pdPerJob[e.job_id]  = (pdPerJob[e.job_id]  || 0) + Number(e.per_diem || 0)
      })
      const suppliesPerJob = filteredSupplies.reduce((acc, s) => {
        if (!acc[s.job_id]) acc[s.job_id] = []
        acc[s.job_id].push(`${s.supply_name} x${Number(s.quantity)}`)
        return acc
      }, {})
      const rows = ['Job #,Customer,Vessel,Description,Status,Total Hours,Reg Hours,OT Hours,Per Diem,Crew,Supplies,Date From,Date To']
      filteredJobs
        .filter(j => !jobNumberFilter || j.job_number.toString().toLowerCase().includes(jobNumberFilter.toLowerCase()))
        .forEach(j => rows.push([
          j.job_number, j.customers?.name, j.vessels?.name,
          `"${(j.description || '').replace(/"/g, '""')}"`,
          j.status,
          (hoursPerJob[j.id] || 0).toFixed(1),
          (regPerJob[j.id] || 0).toFixed(1),
          (otPerJob[j.id]  || 0).toFixed(1),
          (pdPerJob[j.id]  || 0),
          `"${crewPerJob[j.id] ? [...crewPerJob[j.id]].join(', ') : ''}"`,
          `"${(suppliesPerJob[j.id] || []).join('; ')}"`,
          csvDateFrom, csvDateTo,
        ].join(',')))
      downloadCSV(rows, `jobs-${dateFileSuffix}.csv`)
    } else if (activeTab === 'customer') {
      const regPerJob = {}, otPerJob = {}
      filteredEntries.forEach(e => {
        const { reg = 0, ot = 0 } = otMap[e.id] || {}
        regPerJob[e.job_id] = (regPerJob[e.job_id] || 0) + reg
        otPerJob[e.job_id]  = (otPerJob[e.job_id]  || 0) + ot
      })
      const rows = ['Customer,Job #,Vessel,Description,Status,Total Hours,Reg Hours,OT Hours,Date From,Date To']
      customers.filter(c => customerFilterTab === 'all' || c.id === customerFilterTab).forEach(c =>
        filteredJobs.filter(j => j.customer_id === c.id).forEach(j =>
          rows.push([c.name, j.job_number, j.vessels?.name,
            `"${(j.description || '').replace(/"/g, '""')}"`,
            j.status,
            (hoursPerJob[j.id] || 0).toFixed(1),
            (regPerJob[j.id] || 0).toFixed(1),
            (otPerJob[j.id]  || 0).toFixed(1),
            csvDateFrom, csvDateTo,
          ].join(','))
        )
      )
      downloadCSV(rows, `by-customer-${dateFileSuffix}.csv`)
    } else if (activeTab === 'vessel') {
      const regPerJob = {}, otPerJob = {}
      filteredEntries.forEach(e => {
        const { reg = 0, ot = 0 } = otMap[e.id] || {}
        regPerJob[e.job_id] = (regPerJob[e.job_id] || 0) + reg
        otPerJob[e.job_id]  = (otPerJob[e.job_id]  || 0) + ot
      })
      const rows = ['Vessel,Job #,Customer,Description,Status,Total Hours,Reg Hours,OT Hours,Date From,Date To']
      vessels.filter(v => vesselFilterTab === 'all' || v.id === vesselFilterTab).forEach(v =>
        filteredJobs.filter(j => j.vessel_id === v.id).forEach(j =>
          rows.push([v.name, j.job_number, j.customers?.name,
            `"${(j.description || '').replace(/"/g, '""')}"`,
            j.status,
            (hoursPerJob[j.id] || 0).toFixed(1),
            (regPerJob[j.id] || 0).toFixed(1),
            (otPerJob[j.id]  || 0).toFixed(1),
            csvDateFrom, csvDateTo,
          ].join(','))
        )
      )
      downloadCSV(rows, `by-vessel-${dateFileSuffix}.csv`)
    } else if (activeTab === 'employee') {
      const rows = ['Employee,Jobs Worked,Total Hours,Reg Hours,OT Hours,Per Diem,Customers,Date From,Date To']
      employees.filter(emp => employeeFilterTab === 'all' || emp.id === employeeFilterTab).forEach(emp => {
        const ee = filteredEntries.filter(e => e.employee_id === emp.id)
        if (!ee.length) return
        const empJobs = new Set(ee.map(e => e.job_id))
        const empCusts = new Set(ee.map(e => e.jobs?.customers?.name).filter(Boolean))
        const totalHrs = ee.reduce((s, e) => s + Number(e.hours), 0)
        const totalReg = ee.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
        const totalOT  = ee.reduce((s, e) => s + (otMap[e.id]?.ot  || 0), 0)
        const totalPD  = ee.reduce((s, e) => s + Number(e.per_diem || 0), 0)
        rows.push([emp.name, empJobs.size, totalHrs.toFixed(1), totalReg.toFixed(1), totalOT.toFixed(1), totalPD, `"${[...empCusts].join(', ')}"`, csvDateFrom, csvDateTo].join(','))
      })
      downloadCSV(rows, `employees-${dateFileSuffix}.csv`)
    } else if (activeTab === 'payroll') {
      const emp = employees.find(e => e.id === payEmployee)
      const weekEnd = new Date(payWeekStart); weekEnd.setDate(weekEnd.getDate() + 6)
      const days = getPayWeekDays(payWeekStart)
      const weekDates = new Set(days.map(toYMD))
      const weekEntries = entries.filter(e => e.employee_id === payEmployee && weekDates.has(e.work_date))
      const otMap = computeEntryOT(weekEntries)
      const rows = ['Employee,Day,Date,Job #,Customer,Total Hours,Reg Hours,OT Hours,Per Diem,Description,Week From,Week To']
      weekEntries
        .sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.sort_order ?? 1) - (b.sort_order ?? 1))
        .forEach(e => {
          const { reg = 0, ot = 0 } = otMap[e.id] || {}
          rows.push([
            emp?.name,
            new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }),
            e.work_date, e.jobs?.job_number, e.jobs?.customers?.name,
            Number(e.hours).toFixed(1), reg.toFixed(1), ot.toFixed(1),
            Number(e.per_diem || 0),
            `"${(e.description || '').replace(/"/g, '""')}"`,
            toYMD(payWeekStart), toYMD(weekEnd),
          ].join(','))
        })
      downloadCSV(rows, `payroll-${emp?.name?.replace(/\s+/g, '-') || 'unknown'}-${toYMD(payWeekStart)}.csv`)
    }
  }

  const tabExportBtn = (
    <button onClick={exportCurrentTab}
      style={{ padding: '0.35rem 0.9rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
      Export CSV
    </button>
  )

  const backBtn = (
    <button onClick={goBack} style={{ padding: '0.3rem 0.9rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#555', fontSize: '0.9rem' }}>
      {backLabel()}
    </button>
  )

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => switchTab(key)} style={{
      padding: '0.5rem 1.2rem', border: 'none', cursor: 'pointer', fontSize: '0.95rem',
      borderBottom: activeTab === key && !selectedJob && !selectedEmployee ? '3px solid #0066cc' : '3px solid transparent',
      background: 'none', fontWeight: activeTab === key && !selectedJob && !selectedEmployee ? 700 : 400,
      color: activeTab === key && !selectedJob && !selectedEmployee ? '#0066cc' : '#555',
    }}>{label}</button>
  )

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#888' }}>Loading reports...</div>

  // ── Job Detail ──
  if (selectedJob) {
    const job = selectedJob
    const jobEntries = filteredEntries.filter(e => e.job_id === job.id)
    const jobSupplies = filteredSupplies.filter(s => s.job_id === job.id)
    const totalJobHours = jobEntries.reduce((s, e) => s + Number(e.hours), 0)
    const crewMap = jobEntries.reduce((acc, e) => {
      const emp = e.employees
      if (!emp) return acc
      if (!acc[emp.id]) acc[emp.id] = { emp, hours: 0 }
      acc[emp.id].hours += Number(e.hours)
      return acc
    }, {})

    return (
      <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {backBtn}
          <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{job.job_number}</span>
          <span style={{ color: '#aaa' }}>·</span>
          <span>{job.customers?.name}</span>
          <span style={{ color: '#aaa' }}>·</span>
          <span style={{ color: '#555' }}>{job.vessels?.name}</span>
          <span style={badge(job.status)}>{job.status}</span>
          {exportBtn(jobEntries, `Job ${job.job_number} – ${job.customers?.name}`, `${job.job_number}-${dateFileSuffix}.csv`)}
        </div>
        <p style={{ color: '#666', marginBottom: '1.5rem' }}>{job.description}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {[
            { label: 'Total Hours', value: totalJobHours.toFixed(1) },
            { label: 'Crew Members', value: Object.keys(crewMap).length },
            { label: 'Days Worked', value: new Set(jobEntries.map(e => e.work_date)).size },
          ].map(({ label, value }) => (
            <div key={label} style={card}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#888', fontSize: '0.9rem' }}>{label}</div>
            </div>
          ))}
        </div>

        <h4 style={{ color: '#555', marginBottom: '0.75rem' }}>Crew</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Employee</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Hours</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>% of Job</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(crewMap).sort((a, b) => b.hours - a.hours).map(({ emp, hours }) => (
              <tr key={emp.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToEmployee(emp)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                <td style={{ padding: '0.6rem 0.75rem', ...linkStyle }}>{emp.name}</td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600 }}>{hours.toFixed(1)}</td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#888' }}>{totalJobHours > 0 ? Math.round((hours / totalJobHours) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#555', marginBottom: '0.75rem' }}>Work Log</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Employee</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Hours</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {jobEntries.sort((a, b) => a.work_date > b.work_date ? 1 : -1).map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.6rem 0.75rem', color: '#888', whiteSpace: 'nowrap' }}>
                  {new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </td>
                <td style={{ padding: '0.6rem 0.75rem', ...linkStyle }} onClick={() => goToEmployee(e.employees)}>{e.employees?.name}</td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{e.hours}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: '#555' }}>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#555', marginBottom: '0.75rem', marginTop: '2rem' }}>Supplies Used</h4>
        {jobSupplies.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Date</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Employee</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Supply</th>
                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {jobSupplies.sort((a, b) => a.work_date > b.work_date ? 1 : -1).map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.6rem 0.75rem', color: '#888', whiteSpace: 'nowrap' }}>
                    {new Date(s.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>{s.employees?.name || '—'}</td>
                  <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{s.supply_name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{Number(s.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: '#999', fontSize: '0.9rem', marginBottom: '2rem' }}>No supplies recorded</div>
        )}
      </div>
    )
  }

  // ── Employee Detail ──
  if (selectedEmployee) {
    const emp = selectedEmployee
    const empEntries = filteredEntries.filter(e => e.employee_id === emp.id)
    const byJob = empEntries.reduce((acc, e) => {
      const jid = e.job_id
      if (!acc[jid]) acc[jid] = { job: e.jobs, hours: 0, entries: [] }
      acc[jid].hours += Number(e.hours)
      acc[jid].entries.push(e)
      return acc
    }, {})
    const empTotalHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
    const empCustomers = new Set(empEntries.map(e => e.jobs?.customers?.name).filter(Boolean))

    return (
      <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {backBtn}
          <h3 style={{ margin: 0 }}>{emp.name}</h3>
          {exportBtn(empEntries, `${emp.name} – Timesheets`, `${emp.name.replace(/\s+/g, '-')}-${dateFileSuffix}.csv`)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {[
            { label: 'Total Hours', value: empTotalHours.toFixed(1) },
            { label: 'Jobs Worked', value: Object.keys(byJob).length },
            { label: 'Customers', value: empCustomers.size },
          ].map(({ label, value }) => (
            <div key={label} style={card}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#888', fontSize: '0.9rem' }}>{label}</div>
            </div>
          ))}
        </div>

        {Object.values(byJob).map(({ job, hours, entries: jobEntries }) => {
          const fullJob = jobs.find(j => j.id === job?.id) || job
          return (
            <div key={job?.job_number} style={{ ...card, marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={linkStyle} onClick={() => goToJob(fullJob)}>{job?.job_number}</span>
                  <span style={{ color: '#aaa' }}>·</span>
                  <span style={{ color: '#555' }}>{job?.customers?.name}</span>
                  <span style={{ color: '#aaa' }}>·</span>
                  <span style={{ color: '#888' }}>{job?.vessels?.name}</span>
                  <span style={badge(job?.status)}>{job?.status}</span>
                </div>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{hours.toFixed(1)} hrs</span>
              </div>
              <div style={{ fontSize: '0.9rem', color: '#777', marginBottom: '0.75rem' }}>{job?.description}</div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '0.75rem' }}>
                {jobEntries.sort((a, b) => a.work_date > b.work_date ? 1 : -1).map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: '1rem', padding: '0.25rem 0', fontSize: '0.9rem' }}>
                    <span style={{ color: '#aaa', minWidth: '80px' }}>{new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    <span style={{ color: '#333', minWidth: '36px' }}>{e.hours}h</span>
                    <span style={{ color: '#555' }}>{e.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Normal tab views ──
  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Reports</h1>
          <p style={{ color: '#888', margin: '0.25rem 0 0' }}>Cores Worldwide — as of {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status filter */}
          {[['open','Open'], ['closed','Closed'], ['all','All jobs']].map(([key, label]) => (
            <button key={key} onClick={() => setJobStatus(key)} style={{
              padding: '0.35rem 0.85rem', fontSize: '0.85rem', border: '1px solid',
              borderColor: jobStatus === key ? '#444' : '#ddd',
              borderRadius: '20px', cursor: 'pointer',
              background: jobStatus === key ? '#1a1a2e' : '#fff',
              color: jobStatus === key ? '#fff' : '#555',
              fontWeight: jobStatus === key ? 600 : 400,
            }}>{label}</button>
          ))}
          <div style={{ width: '1px', height: '20px', background: '#ddd', margin: '0 0.25rem' }} />
          {/* Date filter */}
          {[
            ['all',       'All time'],
            ['this-week', 'This pay week'],
            ['last-week', 'Last pay week'],
            ['this-month','This month'],
            ['last-30',   'Last 30 days'],
            ['custom',    'Custom'],
          ].map(([key, label]) => (
            <button key={key} onClick={() => applyPreset(key)} style={{
              padding: '0.35rem 0.85rem', fontSize: '0.85rem', border: '1px solid',
              borderColor: datePreset === key ? '#0066cc' : '#ddd',
              borderRadius: '20px', cursor: 'pointer',
              background: datePreset === key ? '#e6f0ff' : '#fff',
              color: datePreset === key ? '#0066cc' : '#555',
              fontWeight: datePreset === key ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
      </div>
      {datePreset === 'custom' && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', padding: '0.75rem 1rem', background: '#f8faff', border: '1px solid #d0e0f8', borderRadius: '6px', flexWrap: 'wrap' }}>
          <label style={{ color: '#555', fontWeight: 600, fontSize: '0.9rem' }}>Custom range:</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }} />
            <span style={{ color: '#aaa' }}>→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }} />
          </div>
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ padding: '0.3rem 0.7rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#888', fontSize: '0.85rem' }}>Clear</button>}
        </div>
      )}
      {datePreset !== 'all' && (
        <div style={{ marginBottom: '1.25rem', fontSize: '0.85rem', color: '#0066cc' }}>
          Showing: <strong>{dateLabel}</strong>{dateFrom && dateTo && datePreset !== 'custom' ? ` (${dateFrom} – ${dateTo})` : ''}
          {' '}<span onClick={() => applyPreset('all')} style={{ color: '#aaa', cursor: 'pointer', textDecoration: 'underline' }}>clear</span>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          { label: jobStatus === 'closed' ? 'Closed Jobs' : jobStatus === 'all' ? 'Total Jobs' : 'Open Jobs',
            value: shownJobs, color: '#2d6a38', onClick: () => switchTab('jobs') },
          { label: 'Total Customers',    value: new Set(filteredJobs.map(j => j.customer_id).filter(Boolean)).size, color: '#0066cc', onClick: () => switchTab('customer') },
          { label: 'Total Vessels',      value: new Set(filteredJobs.map(j => j.vessel_id).filter(Boolean)).size,   color: '#5a4fcf', onClick: () => switchTab('vessel') },
          { label: 'Active Employees',   value: employees.filter(e => e.active).length, color: '#444',   onClick: () => switchTab('employee') },
          { label: 'Total Hours Logged', value: totalHours.toFixed(1),                  color: '#8B4513', onClick: () => switchTab('jobs') },
        ].map(({ label, value, color, onClick }) => (
          <div key={label} onClick={onClick} style={{ ...card, cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';  e.currentTarget.style.transform = 'translateY(0)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{value}</div>
            <div style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.25rem' }}>{label}</div>
            <div style={{ color: '#ccc', fontSize: '0.75rem', marginTop: '0.4rem' }}>click to view →</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        {['jobs', 'customer', 'vessel', 'employee', 'payroll', 'weekly-summary'].map(t => tabBtn(t, { jobs: 'Jobs Overview', customer: 'By Customer', vessel: 'By Vessel', employee: 'By Employee', payroll: 'Payroll', 'weekly-summary': 'Weekly Summary' }[t]))}
        <div style={{ marginLeft: 'auto', paddingBottom: '0.25rem' }}>
          {tabExportBtn}
        </div>
      </div>

      {/* ── Jobs Overview ── */}
      {activeTab === 'jobs' && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Job #:</label>
              <input type="text" placeholder="Filter by job number..." value={jobNumberFilter} onChange={e => setJobNumberFilter(e.target.value)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }} />
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                {['Job #', 'Customer', 'Vessel', 'Description', 'Status', 'Hours', 'Crew'].map(h => (
                  <th key={h} style={{ padding: '0.75rem', textAlign: h === 'Hours' || h === 'Status' ? 'center' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredJobs.filter(j => !jobNumberFilter || j.job_number.toString().toLowerCase().includes(jobNumberFilter.toLowerCase()))
                .map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                    <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                    <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                    <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                    <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{(hoursPerJob[j.id] || 0).toFixed(1)}</td>
                    <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#555' }}>{crewPerJob[j.id] ? [...crewPerJob[j.id]].join(', ') : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── By Customer ── */}
      {activeTab === 'customer' && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Customer:</label>
              <select value={customerFilterTab} onChange={e => setCustomerFilterTab(e.target.value)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }}>
                <option value="all">All customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {['Job #', 'Customer', 'Vessel', 'Description', 'Status', 'Hours', 'Crew'].map(h => (
                <th key={h} style={{ padding: '0.75rem', textAlign: h === 'Hours' || h === 'Status' ? 'center' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredJobs.filter(j => customerFilterTab === 'all' || j.customer_id === customerFilterTab)
              .sort((a, b) => (a.customers?.name || '').localeCompare(b.customers?.name || '') || (a.job_number || '').localeCompare(b.job_number || ''))
              .map(j => (
                <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                  <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                  <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                  <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{(hoursPerJob[j.id] || 0).toFixed(1)}</td>
                  <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#555' }}>{crewPerJob[j.id] ? [...crewPerJob[j.id]].join(', ') : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      )}

      {/* ── By Vessel ── */}
      {activeTab === 'vessel' && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Vessel:</label>
              <select value={vesselFilterTab} onChange={e => setVesselFilterTab(e.target.value)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }}>
                <option value="all">All vessels</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {['Job #', 'Customer', 'Vessel', 'Description', 'Status', 'Hours', 'Crew'].map(h => (
                <th key={h} style={{ padding: '0.75rem', textAlign: h === 'Hours' || h === 'Status' ? 'center' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredJobs.filter(j => vesselFilterTab === 'all' || j.vessel_id === vesselFilterTab)
              .sort((a, b) => (a.vessels?.name || '').localeCompare(b.vessels?.name || '') || (a.job_number || '').localeCompare(b.job_number || ''))
              .map(j => (
                <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                  <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                  <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                  <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{(hoursPerJob[j.id] || 0).toFixed(1)}</td>
                  <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#555' }}>{crewPerJob[j.id] ? [...crewPerJob[j.id]].join(', ') : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
        </div>
      )}

      {/* ── By Employee ── */}
      {activeTab === 'employee' && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Employee:</label>
              <select value={employeeFilterTab} onChange={e => setEmployeeFilterTab(e.target.value)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }}>
                <option value="all">All employees</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {['Employee', 'Jobs Worked', 'Total Hours', 'Customers'].map(h => (
                <th key={h} style={{ padding: '0.75rem', textAlign: h === 'Jobs Worked' || h === 'Total Hours' ? 'center' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.filter(emp => employeeFilterTab === 'all' || emp.id === employeeFilterTab).map(emp => {
              const empEntries = filteredEntries.filter(e => e.employee_id === emp.id)
              const empJobs = new Set(empEntries.map(e => e.job_id))
              const empCustomers = new Set(empEntries.map(e => e.jobs?.customers?.name).filter(Boolean))
              const empHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
              return (
                <tr key={emp.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToEmployee(emp)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{emp.name}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{empJobs.size}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{empHours.toFixed(1)}</td>
                  <td style={{ padding: '0.75rem', color: '#555', fontSize: '0.9rem' }}>{[...empCustomers].join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* ── Payroll ── */}
      {activeTab === 'payroll' && (() => {
        const dailyThreshold  = payrollConfig.daily_ot_threshold  ?? 8
        const weeklyThreshold = payrollConfig.weekly_ot_threshold ?? 40
        const otMultiplier    = payrollConfig.ot_multiplier        ?? 1.5
        const statMultiplier  = payrollConfig.stat_multiplier ?? 1.5
        const perDiemRate     = payrollConfig.per_diem_rate        ?? 0

        const weekEnd    = new Date(payWeekStart); weekEnd.setDate(weekEnd.getDate() + 6)
        const days       = getPayWeekDays(payWeekStart)
        const weekDates  = new Set(days.map(toYMD))
        const emp        = employees.find(e => e.id === payEmployee)
        const weekEntries = payEmployee ? entries.filter(e => e.employee_id === payEmployee && weekDates.has(e.work_date)) : []
        const byDate     = weekEntries.reduce((acc, e) => { if (!acc[e.work_date]) acc[e.work_date] = []; acc[e.work_date].push(e); return acc }, {})

        const entryOtMap = computeEntryOT(weekEntries)

        // Day-level summary — derived from entry-level totals
        const dayBreakdowns = days.map(day => {
          const ymd        = toYMD(day)
          const dayEntries = (byDate[ymd] || []).slice().sort((a, b) => (a.sort_order ?? 1) - (b.sort_order ?? 1))
          const dayHours   = dayEntries.reduce((s, e) => s + Number(e.hours), 0)
          const dayPerDiem = dayEntries.reduce((s, e) => s + Number(e.per_diem || 0), 0)
          const isStat     = statHolidays.has(ymd)
          const isToday    = ymd === toYMD(new Date())
          const isWeekend  = day.getDay() === 0 || day.getDay() === 6
          const regularHours = dayEntries.reduce((s, e) => s + (entryOtMap[e.id]?.reg ?? 0), 0)
          const otHours      = dayEntries.reduce((s, e) => s + (entryOtMap[e.id]?.ot ?? 0), 0)

          return { ymd, day, dayEntries, dayHours, regularHours, otHours, isStat, dayPerDiem, isToday, isWeekend }
        })

        const totalHours   = dayBreakdowns.reduce((s, d) => s + d.dayHours, 0)
        const totalRegular = dayBreakdowns.reduce((s, d) => s + d.regularHours, 0)
        const totalOT      = dayBreakdowns.reduce((s, d) => s + d.otHours, 0)
        const totalPerDiem = dayBreakdowns.reduce((s, d) => s + d.dayPerDiem, 0)
        // Flag stat days with hours actually WORKED (the auto 8-hr stat-pay entry doesn't count)
        const statDays     = dayBreakdowns.filter(d => d.isStat && d.dayEntries.some(e => !e.is_stat_pay))

        const thStyle = { padding: '0.65rem 0.75rem', textAlign: 'center', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }
        const tdC     = { padding: '0.65rem 0.75rem', textAlign: 'center' }

        return (
          <div>
            {/* Selectors */}
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', color: '#555', fontWeight: 600, marginBottom: '0.4rem' }}>Employee</label>
                <select value={payEmployee} onChange={e => setPayEmployee(e.target.value)} style={{ padding: '0.5rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }}>
                  <option value="">— select —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', color: '#555', fontWeight: 600, marginBottom: '0.4rem' }}>Pay Week</label>
                <select value={toYMD(payWeekStart)} onChange={e => setPayWeekStart(new Date(e.target.value + 'T12:00:00'))} style={{ padding: '0.5rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '230px' }}>
                  {payWeeks.map(w => { const end = new Date(w); end.setDate(end.getDate() + 6); return <option key={toYMD(w)} value={toYMD(w)}>Thu {fmtDate(w)} – Wed {fmtDate(end)}</option> })}
                </select>
              </div>
            </div>

            {!payEmployee ? (
              <div style={{ ...card, textAlign: 'center', padding: '3rem', color: '#aaa' }}>Select an employee to view their pay week</div>
            ) : (
              <>
                {/* Summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: 'Total Hours',   value: totalHours.toFixed(1),   color: '#1a1a2e' },
                    { label: `Regular (≤${dailyThreshold}h/day, ≤${weeklyThreshold}h/wk)`, value: totalRegular.toFixed(1), color: '#2d6a38' },
                    { label: `OT @ ${otMultiplier}×`, value: totalOT.toFixed(1), color: '#c0392b' },
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
                    {' '}{statDays.map(d => `${d.day.toLocaleDateString('en-GB', { weekday: 'short' })} ${fmtDate(d.day)} — ${d.day.toLocaleDateString('en-GB', { month: 'long', day: 'numeric' })}`).join(', ')}
                  </div>
                )}

                {/* Day-by-day table */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Day</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Date</th>
                      <th style={thStyle}>Total</th>
                      <th style={thStyle}>Reg</th>
                      <th style={{ ...thStyle, color: '#c0392b' }}>OT</th>
                      <th style={{ ...thStyle, color: '#7a5c00' }}>Stat</th>
                      <th style={{ ...thStyle, color: '#8B4513' }}>PD</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>Job(s) &amp; Work Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayBreakdowns.map(({ ymd, day, dayEntries, dayHours, regularHours, otHours, isStat, dayPerDiem, isToday, isWeekend }) => (
                      <tr key={ymd} style={{ borderBottom: '1px solid #eee', background: isStat && dayHours > 0 ? '#fff8e1' : isToday ? '#f0fff4' : isWeekend ? '#fafafa' : '#fff' }}>
                        <td style={{ padding: '0.65rem 0.75rem', color: isWeekend ? '#bbb' : '#333', fontWeight: isToday ? 700 : 400 }}>
                          {day.toLocaleDateString('en-GB', { weekday: 'long' })}
                          {isStat && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', background: '#ffe082', color: '#7a5c00', borderRadius: '4px', padding: '0.1rem 0.35rem', fontWeight: 600 }}>STAT</span>}
                        </td>
                        <td style={{ padding: '0.65rem 0.75rem', color: '#888', fontSize: '0.9rem' }}>{fmtDate(day)}</td>
                        <td style={{ ...tdC, fontWeight: 600, color: dayHours > 0 ? '#1a1a2e' : '#ddd' }}>{dayHours > 0 ? dayHours.toFixed(1) : '—'}</td>
                        <td style={{ ...tdC, color: regularHours > 0 ? '#2d6a38' : '#ddd' }}>{regularHours > 0 ? regularHours.toFixed(1) : '—'}</td>
                        <td style={{ ...tdC, color: otHours > 0 ? '#c0392b' : '#ddd', fontWeight: otHours > 0 ? 600 : 400 }}>{otHours > 0 ? otHours.toFixed(1) : '—'}</td>
                        <td style={{ ...tdC, color: isStat && dayHours > 0 ? '#7a5c00' : '#ddd' }}>{isStat && dayHours > 0 ? `+${statMultiplier}×` : '—'}</td>
                        <td style={{ ...tdC, color: dayPerDiem > 0 ? '#8B4513' : '#ddd' }}>{dayPerDiem > 0 ? `×${dayPerDiem}` : '—'}</td>
                        <td style={{ padding: '0.65rem 0.75rem' }}>
                          {dayEntries.length === 0
                            ? <span style={{ color: '#ddd', fontSize: '0.9rem' }}>No entries</span>
                            : dayEntries.map(e => {
                              const { reg = 0, ot = 0 } = entryOtMap[e.id] || {}
                              return (
                                <div key={e.id} style={{ marginBottom: dayEntries.length > 1 ? '0.3rem' : 0 }}>
                                  <span style={linkStyle} onClick={() => goToJob(jobs.find(j => j.id === e.job_id) || e.jobs)}>{e.jobs?.job_number}</span>
                                  <span style={{ color: '#aaa', margin: '0 0.4rem', fontSize: '0.85rem' }}>{e.jobs?.customers?.name}</span>
                                  <span style={{ color: '#2d6a38', fontSize: '0.85rem', marginRight: '0.3rem' }}>{reg.toFixed(1)}reg</span>
                                  {ot > 0 && <span style={{ color: '#c0392b', fontWeight: 600, fontSize: '0.85rem', marginRight: '0.3rem' }}>{ot.toFixed(1)}OT</span>}
                                  {e.description && <span style={{ color: '#555', fontSize: '0.9rem' }}>— {e.description}</span>}
                                </div>
                              )
                            })
                          }
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f5f5f5', borderTop: '2px solid #ddd', fontWeight: 700 }}>
                      <td colSpan={2} style={{ padding: '0.65rem 0.75rem' }}>Total</td>
                      <td style={{ ...tdC, fontWeight: 700 }}>{totalHours.toFixed(1)}</td>
                      <td style={{ ...tdC, color: '#2d6a38' }}>{totalRegular.toFixed(1)}</td>
                      <td style={{ ...tdC, color: totalOT > 0 ? '#c0392b' : '#aaa' }}>{totalOT.toFixed(1)}</td>
                      <td style={{ ...tdC, color: statDays.length > 0 ? '#7a5c00' : '#aaa' }}>{statDays.length > 0 ? statDays.length + ' day' + (statDays.length > 1 ? 's' : '') : '—'}</td>
                      <td style={{ ...tdC, color: totalPerDiem > 0 ? '#8B4513' : '#aaa' }}>{totalPerDiem > 0 ? `×${totalPerDiem}` : '—'}</td>
                      <td style={{ padding: '0.65rem 0.75rem', color: '#888', fontSize: '0.85rem' }}>{weekEntries.length} entr{weekEntries.length === 1 ? 'y' : 'ies'}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )
      })()}

      {/* ── Weekly Summary ── */}
      {activeTab === 'weekly-summary' && (() => {
        const weekEnd = new Date(payWeekStart)
        weekEnd.setDate(weekEnd.getDate() + 6)
        const weekStart = toYMD(payWeekStart)
        const weekEndStr = toYMD(weekEnd)
        const weekEntries = entries.filter(e => e.work_date >= weekStart && e.work_date <= weekEndStr)
        const empIds = [...new Set(weekEntries.map(e => e.employee_id))]
        const otMap = computeAllOT(weekEntries)

        const weekData = empIds.map(eid => {
          const emp = employees.find(e => e.id === eid)
          const empEntries = weekEntries.filter(e => e.employee_id === eid)
          const totalHours = empEntries.reduce((s, e) => s + Number(e.hours), 0)
          const regHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
          const otHours = empEntries.reduce((s, e) => s + (otMap[e.id]?.ot || 0), 0)
          const perDiem = [...new Set(empEntries.map(e => e.per_diem).filter(Boolean))].join('; ')
          const jobNums = [...new Set(empEntries.map(e => e.jobs?.job_number).filter(Boolean))].join(', ')
          const empSupplies = supplies.filter(s => empEntries.some(e => e.id === s.timesheet_entry_id))
          return { emp, totalHours, regHours, otHours, perDiem, jobNums, supplies: empSupplies }
        }).sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || ''))

        return (
          <div>
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ color: '#555', fontWeight: 600 }}>Pay Week:</label>
                <select value={weekStart} onChange={e => setPayWeekStart(new Date(e.target.value))} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                  {payWeeks.map(w => {
                    const end = new Date(w); end.setDate(end.getDate() + 6)
                    return <option key={toYMD(w)} value={toYMD(w)}>{fmtDate(w)} – {fmtDate(end)}</option>
                  })}
                </select>
              </div>
              <button onClick={() => downloadWeeklySummary()} style={{ padding: '0.4rem 1rem', background: '#2d6a38', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>Download CSV</button>
            </div>

            {weekData.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px' }}>No entries for this week</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    {['Employee', 'Total Hrs', 'Reg Hrs', 'OT Hrs', 'Per Diem', 'Jobs', 'Supplies'].map(h => (
                      <th key={h} style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.9rem', fontWeight: 600, color: '#555' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekData.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.75rem', fontWeight: 600 }}>{row.emp?.name || 'Unknown'}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>{row.totalHours.toFixed(1)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#2d6a38' }}>{row.regHours.toFixed(1)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: row.otHours > 0 ? '#c0392b' : '#ccc', fontWeight: row.otHours > 0 ? 600 : 400 }}>{row.otHours.toFixed(1)}</td>
                      <td style={{ padding: '0.75rem', color: '#555', fontSize: '0.9rem' }}>{row.perDiem || '—'}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#0066cc' }}>{row.jobNums || '—'}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#555' }}>{row.supplies.length > 0 ? `${row.supplies.length} items` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })()}

    </div>
  )
}
