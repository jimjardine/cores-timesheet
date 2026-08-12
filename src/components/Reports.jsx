import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import MultiSelectDropdown from './MultiSelectDropdown'
import { computeOTMap } from '../utils/otCalc'
import { fmtHours } from '../utils/format'

const card = { padding: '1.25rem', background: '#fff', borderRadius: '6px', border: '1px solid #e0e0e0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const badge = (s) => ({ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: s === 'open' ? '#e6f4ea' : '#f0f0f0', color: s === 'open' ? '#2d6a38' : '#666' })
const clickRow = { cursor: 'pointer' }
const hoverRow = (e, on) => { e.currentTarget.style.background = on ? '#f0f6ff' : '' }
const linkStyle = { color: '#0066cc', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }
const gearPhotoUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl
const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-timesheet`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function getPayWeekStart(date) {
  const d = new Date(date)
  const diff = (d.getDay() - 4 + 7) % 7
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}
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
  const [gearPhotos, setGearPhotos] = useState([])
  const [photoGroup, setPhotoGroup] = useState(null)
  const [photoLightbox, setPhotoLightbox] = useState(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summarizeError, setSummarizeError] = useState('')

  // Navigation
  const [activeTab, setActiveTab] = useState('jobs')
  const [selectedJob, setSelectedJob] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [navHistory, setNavHistory] = useState([])

  // Global job status filter
  const [jobStatus, setJobStatus] = useState('open')

  // Tab-specific filters
  const [jobNumberFilter, setJobNumberFilter] = useState('')
  const [customerFilterIds, setCustomerFilterIds] = useState([])
  const [vesselFilterIds, setVesselFilterIds] = useState([])
  const [hideEmptyOptions, setHideEmptyOptions] = useState(true)
  const [employeeFilterIds, setEmployeeFilterIds] = useState([])
  const employeeFilterIdsDefaulted = useRef(false)
  const [suppliesJobFilterIds, setSuppliesJobFilterIds] = useState([])
  const [suppliesEmployeeFilterIds, setSuppliesEmployeeFilterIds] = useState([])
  const [suppliesGroupBy, setSuppliesGroupBy] = useState('date') // 'job' | 'date'
  const [expandedSupplyGroups, setExpandedSupplyGroups] = useState(new Set())
  function toggleSupplyGroup(key) {
    setExpandedSupplyGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Column sort — { [tabKey]: { col, dir } }
  const [tableSort, setTableSort] = useState({})
  function toggleSort(tabKey, col) {
    setTableSort(prev => {
      const cur = prev[tabKey]
      if (cur && cur.col === col) return { ...prev, [tabKey]: { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' } }
      return { ...prev, [tabKey]: { col, dir: 'asc' } }
    })
  }
  function sortRows(tabKey, rows, columns, defaultCmp) {
    const s = tableSort[tabKey]
    if (!s) return defaultCmp ? [...rows].sort(defaultCmp) : rows
    const col = columns.find(c => c.key === s.col)
    if (!col) return rows
    const sorted = [...rows].sort(col.cmp)
    return s.dir === 'desc' ? sorted.reverse() : sorted
  }
  function renderSortTh(tabKey, col, label, align = 'left') {
    const s = tableSort[tabKey]
    const active = s && s.col === col
    return (
      <th key={col} onClick={() => toggleSort(tabKey, col)}
        style={{ padding: '0.75rem', textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        {label}{active ? (s.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  const [payrollConfig, setPayrollConfig] = useState({})
  const [statHolidays, setStatHolidays] = useState(new Set())

  // Date range filter
  const [datePreset, setDatePreset] = useState('this-week')
  const [dateFrom, setDateFrom] = useState(() => toYMD(getPayWeekStart(new Date())))
  const [dateTo, setDateTo] = useState(() => {
    const s = getPayWeekStart(new Date())
    const e = new Date(s); e.setDate(e.getDate() + 6)
    return toYMD(e)
  })

  function applyPreset(preset) {
    setDatePreset(preset)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = toYMD(today)
    if (preset === 'all') { setDateFrom(''); setDateTo(''); return }
    if (preset === 'today') { setDateFrom(todayStr); setDateTo(todayStr); return }
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

  // Default the By Employee tab's filter — pre-populate with everyone so
  // "Clear" unambiguously means "show no one" instead of overloading an empty
  // selection to mean "no filter, show everyone".
  useEffect(() => {
    if (employeeFilterIdsDefaulted.current || employees.length === 0) return
    employeeFilterIdsDefaulted.current = true
    const withEntries = employees.filter(e => !hideEmptyOptions || entries.some(en => en.employee_id === e.id))
    setEmployeeFilterIds(withEntries.map(e => e.id))
  }, [employees, entries, hideEmptyOptions])

  async function loadAll() {
    setLoading(true)
    const [jobsRes, custRes, vesselRes, empRes, entriesRes, configRes, holidaysRes, suppliesRes, gearPhotosRes] = await Promise.all([
      supabase.schema('Cores').from('jobs').select('*, customers(name), vessels(name)').order('job_number'),
      supabase.schema('Cores').from('customers').select('*').order('name'),
      supabase.schema('Cores').from('vessels').select('*').order('name'),
      supabase.schema('Cores').from('employees').select('*').order('name'),
      supabase.schema('Cores').from('timesheet_entries').select('*, employees(id, name), jobs(id, job_number, description, status, customers(name), vessels(name))').order('work_date', { ascending: false }),
      supabase.schema('Cores').from('payroll_config').select('key, value'),
      supabase.schema('Cores').from('stat_holidays').select('holiday_date'),
      supabase.schema('Cores').from('job_supplies').select('*, employees(id, name)').order('work_date', { ascending: false }),
      supabase.schema('Cores').from('gear_photos').select('id, job_id, storage_path, employee_id, work_date, created_at').not('job_id', 'is', null),
    ])
    setJobs(jobsRes.data || [])
    setCustomers(custRes.data || [])
    setVessels(vesselRes.data || [])
    setEmployees(empRes.data || [])
    setEntries(entriesRes.data || [])
    setSupplies(suppliesRes.data || [])
    setGearPhotos(gearPhotosRes.data || [])
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
  const jobIdsWithEntries = new Set(entries.map(e => e.job_id).filter(Boolean))
  const filteredJobs = jobs.filter(j => {
    if (jobStatus !== 'all' && j.status !== jobStatus) return false
    if (datePreset !== 'all' && !jobsWithEntriesInPeriod.has(j.id)) return false
    if (hideEmptyOptions && !jobIdsWithEntries.has(j.id)) return false
    return true
  })
  const dateLabel = datePreset === 'all' ? 'All time'
    : datePreset === 'today' ? 'Today'
    : datePreset === 'this-week' ? 'This pay week'
    : datePreset === 'last-week' ? 'Last pay week'
    : datePreset === 'this-month' ? 'This month'
    : datePreset === 'last-30' ? 'Last 30 days'
    : dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom ? `From ${dateFrom}` : dateTo ? `To ${dateTo}` : 'Custom'

  // ── Derived maps ──
  const hoursPerJob = filteredEntries.reduce((acc, e) => { acc[e.job_id] = (acc[e.job_id] || 0) + Number(e.hours); return acc }, {})
  const crewPerJob  = filteredEntries.reduce((acc, e) => { if (!acc[e.job_id]) acc[e.job_id] = new Set(); acc[e.job_id].add(e.employees?.name); return acc }, {})
  const photosPerJob = gearPhotos.reduce((acc, p) => { acc[p.job_id] = (acc[p.job_id] || 0) + 1; return acc }, {})
  const hoursPerEmp = filteredEntries.reduce((acc, e) => { const id = e.employee_id; acc[id] = (acc[id] || 0) + Number(e.hours); return acc }, {})
  const jobsById = jobs.reduce((acc, j) => { acc[j.id] = j; return acc }, {})
  const photosPerEmployee = gearPhotos.reduce((acc, p) => { acc[p.employee_id] = (acc[p.employee_id] || 0) + 1; return acc }, {})

  // Shared by the Jobs / Customer / Vessel tabs — same row shape (job records)
  const jobColumns = [
    { key: 'job_number', label: 'Job #', align: 'left', cmp: (a, b) => (a.job_number || '').localeCompare(b.job_number || '', undefined, { numeric: true }) },
    { key: 'customer', label: 'Customer', align: 'left', cmp: (a, b) => (a.customers?.name || '').localeCompare(b.customers?.name || '') },
    { key: 'vessel', label: 'Vessel', align: 'left', cmp: (a, b) => (a.vessels?.name || '').localeCompare(b.vessels?.name || '') },
    { key: 'description', label: 'Description', align: 'left', cmp: (a, b) => (a.description || '').localeCompare(b.description || '') },
    { key: 'status', label: 'Status', align: 'center', cmp: (a, b) => (a.status || '').localeCompare(b.status || '') },
    { key: 'hours', label: 'Hours', align: 'center', cmp: (a, b) => (hoursPerJob[a.id] || 0) - (hoursPerJob[b.id] || 0) },
    { key: 'photos', label: 'Photos', align: 'center', cmp: (a, b) => (photosPerJob[a.id] || 0) - (photosPerJob[b.id] || 0) },
    { key: 'crew', label: 'Crew', align: 'left', cmp: (a, b) => (crewPerJob[a.id]?.size || 0) - (crewPerJob[b.id]?.size || 0) },
  ]

  // By Employee tab — materialize rows so header-click sort has something to sort
  const employeeRows = employees.filter(emp => employeeFilterIds.includes(emp.id)).map(emp => {
    const empEntries = filteredEntries.filter(e => e.employee_id === emp.id)
    if (empEntries.length === 0) return null
    return {
      emp,
      empJobs: new Set(empEntries.map(e => e.job_id)),
      empCustomers: new Set(empEntries.map(e => e.jobs?.customers?.name).filter(Boolean)),
      empHours: empEntries.reduce((s, e) => s + Number(e.hours), 0),
    }
  }).filter(Boolean)
  const employeeColumns = [
    { key: 'employee', label: 'Employee', align: 'left', cmp: (a, b) => (a.emp.name || '').localeCompare(b.emp.name || '') },
    { key: 'jobs', label: 'Jobs Worked', align: 'center', cmp: (a, b) => a.empJobs.size - b.empJobs.size },
    { key: 'hours', label: 'Total Hours', align: 'center', cmp: (a, b) => a.empHours - b.empHours },
    { key: 'photos', label: 'Photos', align: 'center', cmp: (a, b) => (photosPerEmployee[a.emp.id] || 0) - (photosPerEmployee[b.emp.id] || 0) },
    { key: 'customers', label: 'Customers', align: 'left', cmp: (a, b) => [...a.empCustomers].join(', ').localeCompare([...b.empCustomers].join(', ')) },
  ]

  // ── Supplies tab ──
  const jobIdsWithSupplies = new Set(filteredSupplies.map(s => s.job_id))
  const employeeIdsWithSupplies = new Set(filteredSupplies.map(s => s.employee_id))
  const suppliesTabList = filteredSupplies
    .filter(s => suppliesJobFilterIds.length === 0 || suppliesJobFilterIds.includes(s.job_id))
    .filter(s => suppliesEmployeeFilterIds.length === 0 || suppliesEmployeeFilterIds.includes(s.employee_id))
  const suppliesByJob = suppliesTabList.reduce((acc, s) => {
    if (!acc[s.job_id]) acc[s.job_id] = []
    acc[s.job_id].push(s)
    return acc
  }, {})
  // Grouped display, top level switches between Job and Date via suppliesGroupBy
  const suppliesTopGroups = (() => {
    const level1KeyFn = suppliesGroupBy === 'date' ? (s => s.work_date) : (s => s.job_id)
    const byLevel1 = suppliesTabList.reduce((acc, s) => {
      const k = level1KeyFn(s)
      if (!acc[k]) acc[k] = []
      acc[k].push(s)
      return acc
    }, {})
    const level1Keys = Object.keys(byLevel1).sort((a, b) =>
      suppliesGroupBy === 'date' ? b.localeCompare(a) : (jobsById[a]?.job_number || '').localeCompare(jobsById[b]?.job_number || '')
    )
    return level1Keys.map(k => {
      const rows = byLevel1[k]
      const subgroups = rows.reduce((acc, s) => {
        const subKey = suppliesGroupBy === 'date' ? `${s.job_id}|${s.employee_id}` : `${s.employee_id}|${s.work_date}`
        if (!acc[subKey]) acc[subKey] = { job_id: s.job_id, employee: s.employees, employee_id: s.employee_id, work_date: s.work_date, items: [] }
        acc[subKey].items.push(s)
        return acc
      }, {})
      const sortedSubgroups = Object.values(subgroups).sort((a, b) =>
        suppliesGroupBy === 'date'
          ? (jobsById[a.job_id]?.job_number || '').localeCompare(jobsById[b.job_id]?.job_number || '') || (a.employee?.name || '').localeCompare(b.employee?.name || '')
          : b.work_date.localeCompare(a.work_date) || (a.employee?.name || '').localeCompare(b.employee?.name || '')
      )
      return { key: k, job: suppliesGroupBy === 'job' ? jobsById[k] : null, workDate: suppliesGroupBy === 'date' ? k : null, subgroups: sortedSubgroups }
    })
  })()

  const [supplySaveStatus, setSupplySaveStatus] = useState({}) // { [id]: 'saving' | 'saved' | 'error' }

  function updateSupplyField(id, field, value) {
    setSupplies(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  async function saveSupplyField(supply, field) {
    if (field === 'quantity') {
      const qty = Number(supply.quantity)
      if (!(qty > 0)) { alert('Quantity must be greater than 0'); return }
    }
    const value = field === 'quantity' ? Number(supply.quantity) : (supply[field] || null)
    setSupplySaveStatus(s => ({ ...s, [supply.id]: 'saving' }))
    const { error } = await supabase.schema('Cores').from('job_supplies').update({ [field]: value }).eq('id', supply.id)
    if (error) {
      alert(`Couldn't save change: ${error.message}`)
      setSupplySaveStatus(s => ({ ...s, [supply.id]: 'error' }))
      return
    }
    setSupplySaveStatus(s => ({ ...s, [supply.id]: 'saved' }))
    setTimeout(() => setSupplySaveStatus(s => (s[supply.id] === 'saved' ? { ...s, [supply.id]: undefined } : s)), 2000)
  }

  async function deleteSupply(supply) {
    if (!confirm(`Delete "${supply.supply_name}" (qty ${Number(supply.quantity)})?`)) return
    const { error } = await supabase.schema('Cores').from('job_supplies').delete().eq('id', supply.id)
    if (error) { alert(`Delete failed: ${error.message}`); return }
    setSupplies(prev => prev.filter(s => s.id !== supply.id))
  }

  function openPhotoGroup(title, photos) {
    setPhotoGroup({ title, photos: [...photos].sort((a, b) => b.created_at.localeCompare(a.created_at)) })
  }

  // Cached on the job (work_summary + the entry count it was generated from) —
  // called on demand rather than automatically so opening a job's report never
  // surprises with an API-call delay unless the summary is actually missing/stale.
  async function summarizeJob(jobId) {
    setSummarizing(true); setSummarizeError('')
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ action: 'summarize_job', job_id: jobId }),
      })
      const data = await res.json()
      if (!data.ok) { setSummarizeError(data.error || 'Summarize failed'); return }
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, work_summary: data.summary, work_summary_entry_count: data.entry_count } : j))
      if (selectedJob?.id === jobId) setSelectedJob(j => ({ ...j, work_summary: data.summary, work_summary_entry_count: data.entry_count }))
    } catch (e) {
      setSummarizeError(e.message)
    } finally {
      setSummarizing(false)
    }
  }

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
  }

  function backLabel() {
    if (!navHistory.length) return '← Back'
    const prev = navHistory[navHistory.length - 1]
    if (prev.selectedJob) return `← ${prev.selectedJob.job_number}`
    if (prev.selectedEmployee) return `← ${prev.selectedEmployee.name}`
    const labels = { jobs: '← Jobs Overview', customer: '← By Customer', vessel: '← By Vessel', employee: '← All Employees', supplies: '← Supplies', payroll: '← Payroll' }
    return labels[prev.activeTab] || '← Back'
  }

  function downloadCSV(rows, filename) {
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))
    link.download = filename
    link.click()
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
          fmtHours(e.hours),
          fmtHours(reg),
          fmtHours(ot),
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
    const employeeThresholds = Object.fromEntries(
      employees
        .filter(e => e.ot_daily_threshold != null || e.ot_friday_threshold != null)
        .map(e => [e.id, { daily: e.ot_daily_threshold, friday: e.ot_friday_threshold }])
    )
    return computeOTMap(entriesToProcess, {
      dailyThreshold:  payrollConfig.daily_ot_threshold  ?? 8,
      weeklyThreshold: payrollConfig.weekly_ot_threshold ?? 40,
      statHolidays,
      employeeThresholds,
    })
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
          fmtHours(hoursPerJob[j.id] || 0),
          fmtHours(regPerJob[j.id] || 0),
          fmtHours(otPerJob[j.id]  || 0),
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
      customers.filter(c => customerFilterIds.length === 0 || customerFilterIds.includes(c.id)).forEach(c =>
        filteredJobs.filter(j => j.customer_id === c.id).forEach(j =>
          rows.push([c.name, j.job_number, j.vessels?.name,
            `"${(j.description || '').replace(/"/g, '""')}"`,
            j.status,
            fmtHours(hoursPerJob[j.id] || 0),
            fmtHours(regPerJob[j.id] || 0),
            fmtHours(otPerJob[j.id]  || 0),
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
      vessels.filter(v => vesselFilterIds.length === 0 || vesselFilterIds.includes(v.id)).forEach(v =>
        filteredJobs.filter(j => j.vessel_id === v.id).forEach(j =>
          rows.push([v.name, j.job_number, j.customers?.name,
            `"${(j.description || '').replace(/"/g, '""')}"`,
            j.status,
            fmtHours(hoursPerJob[j.id] || 0),
            fmtHours(regPerJob[j.id] || 0),
            fmtHours(otPerJob[j.id]  || 0),
            csvDateFrom, csvDateTo,
          ].join(','))
        )
      )
      downloadCSV(rows, `by-vessel-${dateFileSuffix}.csv`)
    } else if (activeTab === 'employee') {
      const rows = ['Employee,Jobs Worked,Total Hours,Reg Hours,OT Hours,Per Diem,Customers,Date From,Date To']
      employees.filter(emp => employeeFilterIds.includes(emp.id)).forEach(emp => {
        const ee = filteredEntries.filter(e => e.employee_id === emp.id)
        if (!ee.length) return
        const empJobs = new Set(ee.map(e => e.job_id))
        const empCusts = new Set(ee.map(e => e.jobs?.customers?.name).filter(Boolean))
        const totalHrs = ee.reduce((s, e) => s + Number(e.hours), 0)
        const totalReg = ee.reduce((s, e) => s + (otMap[e.id]?.reg || 0), 0)
        const totalOT  = ee.reduce((s, e) => s + (otMap[e.id]?.ot  || 0), 0)
        const totalPD  = ee.reduce((s, e) => s + Number(e.per_diem || 0), 0)
        rows.push([emp.name, empJobs.size, fmtHours(totalHrs), fmtHours(totalReg), fmtHours(totalOT), totalPD, `"${[...empCusts].join(', ')}"`, csvDateFrom, csvDateTo].join(','))
      })
      downloadCSV(rows, `employees-${dateFileSuffix}.csv`)
    } else if (activeTab === 'supplies') {
      const rows = ['Job #,Customer,Vessel,Tech,Date,Supply,Qty,Description,Date From,Date To']
      suppliesTabList
        .slice()
        .sort((a, b) => {
          const jobA = jobsById[a.job_id]?.job_number || ''
          const jobB = jobsById[b.job_id]?.job_number || ''
          return jobA.localeCompare(jobB) || a.work_date.localeCompare(b.work_date) || (a.employees?.name || '').localeCompare(b.employees?.name || '')
        })
        .forEach(s => {
          const job = jobsById[s.job_id]
          rows.push([
            job?.job_number || '',
            job?.customers?.name || '',
            job?.vessels?.name || '',
            s.employees?.name || '',
            s.work_date,
            `"${(s.supply_name || '').replace(/"/g, '""')}"`,
            Number(s.quantity),
            `"${(s.description || '').replace(/"/g, '""')}"`,
            csvDateFrom, csvDateTo,
          ].join(','))
        })
      downloadCSV(rows, `supplies-${dateFileSuffix}.csv`)
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

        {(() => {
          // Compares against ALL of the job's entries (unfiltered by the page's
          // date/status filters), matching what the backend actually counts when
          // generating the summary — jobEntries itself is filtered, so comparing
          // against it here would show "stale" for any job with entries outside
          // the currently selected date range.
          const jobTotalEntryCount = entries.filter(e => e.job_id === job.id).length
          const isStale = jobTotalEntryCount > 0 && job.work_summary_entry_count !== jobTotalEntryCount
          const summaryLines = (job.work_summary || '').split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean)
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ color: '#555', margin: 0 }}>What Was Done</h4>
                {jobTotalEntryCount > 0 && (
                  <button onClick={() => summarizeJob(job.id)} disabled={summarizing}
                    style={{ padding: '0.3rem 0.7rem', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: summarizing ? 'default' : 'pointer', fontSize: '0.8rem', color: '#555' }}>
                    {summarizing ? 'Summarizing…' : summaryLines.length > 0 ? '🔄 Refresh summary' : '✨ Generate summary'}
                  </button>
                )}
              </div>
              {summarizeError && <div style={{ color: '#c00', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{summarizeError}</div>}
              {summaryLines.length > 0 ? (
                <ul style={{ ...card, margin: '0 0 2rem', padding: '1rem 1.25rem 1rem 2.25rem' }}>
                  {isStale && (
                    <div style={{ fontSize: '0.78rem', color: '#a06b00', marginBottom: '0.5rem', marginLeft: '-1rem' }}>
                      ⚠️ New work logged since this summary — click Refresh to update.
                    </div>
                  )}
                  {summaryLines.map((line, i) => (
                    <li key={i} style={{ padding: '0.2rem 0' }}>{line}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: '#999', fontSize: '0.9rem', marginBottom: '2rem' }}>
                  {jobTotalEntryCount > 0 ? 'No summary yet — click "Generate summary" above.' : 'Nothing logged yet'}
                </div>
              )}
            </>
          )
        })()}

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
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600 }}>{fmtHours(hours)}</td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#888' }}>{totalJobHours > 0 ? Math.round((hours / totalJobHours) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#555', marginBottom: '0.75rem' }}>Supplies Used</h4>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {[
            { label: 'Total Hours', value: fmtHours(totalJobHours) },
            { label: 'Crew Members', value: Object.keys(crewMap).length },
            { label: 'Days Worked', value: new Set(jobEntries.map(e => e.work_date)).size },
          ].map(({ label, value }) => (
            <div key={label} style={card}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#888', fontSize: '0.9rem' }}>{label}</div>
            </div>
          ))}
        </div>

        <h4 style={{ color: '#555', marginBottom: '0.75rem' }}>Full Work Log</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Employee</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Hours</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left' }}>Description</th>
              <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Photos</th>
            </tr>
          </thead>
          <tbody>
            {jobEntries.sort((a, b) => a.work_date > b.work_date ? 1 : -1).map(e => {
              // Scoped to this exact entry — same employee, same day, same job —
              // not every photo ever taken for this job number (that mixes
              // everyone's photos across every date, which is wrong for a
              // recurring job like SHOP that gets logged constantly).
              const entryPhotos = gearPhotos.filter(p =>
                p.job_id === job.id && p.employee_id === e.employee_id && p.work_date === e.work_date)
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.6rem 0.75rem', color: '#888', whiteSpace: 'nowrap' }}>
                    {new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', ...linkStyle }} onClick={() => goToEmployee(e.employees)}>{e.employees?.name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{e.hours}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: '#555' }}>{e.description}</td>
                  <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                    {entryPhotos.length > 0 ? (
                      <span
                        style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={() => openPhotoGroup(`${job.job_number} — ${e.employees?.name} — ${e.work_date}`, entryPhotos)}
                      >📷 {entryPhotos.length}</span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
            { label: 'Total Hours', value: fmtHours(empTotalHours) },
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
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtHours(hours)} hrs</span>
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
        <div className={activeTab === 'supplies' ? 'no-print' : ''}>
          <h1 style={{ margin: 0 }}>Job Reports</h1>
          <p style={{ color: '#888', margin: '0.25rem 0 0' }}>Cores Worldwide — as of {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
            ['today',     'Today'],
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
        <div className="no-print" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', padding: '0.75rem 1rem', background: '#f8faff', border: '1px solid #d0e0f8', borderRadius: '6px', flexWrap: 'wrap' }}>
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
        <div className="no-print" style={{ marginBottom: '1.25rem', fontSize: '0.85rem', color: '#0066cc' }}>
          Showing: <strong>{dateLabel}</strong>{dateFrom && dateTo && datePreset !== 'custom' ? ` (${dateFrom} – ${dateTo})` : ''}
          {' '}<span onClick={() => applyPreset('all')} style={{ color: '#aaa', cursor: 'pointer', textDecoration: 'underline' }}>clear</span>
        </div>
      )}

      <label className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#555', cursor: 'pointer', marginBottom: '1rem', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={hideEmptyOptions} onChange={e => setHideEmptyOptions(e.target.checked)} />
        Only show items with time logged against them
      </label>

      {/* Tabs */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        {['jobs', 'customer', 'vessel', 'employee', 'supplies'].map(t => tabBtn(t, { jobs: 'Jobs Overview', customer: 'By Customer', vessel: 'By Vessel', employee: 'By Employee', supplies: 'Supplies' }[t]))}
        <div style={{ marginLeft: 'auto', paddingBottom: '0.25rem' }}>
          {activeTab !== 'supplies' && tabExportBtn}
        </div>
      </div>

      {/* ── Jobs Overview ── */}
      {activeTab === 'jobs' && (
        <div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Job #:</label>
              <input type="text" placeholder="Filter by job number..." value={jobNumberFilter} onChange={e => setJobNumberFilter(e.target.value)} style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Customer:</label>
              <MultiSelectDropdown
                options={customers.filter(c => !hideEmptyOptions || jobs.some(j => j.customer_id === c.id && jobIdsWithEntries.has(j.id)))}
                selectedIds={customerFilterIds} onChange={setCustomerFilterIds}
                placeholder="All customers" allLabel="All customers" minWidth={180} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Vessel:</label>
              <MultiSelectDropdown
                options={vessels.filter(v => !hideEmptyOptions || jobs.some(j => j.vessel_id === v.id && jobIdsWithEntries.has(j.id)))}
                selectedIds={vesselFilterIds} onChange={setVesselFilterIds}
                placeholder="All vessels" allLabel="All vessels" minWidth={180} />
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                {jobColumns.map(c => renderSortTh('jobs', c.key, c.label, c.key === 'hours' || c.key === 'status' || c.key === 'photos' ? 'center' : 'left'))}
              </tr>
            </thead>
            <tbody>
              {sortRows('jobs', filteredJobs
                .filter(j => !jobNumberFilter || j.job_number.toString().toLowerCase().includes(jobNumberFilter.toLowerCase()))
                .filter(j => customerFilterIds.length === 0 || customerFilterIds.includes(j.customer_id))
                .filter(j => vesselFilterIds.length === 0 || vesselFilterIds.includes(j.vessel_id)), jobColumns)
                .map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                    <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                    <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                    <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                    <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{fmtHours(hoursPerJob[j.id] || 0)}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      {photosPerJob[j.id] ? (
                        <span
                          style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                          onClick={e => { e.stopPropagation(); openPhotoGroup(j.job_number, gearPhotos.filter(p => p.job_id === j.id)) }}
                        >📷 {photosPerJob[j.id]}</span>
                      ) : '—'}
                    </td>
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
              <MultiSelectDropdown
                options={customers.filter(c => !hideEmptyOptions || jobs.some(j => j.customer_id === c.id && jobIdsWithEntries.has(j.id)))}
                selectedIds={customerFilterIds} onChange={setCustomerFilterIds}
                placeholder="All customers" allLabel="All customers" />
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {jobColumns.map(c => renderSortTh('customer', c.key, c.label, c.key === 'hours' || c.key === 'status' || c.key === 'photos' ? 'center' : 'left'))}
            </tr>
          </thead>
          <tbody>
            {sortRows('customer', filteredJobs.filter(j => customerFilterIds.length === 0 || customerFilterIds.includes(j.customer_id)),
              jobColumns,
              (a, b) => (a.customers?.name || '').localeCompare(b.customers?.name || '') || (a.job_number || '').localeCompare(b.job_number || ''))
              .map(j => (
                <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                  <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                  <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                  <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{fmtHours(hoursPerJob[j.id] || 0)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    {photosPerJob[j.id] ? (
                      <span
                        style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={e => { e.stopPropagation(); openPhotoGroup(j.job_number, gearPhotos.filter(p => p.job_id === j.id)) }}
                      >📷 {photosPerJob[j.id]}</span>
                    ) : '—'}
                  </td>
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
              <MultiSelectDropdown
                options={vessels.filter(v => !hideEmptyOptions || jobs.some(j => j.vessel_id === v.id && jobIdsWithEntries.has(j.id)))}
                selectedIds={vesselFilterIds} onChange={setVesselFilterIds}
                placeholder="All vessels" allLabel="All vessels" />
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {jobColumns.map(c => renderSortTh('vessel', c.key, c.label, c.key === 'hours' || c.key === 'status' || c.key === 'photos' ? 'center' : 'left'))}
            </tr>
          </thead>
          <tbody>
            {sortRows('vessel', filteredJobs.filter(j => vesselFilterIds.length === 0 || vesselFilterIds.includes(j.vessel_id)),
              jobColumns,
              (a, b) => (a.vessels?.name || '').localeCompare(b.vessels?.name || '') || (a.job_number || '').localeCompare(b.job_number || ''))
              .map(j => (
                <tr key={j.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToJob(j)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{j.job_number}</td>
                  <td style={{ padding: '0.75rem' }}>{j.customers?.name}</td>
                  <td style={{ padding: '0.75rem' }}>{j.vessels?.name}</td>
                  <td style={{ padding: '0.75rem', color: '#555' }}>{j.description}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}><span style={badge(j.status)}>{j.status}</span></td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{fmtHours(hoursPerJob[j.id] || 0)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    {photosPerJob[j.id] ? (
                      <span
                        style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={e => { e.stopPropagation(); openPhotoGroup(j.job_number, gearPhotos.filter(p => p.job_id === j.id)) }}
                      >📷 {photosPerJob[j.id]}</span>
                    ) : '—'}
                  </td>
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
              <MultiSelectDropdown
                options={employees.filter(e => !hideEmptyOptions || entries.some(en => en.employee_id === e.id))}
                selectedIds={employeeFilterIds} onChange={setEmployeeFilterIds}
                placeholder="None selected" allLabel="All employees" />
            </div>
          </div>
          {employeeFilterIds.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px' }}>Select one or more employees above</div>
          ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {employeeColumns.map(c => renderSortTh('employee', c.key, c.label, c.key === 'jobs' || c.key === 'hours' || c.key === 'photos' ? 'center' : 'left'))}
            </tr>
          </thead>
          <tbody>
            {sortRows('employee', employeeRows, employeeColumns).map(({ emp, empJobs, empCustomers, empHours }) => (
                <tr key={emp.id} style={{ borderBottom: '1px solid #eee', ...clickRow }} onClick={() => goToEmployee(emp)} onMouseEnter={e => hoverRow(e, true)} onMouseLeave={e => hoverRow(e, false)}>
                  <td style={{ padding: '0.75rem', ...linkStyle }}>{emp.name}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{empJobs.size}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{fmtHours(empHours)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    {photosPerEmployee[emp.id] ? (
                      <span
                        style={{ ...linkStyle, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        onClick={e => { e.stopPropagation(); openPhotoGroup(emp.name, gearPhotos.filter(p => p.employee_id === emp.id)) }}
                      >📷 {photosPerEmployee[emp.id]}</span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '0.75rem', color: '#555', fontSize: '0.9rem' }}>{[...empCustomers].join(', ') || '—'}</td>
                </tr>
            ))}
          </tbody>
        </table>
          )}
        </div>
      )}

      {/* ── Supplies ── */}
      {activeTab === 'supplies' && (
        <div>
          <div className="no-print" style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Job:</label>
              <MultiSelectDropdown
                options={jobs.filter(j => jobIdsWithSupplies.has(j.id)).map(j => ({ id: j.id, name: `${j.job_number} — ${j.customers?.name || ''}` }))}
                selectedIds={suppliesJobFilterIds} onChange={setSuppliesJobFilterIds}
                placeholder="All jobs" allLabel="All jobs" minWidth={220} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: '#555' }}>Tech:</label>
              <MultiSelectDropdown
                options={employees.filter(e => employeeIdsWithSupplies.has(e.id))}
                selectedIds={suppliesEmployeeFilterIds} onChange={setSuppliesEmployeeFilterIds}
                placeholder="All techs" allLabel="All techs" minWidth={180} />
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              {tabExportBtn}
              <button onClick={() => window.print()} style={{ padding: '0.4rem 1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>
                🖨️ Print / Save as PDF
              </button>
            </div>
          </div>

          <div className="no-print" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <span style={{ color: '#888' }}>Group by:</span>
            {[{ key: 'job', label: 'Job' }, { key: 'date', label: 'Date' }].map(o => (
              <span key={o.key}
                onClick={() => setSuppliesGroupBy(o.key)}
                style={{
                  padding: '0.2rem 0.6rem', borderRadius: '4px', cursor: 'pointer', userSelect: 'none',
                  fontWeight: suppliesGroupBy === o.key ? 700 : 400,
                  color: suppliesGroupBy === o.key ? '#0066cc' : '#555',
                  background: suppliesGroupBy === o.key ? '#eaf2fc' : 'transparent',
                }}>
                {o.label}{suppliesGroupBy === o.key ? ' ▾' : ''}
              </span>
            ))}
          </div>

          <div className="no-print" style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#888' }}>
            Edits save automatically when you click out of a field — watch for the "✓ Saved" note on the right of each row.
          </div>

          <div className="print-only" style={{ display: 'none', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Supplies Report</h2>
            <div style={{ color: '#555', fontSize: '0.9rem' }}>Cores Worldwide — {dateLabel}{dateFrom && dateTo ? ` (${dateFrom} – ${dateTo})` : ''}</div>
          </div>

          {suppliesTopGroups.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px' }}>No supplies recorded for this period</div>
          ) : (
            suppliesTopGroups.map(topGroup => (
                  <div key={topGroup.key} className="supplies-job-group" style={{ ...card, marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      {suppliesGroupBy === 'date' ? (
                        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                          {new Date(topGroup.workDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      ) : (
                        <>
                          <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{topGroup.job?.job_number || 'Unknown Job'}</span>
                          <span style={{ color: '#aaa' }}>·</span>
                          <span>{topGroup.job?.customers?.name}</span>
                          <span style={{ color: '#aaa' }}>·</span>
                          <span style={{ color: '#555' }}>{topGroup.job?.vessels?.name}</span>
                        </>
                      )}
                    </div>
                    {topGroup.subgroups
                      .map(group => {
                        const photos = gearPhotos.filter(p => p.job_id === group.job_id && p.employee_id === group.employee_id && p.work_date === group.work_date)
                        const groupKey = `${group.job_id}-${group.employee_id}-${group.work_date}`
                        const isExpanded = expandedSupplyGroups.has(groupKey)
                        return (
                          <div key={groupKey} className="supplies-subgroup" style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid #eee' }}>
                            <div
                              className="no-print"
                              onClick={() => toggleSupplyGroup(groupKey)}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#333', marginBottom: '0.5rem', cursor: 'pointer', userSelect: 'none' }}>
                              <span style={{ color: '#888', fontSize: '0.8rem', width: '0.8rem' }}>{isExpanded ? '▾' : '▸'}</span>
                              <span>
                                {suppliesGroupBy === 'date'
                                  ? `${jobsById[group.job_id]?.job_number || 'Unknown Job'} — ${group.employee?.name || 'Unknown'}`
                                  : `${group.employee?.name || 'Unknown'} — ${new Date(group.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`}
                              </span>
                              <span style={{ color: '#999', fontWeight: 400, fontSize: '0.85rem' }}>
                                {group.items.length} item{group.items.length === 1 ? '' : 's'}{photos.length > 0 ? ` · 📷 ${photos.length}` : ''}
                              </span>
                            </div>
                            <div className="print-only" style={{ display: 'none', fontWeight: 600, color: '#333', marginBottom: '0.5rem' }}>
                              {suppliesGroupBy === 'date'
                                ? `${jobsById[group.job_id]?.job_number || 'Unknown Job'} — ${group.employee?.name || 'Unknown'}`
                                : `${group.employee?.name || 'Unknown'} — ${new Date(group.work_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`}
                            </div>
                            <div className="supplies-detail" style={{ display: isExpanded ? 'block' : 'none' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #ddd' }}>
                                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Supply</th>
                                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'center', fontSize: '0.8rem', color: '#888', width: '80px' }}>Qty</th>
                                  <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', fontSize: '0.8rem', color: '#888' }}>Description</th>
                                  <th className="no-print" style={{ width: '70px' }}></th>
                                  <th className="no-print" style={{ width: '40px' }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map(s => (
                                  <tr key={s.id}>
                                    <td style={{ padding: '0.25rem 0.5rem' }}>
                                      <input value={s.supply_name || ''}
                                        onChange={e => updateSupplyField(s.id, 'supply_name', e.target.value)}
                                        onBlur={() => saveSupplyField(s, 'supply_name')}
                                        className="print-input"
                                        style={{ width: '100%', padding: '0.3rem 0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }} />
                                    </td>
                                    <td style={{ padding: '0.25rem 0.5rem' }}>
                                      <input type="number" step="0.01" value={s.quantity ?? ''}
                                        onChange={e => updateSupplyField(s.id, 'quantity', e.target.value)}
                                        onBlur={() => saveSupplyField(s, 'quantity')}
                                        className="print-input"
                                        style={{ width: '100%', padding: '0.3rem 0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem', textAlign: 'center' }} />
                                    </td>
                                    <td style={{ padding: '0.25rem 0.5rem' }}>
                                      <input value={s.description || ''}
                                        onChange={e => updateSupplyField(s.id, 'description', e.target.value)}
                                        onBlur={() => saveSupplyField(s, 'description')}
                                        className="print-input"
                                        style={{ width: '100%', padding: '0.3rem 0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }} />
                                    </td>
                                    <td className="no-print" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
                                      {supplySaveStatus[s.id] === 'saving' && <span style={{ color: '#999' }}>Saving…</span>}
                                      {supplySaveStatus[s.id] === 'saved' && <span style={{ color: '#2a7a2a', fontWeight: 600 }}>✓ Saved</span>}
                                      {supplySaveStatus[s.id] === 'error' && <span style={{ color: '#c0392b', fontWeight: 600 }}>⚠ Failed</span>}
                                    </td>
                                    <td className="no-print" style={{ textAlign: 'center' }}>
                                      <button onClick={() => deleteSupply(s)} style={{ padding: '0.25rem 0.5rem', background: '#fee', border: '1px solid #fcc', borderRadius: '4px', cursor: 'pointer', color: '#c0392b', fontSize: '0.8rem' }}>✕</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {photos.length > 0 && (
                              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {photos.map(p => (
                                  <div key={p.id} style={{ width: '120px' }}>
                                    <img src={gearPhotoUrl(p.storage_path)} alt="" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '4px', border: '1px solid #eee', display: 'block' }} />
                                  </div>
                                ))}
                              </div>
                            )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
            ))
          )}
        </div>
      )}

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
                      <img src={gearPhotoUrl(p.storage_path)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: '#888' }}>
                      {jobsById[p.job_id]?.job_number ? `${jobsById[p.job_id].job_number} · ` : ''}{employees.find(e => e.id === p.employee_id)?.name || 'Unknown'} · {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
          <img src={gearPhotoUrl(photoLightbox.storage_path)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
        </div>
      )}

    </div>
  )
}
