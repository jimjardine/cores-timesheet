import React, { useState, useEffect } from 'react'
import { marked } from 'marked'
import { supabase } from '../supabaseClient'
import { fmtHours } from '../utils/format'

const inputStyle = { padding: '0.45rem 0.7rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }
const btnPrimary = { padding: '0.45rem 1.1rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }
const btnSecondary = { padding: '0.45rem 1.1rem', background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' }
const btnDanger = { padding: '0.3rem 0.8rem', background: '#fff', color: '#c0392b', border: '1px solid #e0b0b0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }
const pill = (active) => ({
  padding: '0.4rem 1rem', fontSize: '0.875rem', border: '1.5px solid',
  borderColor: active ? '#0066cc' : '#d1d5db', borderRadius: '999px', cursor: 'pointer',
  background: active ? '#0066cc' : '#fff', color: active ? '#fff' : '#555',
  fontWeight: active ? 700 : 400, transition: 'all 0.15s',
})

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: '8px', padding: '2rem', width: '100%', maxWidth: '480px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#aaa', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.85rem', color: '#555', marginBottom: '0.3rem', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

export default function AdminPanel() {
  const [section, setSection] = useState('customers')
  const [customers, setCustomers] = useState([])
  const [vessels, setVessels] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState([])

  // ── Tech docs (manual + cheat sheet) ──
  const [docModal, setDocModal] = useState(null) // { title, url } | null
  const [docHtmlCache, setDocHtmlCache] = useState({})

  function openDoc(title, url) {
    setDocModal({ title, url })
    if (!docHtmlCache[url]) {
      fetch(url)
        .then(res => res.text())
        .then(text => setDocHtmlCache(c => ({ ...c, [url]: marked.parse(text) })))
        .catch(() => setDocHtmlCache(c => ({ ...c, [url]: '<p>Could not load this document.</p>' })))
    }
  }
  const [empStatusFilter, setEmpStatusFilter] = useState('active')
  const [empRoleFilter, setEmpRoleFilter] = useState('technician')
  const [modal, setModal] = useState(null) // { type: 'customer'|'vessel'|'job'|'employee', record: null|{...} }
  const [fields, setFields] = useState({})
  const [statusModal, setStatusModal] = useState(null) // { job, action: 'close'|'reopen' }
  const [statusNote, setStatusNote] = useState('')
  const [quickAdd, setQuickAdd] = useState(null) // 'customer' | 'vessel'
  const [quickAddName, setQuickAddName] = useState('')
  const [jobStatusFilter, setJobStatusFilter] = useState('open')
  const [customerFilter, setCustomerFilter] = useState('')
  const [vesselFilter, setVesselFilter] = useState('')
  const [customerStatusFilter, setCustomerStatusFilter] = useState('active')
  const [vesselStatusFilter, setVesselStatusFilter] = useState('active')
  const [jobSearch, setJobSearch] = useState('')
  const [sortCol, setSortCol] = useState('job_number')
  const [sortDir, setSortDir] = useState('asc')
  const [expandedId, setExpandedId] = useState(null)
  const [expandedVesselId, setExpandedVesselId] = useState(null)
  const [expandedJobId, setExpandedJobId] = useState(null)
  const [jobLogs, setJobLogs] = useState([])
  const [jobEntries, setJobEntries] = useState({}) // { [jobId]: entries[] }
  const [vesselContacts, setVesselContacts] = useState([])
  const [modalContacts, setModalContacts] = useState([]) // contacts being edited in vessel modal

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!expandedJobId || jobEntries[expandedJobId]) return
    supabase
      .schema('Cores').from('timesheet_entries')
      .select('*, employees(name)')
      .eq('job_id', expandedJobId)
      .order('work_date')
      .order('sort_order')
      .then(({ data }) => setJobEntries(prev => ({ ...prev, [expandedJobId]: data || [] })))
  }, [expandedJobId, jobEntries])

  async function loadAll() {
    setLoading(true)
    const [c, v, j, l, vc, em] = await Promise.all([
      supabase.schema('Cores').from('customers').select('*').order('name'),
      supabase.schema('Cores').from('vessels').select('*, customers(name)').order('name'),
      supabase.schema('Cores').from('jobs').select('*, customers(name), vessels(name)').order('job_number'),
      supabase.schema('Cores').from('job_status_logs').select('*').order('created_at'),
      supabase.schema('Cores').from('vessel_contacts').select('*').order('sort_order'),
      supabase.schema('Cores').from('employees').select('*').order('name'),
    ])
    setCustomers(c.data || [])
    setVessels(v.data || [])
    setJobs(j.data || [])
    setJobLogs(l.data || [])
    setVesselContacts(vc.data || [])
    setEmployees(em.data || [])
    setLoading(false)
  }

  function openModal(type, record = null) {
    setModal({ type, record })
    if (type === 'customer') {
      setFields({ name: record?.name || '', contact_name: record?.contact_name || '', contact_email: record?.contact_email || '', phone: record?.phone || '', status: record?.status || 'active' })
    } else if (type === 'vessel') {
      setFields({ name: record?.name || '', vessel_type: record?.vessel_type || '', customer_id: record?.customer_id || '', status: record?.status || 'active' })
      const existing = record ? vesselContacts.filter(c => c.vessel_id === record.id) : []
      setModalContacts(existing.length > 0 ? existing.map(c => ({ ...c })) : [
        { role: 'Superintendent', name: '', phone: '' },
        { role: 'Captain', name: '', phone: '' },
      ])
    } else if (type === 'job') {
      setFields({ job_number: record?.job_number || '', customer_id: record?.customer_id || '', vessel_id: record?.vessel_id || '', description: record?.description || '', status: record?.status || 'open', work_order_number: record?.work_order_number || '' })
    } else if (type === 'employee') {
      setFields({ name: record?.name || '', phone: record?.phone || '', whatsapp_phone: record?.whatsapp_phone || '', active: record != null ? String(record.active) : 'true', role: record?.role || 'technician' })
    } else if (type === 'entry') {
      setFields({ work_date: record?.work_date || '', job_id: record?.job_id || '', hours: record?.hours ?? '', ot_hours: record?.ot_hours ?? '', per_diem: record?.per_diem ?? '0', description: record?.description || '' })
    }
  }

  async function save() {
    setSaving(true)
    const { type, record } = modal
    const payload = { ...fields }

    if (type === 'vessel') {
      if (!payload.customer_id) payload.customer_id = null
      let vesselId = record?.id
      if (record) {
        const { error } = await supabase.schema('Cores').from('vessels').update(payload).eq('id', record.id)
        if (error) { alert(`Save failed: ${error.message}`); setSaving(false); return }
      } else {
        const { data, error } = await supabase.schema('Cores').from('vessels').insert(payload).select().single()
        if (error || !data) { alert(`Save failed: ${error?.message || 'no data returned'}`); setSaving(false); return }
        vesselId = data.id
      }
      // Sync contacts: replace all
      const { error: delError } = await supabase.schema('Cores').from('vessel_contacts').delete().eq('vessel_id', vesselId)
      if (delError) { alert(`Vessel saved but contacts failed to update: ${delError.message}`); setSaving(false); return }
      const valid = modalContacts.filter(c => c.name?.trim() || c.phone?.trim())
      if (valid.length > 0) {
        const { error: insError } = await supabase.schema('Cores').from('vessel_contacts').insert(
          valid.map((c, i) => ({ vessel_id: vesselId, role: c.role || 'Contact', name: c.name || null, phone: c.phone || null, sort_order: i }))
        )
        if (insError) { alert(`Vessel saved but contacts failed to save — re-enter them: ${insError.message}`); setSaving(false); return }
      }
    } else if (type === 'employee') {
      const empPayload = {
        name: payload.name.trim(),
        phone: payload.phone.replace(/\D/g, '').slice(-10) || null,
        whatsapp_phone: (payload.whatsapp_phone || '').replace(/\D/g, '').slice(-10) || null,
        active: payload.active === 'true',
        role: payload.role,
      }
      const { error } = record
        ? await supabase.schema('Cores').from('employees').update(empPayload).eq('id', record.id)
        : await supabase.schema('Cores').from('employees').insert(empPayload)
      if (error) { alert(`Save failed: ${error.message}`); setSaving(false); return }
    } else if (type === 'entry') {
      const entryPayload = {
        work_date: payload.work_date,
        job_id: payload.job_id || null,
        hours: Number(payload.hours) || 0,
        ot_hours: payload.ot_hours === '' || payload.ot_hours == null ? null : Number(payload.ot_hours),
        per_diem: Number(payload.per_diem) || 0,
        description: payload.description || '',
      }
      const { error } = await supabase.schema('Cores').from('timesheet_entries').update(entryPayload).eq('id', record.id)
      if (error) {
        alert(`Save failed: ${error.message}`)
        setSaving(false)
        return
      }
      setJobEntries({}) // job assignment may have changed — drop the per-job cache so it reloads
    } else {
      if (type === 'job') {
        if (!payload.vessel_id) payload.vessel_id = null
        if (!payload.customer_id) payload.customer_id = null
        if (payload.status === 'closed' && record?.status !== 'closed') payload.closed_at = new Date().toISOString()
        if (payload.status === 'open') payload.closed_at = null
      }
      const { error } = record
        ? await supabase.schema('Cores').from(`${type}s`).update(payload).eq('id', record.id)
        : await supabase.schema('Cores').from(`${type}s`).insert(payload)
      if (error) { alert(`Save failed: ${error.message}`); setSaving(false); return }
    }

    await loadAll()
    setModal(null)
    setSaving(false)
  }

  function promptStatusChange(job, action) {
    setStatusNote('')
    setStatusModal({ job, action })
  }

  async function confirmStatusChange() {
    if (!statusNote.trim()) return
    const { job, action } = statusModal
    setSaving(true)
    const toStatus = action === 'close' ? 'closed' : 'open'
    const update = toStatus === 'closed'
      ? { status: 'closed', closed_at: new Date().toISOString() }
      : { status: 'open', closed_at: null }
    const { error: jobError } = await supabase.schema('Cores').from('jobs').update(update).eq('id', job.id)
    if (jobError) { alert(`Status change failed: ${jobError.message}`); setSaving(false); return }
    const { error: logError } = await supabase.schema('Cores').from('job_status_logs').insert({
      job_id: job.id,
      from_status: job.status,
      to_status: toStatus,
      note: statusNote.trim(),
    })
    if (logError) alert(`Job status changed but the log entry failed: ${logError.message}`)
    await loadAll()
    setStatusModal(null)
    setSaving(false)
  }

  async function saveQuickAdd() {
    if (!quickAddName.trim()) return
    setSaving(true)
    const payload = quickAdd === 'customer'
      ? { name: quickAddName.trim(), status: 'active' }
      : { name: quickAddName.trim(), customer_id: fields.customer_id || null }
    const table = quickAdd === 'customer' ? 'customers' : 'vessels'
    const { data, error } = await supabase.schema('Cores').from(table).insert(payload).select().single()
    if (error) alert(`Save failed: ${error.message}`)
    if (data) {
      if (quickAdd === 'customer') {
        setCustomers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
        setFields(p => ({ ...p, customer_id: data.id, vessel_id: '' }))
      } else {
        setVessels(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
        setFields(p => ({ ...p, vessel_id: data.id }))
      }
    }
    setQuickAdd(null)
    setQuickAddName('')
    setSaving(false)
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const f = (key) => ({ value: fields[key] ?? '', onChange: e => setFields(p => ({ ...p, [key]: e.target.value })) })

  const tabStyle = (s) => ({
    padding: '0.5rem 1.2rem', border: 'none', cursor: 'pointer', fontSize: '0.95rem', background: 'none',
    borderBottom: section === s ? '3px solid #0066cc' : '3px solid transparent',
    fontWeight: section === s ? 700 : 400, color: section === s ? '#0066cc' : '#555',
  })

  const thStyle = { padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#555', borderBottom: '2px solid #ddd', background: '#f5f5f5' }
  const tdStyle = { padding: '0.75rem', borderBottom: '1px solid #eee', color: '#333' }

  const visibleJobs = (() => {
    const q = jobSearch.trim().toLowerCase()
    const filtered = jobs.filter(j => {
      if (jobStatusFilter !== 'all' && j.status !== jobStatusFilter) return false
      if (customerFilter && j.customer_id !== customerFilter) return false
      if (vesselFilter && j.vessel_id !== vesselFilter) return false
      if (q && !j.job_number?.toLowerCase().includes(q) && !j.description?.toLowerCase().includes(q)
            && !j.customers?.name?.toLowerCase().includes(q) && !j.vessels?.name?.toLowerCase().includes(q)) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      let av, bv
      if (sortCol === 'job_number') { av = a.job_number; bv = b.job_number }
      else if (sortCol === 'customer') { av = a.customers?.name || ''; bv = b.customers?.name || '' }
      else if (sortCol === 'vessel') { av = a.vessels?.name || ''; bv = b.vessels?.name || '' }
      else if (sortCol === 'work_order_number') { av = a.work_order_number || ''; bv = b.work_order_number || '' }
      else if (sortCol === 'description') { av = a.description || ''; bv = b.description || '' }
      else if (sortCol === 'status') { av = a.status; bv = b.status }
      else { av = a.job_number; bv = b.job_number }
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  })()

  const visibleVessels = vessels.filter(v =>
    (!customerFilter || v.customer_id === customerFilter) &&
    (vesselStatusFilter === 'all' || (v.status || 'active') === vesselStatusFilter)
  )

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa' }}>Loading...</div>

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={{ marginTop: 0 }}>Admin</h1>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
          <button onClick={() => openDoc('Tech Manual', '/SMS_USER_MANUAL.md')} style={{ fontSize: '0.9rem', color: '#0066cc', fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
            📖 Tech Manual
          </button>
          <button onClick={() => openDoc('Cheat Sheet', '/SMS_CHEAT_SHEET.md')} style={{ fontSize: '0.85rem', color: '#0066cc', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}>
            📋 Cheat Sheet
          </button>
        </div>
      </div>

      {docModal && (
        <div onClick={() => setDocModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '8px', width: '680px', maxWidth: '95vw', maxHeight: '85vh', margin: '2rem auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid #eee' }}>
              <strong>{docModal.title}</strong>
              <button onClick={() => setDocModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.3rem', color: '#888', padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div
              className="manual-doc"
              style={{ padding: '1.5rem', overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: docHtmlCache[docModal.url] || '' }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: '2rem' }}>
        {[['customers', 'Customers'], ['vessels', 'Vessels'], ['jobs', 'Jobs'], ['employees', 'Employees']].map(([key, label]) => (
          <button key={key} style={tabStyle(key)} onClick={() => setSection(key)}>{label}</button>
        ))}
      </div>

      {/* ── Jobs ── */}
      {section === 'jobs' && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {/* Row 1: search + new job */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <input
                value={jobSearch} onChange={e => setJobSearch(e.target.value)}
                placeholder="Search job #, description, customer, vessel…"
                style={{ ...inputStyle, flex: 1, maxWidth: '380px' }}
              />
              {jobSearch && (
                <button onClick={() => setJobSearch('')} style={{ ...btnSecondary, fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}>Clear</button>
              )}
              <button style={{ ...btnPrimary, marginLeft: 'auto' }} onClick={() => openModal('job')}>+ New Job</button>
            </div>
            {/* Row 2: dropdowns + status pills */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={customerFilter} onChange={e => { setCustomerFilter(e.target.value); setVesselFilter('') }}
                style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem' }}>
                <option value="">All customers</option>
                {customers.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={vesselFilter} onChange={e => setVesselFilter(e.target.value)}
                style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem' }}>
                <option value="">All vessels</option>
                {vessels
                  .filter(v => v.status === 'active' && (!customerFilter || v.customer_id === customerFilter))
                  .map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.4rem', marginLeft: '0.25rem' }}>
                {['open', 'closed', 'all'].map(s => (
                  <button key={s} style={pill(jobStatusFilter === s)} onClick={() => setJobStatusFilter(s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: '#aaa' }}>
                {visibleJobs.length} job{visibleJobs.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {visibleJobs.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#aaa', border: '1px solid #eee', borderRadius: '6px' }}>No jobs found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[['customer','Customer'],['vessel','Vessel'],['job_number','Job #'],['work_order_number','WO #'],['description','Description']].map(([col, label]) => (
                    <th key={col} style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => toggleSort(col)}>
                      {label} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ color: '#ccc' }}>↕</span>}
                    </th>
                  ))}
                  <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>
                    Status {sortCol === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : <span style={{ color: '#ccc' }}>↕</span>}
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map(job => {
                  const isExpanded = expandedJobId === job.id
                  const logs = jobLogs.filter(l => l.job_id === job.id)
                  return (
                    <React.Fragment key={job.id}>
                      <tr style={{ background: job.status === 'closed' ? '#fafafa' : '', cursor: 'pointer' }}
                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}>
                        <td style={{ ...tdStyle, color: '#555' }}>
                          <span style={{ marginRight: '0.4rem', color: '#aaa', fontSize: '0.8rem' }}>{isExpanded ? '▾' : '▸'}</span>
                          {job.customers?.name || '—'}
                        </td>
                        <td style={{ ...tdStyle, color: '#555' }}>
                          {job.vessels?.name || <span style={{ padding: '0.15rem 0.5rem', background: '#f0f0f0', borderRadius: '10px', fontSize: '0.78rem', color: '#888', fontWeight: 600 }}>Shop</span>}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600, color: '#0066cc', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openModal('job', job) }}>{job.job_number}</td>
                        <td style={{ ...tdStyle, color: '#555' }}>{job.work_order_number || '—'}</td>
                        <td style={{ ...tdStyle, color: '#555', maxWidth: '260px' }}>{job.description || '—'}</td>
                        <td style={tdStyle}>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: job.status === 'open' ? '#e6f4ea' : '#f0f0f0', color: job.status === 'open' ? '#2d6a38' : '#888' }}>
                            {job.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.7rem', marginRight: '0.4rem' }} onClick={() => openModal('job', job)}>Edit</button>
                          {job.status === 'open'
                            ? <button style={btnDanger} onClick={() => promptStatusChange(job, 'close')}>Close</button>
                            : <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} onClick={() => promptStatusChange(job, 'reopen')}>Reopen</button>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, background: '#f8faff', borderBottom: '2px solid #dde8f8' }}>
                            {/* Timesheet entries */}
                            <div style={{ padding: '0.75rem 1.5rem 0 1.5rem' }}>
                              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Timesheet Entries</div>
                              {!jobEntries[job.id] ? (
                                <div style={{ color: '#bbb', fontSize: '0.875rem', marginBottom: '0.75rem' }}>Loading…</div>
                              ) : jobEntries[job.id].length === 0 ? (
                                <div style={{ color: '#bbb', fontSize: '0.875rem', marginBottom: '0.75rem' }}>No entries logged against this job</div>
                              ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
                                  <thead>
                                    <tr style={{ background: '#eef3fb' }}>
                                      {['Date', 'Employee', 'Hours', 'OT', 'Per Diem', 'Description'].map(h => (
                                        <th key={h} style={{ ...thStyle, background: 'none', fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {jobEntries[job.id].map(e => (
                                      <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => openModal('entry', e)} onMouseEnter={evt => evt.currentTarget.style.background = '#f5f9ff'} onMouseLeave={evt => evt.currentTarget.style.background = ''}>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', whiteSpace: 'nowrap', padding: '0.4rem 0.6rem' }}>
                                          {new Date(e.work_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>{e.employees?.name || '—'}</td>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>{fmtHours(e.hours)}</td>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', padding: '0.4rem 0.6rem', color: e.ot_hours != null ? '#c0392b' : '#bbb' }}>
                                          {e.ot_hours != null ? fmtHours(e.ot_hours) : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}>
                                          {e.per_diem > 0 ? `×${Number(e.per_diem)}` : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: '0.85rem', color: '#555', padding: '0.4rem 0.6rem' }}>{e.description || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr style={{ background: '#f0f4fc', fontWeight: 700 }}>
                                      <td colSpan={2} style={{ ...tdStyle, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>Total ({jobEntries[job.id].length} entries)</td>
                                      <td style={{ ...tdStyle, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>{fmtHours(jobEntries[job.id].reduce((s, e) => s + Number(e.hours), 0))}</td>
                                      <td style={{ ...tdStyle, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}></td>
                                      <td style={{ ...tdStyle, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>
                                        {jobEntries[job.id].some(e => e.per_diem > 0) ? `×${jobEntries[job.id].reduce((s, e) => s + Number(e.per_diem || 0), 0)}` : '—'}
                                      </td>
                                      <td style={{ ...tdStyle, padding: '0.4rem 0.6rem' }}></td>
                                    </tr>
                                  </tfoot>
                                </table>
                              )}
                            </div>
                            {/* Status history */}
                            {logs.length > 0 && (
                              <div style={{ padding: '0.5rem 1.5rem 0.75rem 1.5rem', borderTop: '1px solid #e4ecf8' }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Status History</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                  {logs.map(l => (
                                    <div key={l.id} style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', fontSize: '0.875rem' }}>
                                      <span style={{ color: '#aaa', whiteSpace: 'nowrap', minWidth: '9rem' }}>
                                        {new Date(l.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
                                      </span>
                                      <span style={{ whiteSpace: 'nowrap' }}>
                                        <span style={{ padding: '0.1rem 0.4rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: '#f0f0f0', color: '#888' }}>{l.from_status}</span>
                                        <span style={{ color: '#aaa', margin: '0 0.3rem' }}>→</span>
                                        <span style={{ padding: '0.1rem 0.4rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: l.to_status === 'open' ? '#e6f4ea' : '#fde8e8', color: l.to_status === 'open' ? '#2d6a38' : '#c0392b' }}>{l.to_status}</span>
                                      </span>
                                      <span style={{ color: '#555' }}>{l.note}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Customers ── */}
      {section === 'customers' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['active', 'inactive', 'all'].map(s => (
                <button key={s} style={pill(customerStatusFilter === s)} onClick={() => setCustomerStatusFilter(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button style={btnPrimary} onClick={() => openModal('customer')}>+ New Customer</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Contact</th>
                <th style={thStyle}>Email</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Jobs</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {customers
                .filter(c => customerStatusFilter === 'all' || (c.status || 'active') === customerStatusFilter)
                .map(c => {
                const custJobs = jobs.filter(j => j.customer_id === c.id && (jobStatusFilter === 'all' || j.status === jobStatusFilter))
                const isExpanded = expandedId === c.id
                return (
                  <React.Fragment key={c.id}>
                    <tr style={{ background: c.status !== 'active' ? '#fafafa' : '', cursor: 'pointer' }}
                      onClick={() => { setExpandedId(isExpanded ? null : c.id); setExpandedVesselId(null) }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        <span style={{ marginRight: '0.4rem', color: '#aaa', fontSize: '0.8rem' }}>{isExpanded ? '▾' : '▸'}</span>
                        {c.name}
                      </td>
                      <td style={{ ...tdStyle, color: '#555' }}>{c.contact_name || '—'}</td>
                      <td style={{ ...tdStyle, color: '#555' }}>{c.contact_email || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {custJobs.length > 0
                          ? <span style={{ padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600, background: '#e8eef8', color: '#0055aa' }}>{custJobs.length}</span>
                          : <span style={{ color: '#ddd' }}>—</span>}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: c.status === 'active' ? '#e6f4ea' : '#f0f0f0', color: c.status === 'active' ? '#2d6a38' : '#888' }}>
                          {c.status || 'active'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} onClick={() => openModal('customer', c)}>Edit</button>
                      </td>
                    </tr>
                    {isExpanded && (() => {
                      const custVessels = vessels.filter(v => v.customer_id === c.id)
                      const shopJobs = jobs.filter(j => j.customer_id === c.id && !j.vessel_id && (jobStatusFilter === 'all' || j.status === jobStatusFilter))
                      return (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, background: '#f8faff', borderBottom: '1px solid #dde8f8' }}>
                            {custVessels.length === 0 && shopJobs.length === 0 && (
                              <div style={{ padding: '0.75rem 2rem', color: '#aaa', fontSize: '0.875rem' }}>No vessels or jobs</div>
                            )}
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <tbody>
                                {custVessels.map(v => {
                                  const vExpanded = expandedVesselId === v.id
                                  const vJobs = jobs.filter(j => j.vessel_id === v.id && (jobStatusFilter === 'all' || j.status === jobStatusFilter))
                                  return (
                                    <React.Fragment key={v.id}>
                                      <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedVesselId(vExpanded ? null : v.id)}>
                                        <td colSpan={3} style={{ padding: '0.6rem 0.75rem 0.6rem 2.5rem', fontWeight: 700, fontSize: '0.875rem', color: '#0066cc', borderBottom: '1px solid #e8eef8' }}>
                                          <span style={{ marginRight: '0.4rem', color: '#aaa', fontSize: '0.8rem' }}>{vExpanded ? '▾' : '▸'}</span>
                                          {v.name}
                                          {v.vessel_type && <span style={{ fontWeight: 400, color: '#888', marginLeft: '0.5rem', fontSize: '0.8rem' }}>{v.vessel_type}</span>}
                                          <span style={{ marginLeft: '0.75rem', fontWeight: 400, color: '#aaa', fontSize: '0.78rem' }}>{vJobs.length} job{vJobs.length !== 1 ? 's' : ''}</span>
                                        </td>
                                      </tr>
                                      {vExpanded && vJobs.map(j => (
                                        <tr key={j.id} style={{ background: '#f0f5ff' }}>
                                          <td style={{ ...tdStyle, fontWeight: 600, fontSize: '0.875rem', paddingLeft: '4rem' }}>{j.job_number}</td>
                                          <td style={{ ...tdStyle, color: '#555', fontSize: '0.875rem' }}>{j.description || '—'}</td>
                                          <td style={{ ...tdStyle, fontSize: '0.875rem' }}>
                                            <span style={{ padding: '0.15rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600, background: j.status === 'open' ? '#e6f4ea' : '#f0f0f0', color: j.status === 'open' ? '#2d6a38' : '#888' }}>{j.status}</span>
                                          </td>
                                        </tr>
                                      ))}
                                      {vExpanded && vJobs.length === 0 && (
                                        <tr><td colSpan={3} style={{ ...tdStyle, paddingLeft: '4rem', color: '#aaa', fontSize: '0.875rem' }}>No jobs</td></tr>
                                      )}
                                    </React.Fragment>
                                  )
                                })}
                                {shopJobs.length > 0 && (
                                  <React.Fragment>
                                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedVesselId(expandedVesselId === 'shop' ? null : 'shop')}>
                                      <td colSpan={3} style={{ padding: '0.6rem 0.75rem 0.6rem 2.5rem', fontWeight: 700, fontSize: '0.875rem', color: '#888', borderBottom: '1px solid #e8eef8' }}>
                                        <span style={{ marginRight: '0.4rem', color: '#aaa', fontSize: '0.8rem' }}>{expandedVesselId === 'shop' ? '▾' : '▸'}</span>
                                        Shop Jobs
                                        <span style={{ marginLeft: '0.75rem', fontWeight: 400, color: '#aaa', fontSize: '0.78rem' }}>{shopJobs.length} job{shopJobs.length !== 1 ? 's' : ''}</span>
                                      </td>
                                    </tr>
                                    {expandedVesselId === 'shop' && shopJobs.map(j => (
                                      <tr key={j.id} style={{ background: '#f0f5ff' }}>
                                        <td style={{ ...tdStyle, fontWeight: 600, fontSize: '0.875rem', paddingLeft: '4rem' }}>{j.job_number}</td>
                                        <td style={{ ...tdStyle, color: '#555', fontSize: '0.875rem' }}>{j.description || '—'}</td>
                                        <td style={{ ...tdStyle, fontSize: '0.875rem' }}>
                                          <span style={{ padding: '0.15rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600, background: j.status === 'open' ? '#e6f4ea' : '#f0f0f0', color: j.status === 'open' ? '#2d6a38' : '#888' }}>{j.status}</span>
                                        </td>
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )
                    })()}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Vessels ── */}
      {section === 'vessels' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
                style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem' }}>
                <option value="">All customers</option>
                {customers.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {['active', 'inactive', 'all'].map(s => (
                  <button key={s} style={pill(vesselStatusFilter === s)} onClick={() => setVesselStatusFilter(s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <button style={btnPrimary} onClick={() => openModal('vessel')}>+ New Vessel</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Customer</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Open</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Closed</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleVessels.map(v => {
                const openJobs   = jobs.filter(j => j.vessel_id === v.id && j.status === 'open')
                const closedJobs = jobs.filter(j => j.vessel_id === v.id && j.status === 'closed')
                const vesselJobs = jobs.filter(j => j.vessel_id === v.id && (jobStatusFilter === 'all' || j.status === jobStatusFilter))
                const isExpanded = expandedId === v.id
                return (
                  <React.Fragment key={v.id}>
                    <tr style={{ background: v.status !== 'active' ? '#fafafa' : '', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : v.id)}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        <span style={{ marginRight: '0.4rem', color: '#aaa', fontSize: '0.8rem' }}>{isExpanded ? '▾' : '▸'}</span>
                        {v.name}
                      </td>
                      <td style={{ ...tdStyle, color: '#555' }}>{v.vessel_type || '—'}</td>
                      <td style={{ ...tdStyle, color: '#555' }}>{v.customers?.name || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {openJobs.length > 0
                          ? <span style={{ padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600, background: '#e6f4ea', color: '#2d6a38' }}>{openJobs.length}</span>
                          : <span style={{ color: '#ddd' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {closedJobs.length > 0
                          ? <span style={{ padding: '0.15rem 0.55rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600, background: '#f0f0f0', color: '#888' }}>{closedJobs.length}</span>
                          : <span style={{ color: '#ddd' }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: v.status === 'active' ? '#e6f4ea' : '#f0f0f0', color: v.status === 'active' ? '#2d6a38' : '#888' }}>
                          {v.status || 'active'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} onClick={() => openModal('vessel', v)}>Edit</button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0, background: '#f8faff', borderBottom: '1px solid #dde8f8' }}>
                          {vesselJobs.length === 0 ? (
                            <div style={{ padding: '0.75rem 2rem', color: '#aaa', fontSize: '0.875rem' }}>No open jobs</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#eef3fb' }}>
                                  <th style={{ ...thStyle, background: 'none', fontSize: '0.8rem', paddingLeft: '2.5rem' }}>Job #</th>
                                  <th style={{ ...thStyle, background: 'none', fontSize: '0.8rem' }}>Description</th>
                                  <th style={{ ...thStyle, background: 'none', fontSize: '0.8rem' }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {vesselJobs.map(j => (
                                  <tr key={j.id}>
                                    <td style={{ ...tdStyle, fontWeight: 600, fontSize: '0.875rem', paddingLeft: '2.5rem' }}>{j.job_number}</td>
                                    <td style={{ ...tdStyle, color: '#555', fontSize: '0.875rem' }}>{j.description || '—'}</td>
                                    <td style={{ ...tdStyle, fontSize: '0.875rem' }}>
                                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 600, background: j.status === 'open' ? '#e6f4ea' : '#f0f0f0', color: j.status === 'open' ? '#2d6a38' : '#888' }}>{j.status}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Employees ── */}
      {section === 'employees' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['technician', 'office', 'all'].map(r => (
                <button key={r} style={pill(empRoleFilter === r)} onClick={() => setEmpRoleFilter(r)}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
              <span style={{ margin: '0 0.5rem', color: '#ddd' }}>|</span>
              {['active', 'all'].map(s => (
                <button key={s} style={pill(empStatusFilter === s)} onClick={() => setEmpStatusFilter(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button style={btnPrimary} onClick={() => openModal('employee')}>+ New Employee</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Cell</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {employees
                .filter(e => (empStatusFilter === 'all' || e.active) && (empRoleFilter === 'all' || e.role === empRoleFilter))
                .map(e => {
                  const phone = e.phone ? e.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : null
                  return (
                    <tr key={e.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{e.name}</td>
                      <td style={{ ...tdStyle, color: phone ? '#333' : '#bbb', fontFamily: 'monospace' }}>{phone || 'No number'}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: e.role === 'technician' ? '#e8eef8' : '#f5f0ff', color: e.role === 'technician' ? '#0055aa' : '#6b21a8' }}>
                          {e.role || 'technician'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: e.active ? '#e6f4ea' : '#f0f0f0', color: e.active ? '#2d6a38' : '#888' }}>
                          {e.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button style={{ ...btnSecondary, fontSize: '0.8rem', padding: '0.25rem 0.7rem' }} onClick={() => openModal('employee', e)}>Edit</button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === 'customer' && (
        <Modal title={modal.record ? 'Edit Customer' : 'New Customer'} onClose={() => setModal(null)}>
          <Field label="Company Name"><input style={inputStyle} {...f('name')} /></Field>
          <Field label="Contact Name"><input style={inputStyle} {...f('contact_name')} /></Field>
          <Field label="Contact Email"><input type="email" style={inputStyle} {...f('contact_email')} /></Field>
          <Field label="Phone"><input type="tel" style={inputStyle} {...f('phone')} placeholder="e.g. 902-555-1234" /></Field>
          <Field label="Status">
            <select style={inputStyle} {...f('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button style={btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'vessel' && (
        <Modal title={modal.record ? 'Edit Vessel' : 'New Vessel'} onClose={() => setModal(null)}>
          <Field label="Vessel Name"><input style={inputStyle} {...f('name')} /></Field>
          <Field label="Type (e.g. MV, Tug, Barge)"><input style={inputStyle} {...f('vessel_type')} /></Field>
          <Field label="Customer">
            <select style={inputStyle} {...f('customer_id')}>
              <option value="">— none —</option>
              {customers.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select style={inputStyle} {...f('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>

          {/* Contacts */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#555' }}>Contacts</label>
              <button type="button" style={{ ...btnSecondary, fontSize: '0.78rem', padding: '0.2rem 0.6rem' }}
                onClick={() => setModalContacts(p => [...p, { role: '', name: '', phone: '' }])}>
                + Add Contact
              </button>
            </div>
            {modalContacts.length === 0 && (
              <div style={{ color: '#bbb', fontSize: '0.85rem', marginBottom: '0.5rem' }}>No contacts yet</div>
            )}
            {modalContacts.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr auto', gap: '0.4rem', marginBottom: '0.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: '#aaa', paddingLeft: '0.1rem' }}>Role</div>
                <div style={{ fontSize: '0.72rem', color: '#aaa' }}>Name</div>
                <div style={{ fontSize: '0.72rem', color: '#aaa' }}>Phone</div>
                <div />
              </div>
            )}
            {modalContacts.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr auto', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <input style={{ ...inputStyle, fontSize: '0.85rem' }} placeholder="Role" value={c.role}
                  onChange={e => setModalContacts(p => p.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} />
                <input style={{ ...inputStyle, fontSize: '0.85rem' }} placeholder="Name" value={c.name || ''}
                  onChange={e => setModalContacts(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input style={{ ...inputStyle, fontSize: '0.85rem' }} placeholder="Phone" value={c.phone || ''}
                  onChange={e => setModalContacts(p => p.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                <button type="button" onClick={() => setModalContacts(p => p.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 0.2rem' }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button style={btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'job' && (
        <Modal title={modal.record ? 'Edit Job' : 'New Job'} onClose={() => { setModal(null); setQuickAdd(null) }}>
          <Field label="Job Number"><input style={inputStyle} {...f('job_number')} /></Field>
          <Field label="Work Order # (Sage)"><input style={inputStyle} {...f('work_order_number')} /></Field>
          <Field label="Customer">
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select style={{ ...inputStyle, flex: 1 }} {...f('customer_id')}
                onChange={e => { setFields(p => ({ ...p, customer_id: e.target.value, vessel_id: '' })); setQuickAdd(null) }}>
                <option value="">— none —</option>
                {customers.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" style={{ ...btnSecondary, whiteSpace: 'nowrap', fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}
                onClick={() => { setQuickAdd(quickAdd === 'customer' ? null : 'customer'); setQuickAddName('') }}>
                + New
              </button>
            </div>
            {quickAdd === 'customer' && (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#f0f5ff', borderRadius: '6px', border: '1px solid #c8d8f8' }}>
                <input style={inputStyle} placeholder="Customer name" value={quickAddName}
                  onChange={e => setQuickAddName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveQuickAdd()}
                  autoFocus />
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button style={{ ...btnSecondary, fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={() => setQuickAdd(null)}>Cancel</button>
                  <button style={{ ...btnPrimary, fontSize: '0.82rem', padding: '0.3rem 0.7rem', opacity: quickAddName.trim() ? 1 : 0.5 }}
                    onClick={saveQuickAdd} disabled={!quickAddName.trim() || saving}>
                    {saving ? '…' : 'Add Customer'}
                  </button>
                </div>
              </div>
            )}
          </Field>
          <Field label="Vessel (leave blank for shop jobs)">
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select style={{ ...inputStyle, flex: 1 }} {...f('vessel_id')}>
                <option value="">— shop / no vessel —</option>
                {vessels
                  .filter(v => v.status === 'active' && (!fields.customer_id || v.customer_id === fields.customer_id))
                  .map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button type="button" style={{ ...btnSecondary, whiteSpace: 'nowrap', fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}
                onClick={() => { setQuickAdd(quickAdd === 'vessel' ? null : 'vessel'); setQuickAddName('') }}>
                + New
              </button>
            </div>
            {quickAdd === 'vessel' && (
              <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#f0f5ff', borderRadius: '6px', border: '1px solid #c8d8f8' }}>
                <input style={inputStyle} placeholder="Vessel name" value={quickAddName}
                  onChange={e => setQuickAddName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveQuickAdd()}
                  autoFocus />
                {fields.customer_id && (
                  <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.35rem' }}>
                    Will be linked to {customers.find(c => c.id === fields.customer_id)?.name}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button style={{ ...btnSecondary, fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={() => setQuickAdd(null)}>Cancel</button>
                  <button style={{ ...btnPrimary, fontSize: '0.82rem', padding: '0.3rem 0.7rem', opacity: quickAddName.trim() ? 1 : 0.5 }}
                    onClick={saveQuickAdd} disabled={!quickAddName.trim() || saving}>
                    {saving ? '…' : 'Add Vessel'}
                  </button>
                </div>
              </div>
            )}
          </Field>
          <Field label="Description"><textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }} {...f('description')} /></Field>
          {modal.record && (
            <Field label="Status">
              <select style={inputStyle} {...f('status')}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button style={btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'employee' && (
        <Modal title={modal.record ? 'Edit Employee' : 'New Employee'} onClose={() => setModal(null)}>
          <Field label="Name"><input style={inputStyle} {...f('name')} placeholder="First Last" /></Field>
          <Field label="Cell Number"><input type="tel" style={inputStyle} {...f('phone')} placeholder="e.g. 902-555-1234" /></Field>
          <Field label="WhatsApp Number (if different)"><input type="tel" style={inputStyle} {...f('whatsapp_phone')} placeholder="Only needed if different from Cell Number" /></Field>
          <Field label="Role">
            <select style={inputStyle} {...f('role')}>
              <option value="technician">Technician</option>
              <option value="office">Office</option>
            </select>
          </Field>
          <Field label="Status">
            <select style={inputStyle} {...f('active')}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button style={btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'entry' && (
        <Modal title="Edit Timesheet Entry" onClose={() => setModal(null)}>
          <Field label="Date"><input type="date" style={inputStyle} {...f('work_date')} /></Field>
          <Field label="Job">
            <select style={inputStyle} {...f('job_id')}>
              <option value="">— select job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} ({j.vessels?.name || 'Unknown'})</option>)}
            </select>
          </Field>
          <Field label="Hours"><input type="number" step="0.5" min="0" style={inputStyle} {...f('hours')} /></Field>
          <Field label="Per Diem">
            <select style={inputStyle} {...f('per_diem')}>
              <option value="0">None</option>
              <option value="1">×1 Standard</option>
              <option value="2">×2 Double</option>
            </select>
          </Field>
          <Field label="Description"><textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '70px' }} {...f('description')} /></Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button style={btnSecondary} onClick={() => setModal(null)}>Cancel</button>
            <button style={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {statusModal && (
        <Modal
          title={statusModal.action === 'close' ? `Close Job ${statusModal.job.job_number}` : `Reopen Job ${statusModal.job.job_number}`}
          onClose={() => setStatusModal(null)}
        >
          <p style={{ margin: '0 0 1rem', color: '#555', fontSize: '0.9rem' }}>
            {statusModal.action === 'close'
              ? 'Why is this job being closed?'
              : 'Why is this job being reopened?'}
          </p>
          <Field label="Comments (required)">
            <textarea
              value={statusNote}
              onChange={e => setStatusNote(e.target.value)}
              rows={4}
              placeholder={statusModal.action === 'close' ? 'e.g. Work complete, signed off by captain' : 'e.g. Additional repairs required'}
              style={{ ...inputStyle, resize: 'vertical' }}
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button style={btnSecondary} onClick={() => setStatusModal(null)}>Cancel</button>
            <button
              style={{ ...btnPrimary, background: statusModal.action === 'close' ? '#c0392b' : '#0066cc', opacity: statusNote.trim() ? 1 : 0.5, cursor: statusNote.trim() ? 'pointer' : 'default' }}
              onClick={confirmStatusChange}
              disabled={!statusNote.trim() || saving}
            >
              {saving ? 'Saving…' : statusModal.action === 'close' ? 'Close Job' : 'Reopen Job'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
