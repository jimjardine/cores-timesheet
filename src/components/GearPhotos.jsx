import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

const publicUrl = (path) => supabase.storage.from('gear-photos').getPublicUrl(path).data.publicUrl

const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const fmtSize = (bytes) => bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '—'

export default function GearPhotos() {
  const [photos, setPhotos]     = useState([])
  const [jobs, setJobs]         = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all')
  const [jobFilter, setJobFilter] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [edits, setEdits]       = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: j }, { data: emps }] = await Promise.all([
      supabase.schema('Cores').from('gear_photos').select('*').order('created_at', { ascending: false }),
      supabase.schema('Cores').from('jobs').select('id, job_number, description').eq('status', 'open'),
      supabase.schema('Cores').from('employees').select('id, name'),
    ])
    setPhotos(p || [])
    setJobs(j || [])
    setEmployees(emps || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const employeeName = (id) => employees.find(e => e.id === id)?.name || null

  const visible = photos.filter(p => {
    if (filter === 'needs_context' && !p.pending_context) return false
    if (filter === 'has_context' && p.pending_context)    return false
    if (jobFilter.trim() && !(p.ship_or_job || '').toLowerCase().includes(jobFilter.trim().toLowerCase())) return false
    return true
  })

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

  async function remove(photo) {
    if (!confirm('Delete this photo? This removes the file and its record permanently.')) return
    setSavingId(photo.id)
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Gear Photos</h2>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>{photos.length} total</span>
        <input
          value={jobFilter}
          onChange={e => setJobFilter(e.target.value)}
          placeholder="Filter by job number..."
          style={{ padding: '0.4rem 0.7rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.85rem', minWidth: 180, marginLeft: '1rem' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {filterBtn('all', 'All')}
          {filterBtn('needs_context', `Needs ship/job (${photos.filter(p => p.pending_context).length})`)}
          {filterBtn('has_context', 'Tagged')}
        </div>
      </div>

      {visible.length === 0 && (
        <div style={{ color: '#888', padding: '2rem 0', textAlign: 'center' }}>
          No photos {filter !== 'all' || jobFilter.trim() ? 'match this filter' : 'have been texted in yet'}.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
        {visible.map(photo => {
          const matchedJob = jobs.find(j => j.job_number.toUpperCase() === (photo.ship_or_job || '').toUpperCase())
          const name = employeeName(photo.employee_id)
          return (
            <div key={photo.id} style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
              <div
                onClick={() => setLightbox(photo)}
                style={{ aspectRatio: '4 / 3', background: '#f0f0f0', cursor: 'pointer', overflow: 'hidden' }}
              >
                <img
                  src={publicUrl(photo.storage_path)}
                  alt={photo.ship_or_job || 'gear photo'}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#c00;font-size:0.8rem;padding:0.5rem;text-align:center">Image failed to load</div>' }}
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
                  <div style={{ fontSize: '0.75rem', color: '#2a7a2a', marginBottom: '0.3rem' }}>
                    ✓ {matchedJob.description}
                  </div>
                )}
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
          <img
            src={publicUrl(lightbox.storage_path)}
            alt={lightbox.ship_or_job || 'gear photo'}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
          />
        </div>
      )}
    </div>
  )
}
