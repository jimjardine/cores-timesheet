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
  const [selectedEmp, setSelectedEmp] = useState(null) // employee object when drilled in

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

  const timesheetRows = Object.values(
    filteredEntries.reduce((acc, e) => {
      const key = `${e.employee_id}_${e.work_date}`
      if (!acc[key]) acc[key] = { key, employee: e.employees, date: e.work_date, entries: [], hours: 0, jobIds: new Set() }
      acc[key].entries.push(e)
      acc[key].hours += Number(e.hours)
      acc[key].jobIds.add(e.job_id)
      return acc
    }, {})
  ).sort((a, b) => b.date.localeCompare(a.date) || (a.employee?.name || '').localeCompare(b.employee?.name || ''))

  const totalFilteredHours = filteredEntries.reduce((s, e) => s + Number(e.hours), 0)

  function handleExport() {
    const rows = ['Employee,Date,Job,Customer,Hours,Description']
    filteredEntries.forEach(e => {
      rows.push([
        e.employees?.name, e.work_date,
        e.jobs?.job_number, e.jobs?.customers?.name,
        e.hours, `"${(e.description || '').replace(/"/g, '""')}"`
      ].join(','))
    })
    const link = document.createElement('a')
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'))
    link.download = 'timesheets.csv'
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

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>Admin Dashboard</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        <button style={tabStyle('timesheets')} onClick={() => { setActiveTab('timesheets'); setSelectedEmp(null); setFilterEmployee('') }}>Timesheets</button>
        <button style={tabStyle('email')} onClick={() => setActiveTab('email')}>Email Parser</button>
      </div>

      {/* ── Timesheets tab ── */}
      {activeTab === 'timesheets' && (
        <>
          {/* Filters — always visible */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <select value={filterEmployee} onChange={e => {
                const name = e.target.value
                setFilterEmployee(name)
                if (!name) {
                  setSelectedEmp(null)
                } else {
                  const emp = employees.find(em => em.name === name)
                  if (emp) setSelectedEmp(emp)
                }
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
            /* ── Employee detail view — all their entries for the current date range ── */
            const empEntries = filteredEntries  // already filtered to this employee via filterEmployee
            const byDate = Object.values(
              empEntries.reduce((acc, e) => {
                if (!acc[e.work_date]) acc[e.work_date] = { date: e.work_date, entries: [], hours: 0, jobIds: new Set() }
                acc[e.work_date].entries.push(e)
                acc[e.work_date].hours += Number(e.hours)
                acc[e.work_date].jobIds.add(e.job_id)
                return acc
              }, {})
            ).sort((a, b) => b.date.localeCompare(a.date))
            const empTotal = empEntries.reduce((s, e) => s + Number(e.hours), 0)

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  <button onClick={() => { setSelectedEmp(null); setFilterEmployee('') }}
                    style={{ padding: '0.3rem 0.9rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', cursor: 'pointer', color: '#555', fontSize: '0.9rem' }}>
                    ← All employees
                  </button>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{selectedEmp.name}</span>
                  <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{byDate.length} day{byDate.length !== 1 ? 's' : ''} · {empTotal.toFixed(1)} hrs</span>
                  <button onClick={handleExport} style={{ marginLeft: 'auto', padding: '0.35rem 0.9rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Export CSV</button>
                </div>

                {byDate.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No entries for this period.</div>
                ) : byDate.map(day => (
                  <div key={day.date} style={{ marginBottom: '1.25rem', border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', background: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
                      <span style={{ fontWeight: 600, color: '#333' }}>{fmtDate(day.date)}</span>
                      <span style={{ fontWeight: 700, color: '#1a1a2e' }}>{day.hours.toFixed(1)} hrs · {day.jobIds.size} job{day.jobIds.size !== 1 ? 's' : ''}</span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {day.entries.map(e => (
                          <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '0.55rem 0.9rem', ...linkStyle, width: '90px' }}>{e.jobs?.job_number ?? '—'}</td>
                            <td style={{ padding: '0.55rem 0.9rem', color: '#666', width: '160px' }}>{e.jobs?.customers?.name ?? '—'}</td>
                            <td style={{ padding: '0.55rem 0.9rem', color: '#888', width: '120px' }}>{e.jobs?.vessels?.name ?? '—'}</td>
                            <td style={{ padding: '0.55rem 0.9rem', fontWeight: 600, width: '60px' }}>{e.hours}h</td>
                            <td style={{ padding: '0.55rem 0.9rem', color: '#555' }}>{e.description ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )
          })() : (
            /* ── List view ── */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{timesheetRows.length} timesheets</span>
                  <span style={{ color: '#aaa', margin: '0 0.5rem' }}>·</span>
                  <span style={{ color: '#555' }}>{totalFilteredHours.toFixed(1)} hrs total</span>
                </div>
                <button onClick={handleExport} style={{ padding: '0.45rem 1rem', background: '#2d6a38', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }}>Export CSV</button>
              </div>

              {timesheetRows.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No timesheets found for the selected filters.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      {['Employee', 'Date', 'Jobs', 'Hours', ''].map((h, i) => (
                        <th key={i} style={{ padding: '0.75rem', textAlign: h === 'Jobs' || h === 'Hours' ? 'center' : 'left', fontWeight: 600, color: '#555' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timesheetRows.map(row => (
                      <tr key={row.key} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }}
                        onClick={() => {
                          setFilterEmployee(row.employee?.name || '')
                          setSelectedEmp(row.employee)
                        }}
                        onMouseEnter={e => hoverRow(e, true)}
                        onMouseLeave={e => hoverRow(e, false)}>
                        <td style={{ padding: '0.75rem', ...linkStyle }}>{row.employee?.name}</td>
                        <td style={{ padding: '0.75rem', color: '#555' }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', color: '#888' }}>{row.jobIds.size}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>{row.hours.toFixed(1)}</td>
                        <td style={{ padding: '0.75rem', color: '#aaa', fontSize: '0.85rem', textAlign: 'right' }}>view →</td>
                      </tr>
                    ))}
                  </tbody>
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
