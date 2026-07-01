import React, { useState } from 'react'
import { mockJobs } from '../mockAuth'

export default function WorkerTimesheet({ userId, userName }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [jobEntries, setJobEntries] = useState([{ id: 1, jobId: '', hours: '', description: '', photo: null }])
  const [materials, setMaterials] = useState([{ id: 1, jobId: '', description: '' }])
  const [dailyNotes, setDailyNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const addJobEntry = () => {
    setJobEntries([...jobEntries, { id: Date.now(), jobId: '', hours: '', description: '', photo: null }])
  }

  const removeJobEntry = (id) => {
    setJobEntries(jobEntries.filter(e => e.id !== id))
  }

  const updateJobEntry = (id, field, value) => {
    setJobEntries(jobEntries.map(e => e.id === id ? { ...e, [field]: value } : e))
  }

  const addMaterial = () => {
    setMaterials([...materials, { id: Date.now(), jobId: '', description: '' }])
  }

  const removeMaterial = (id) => {
    setMaterials(materials.filter(m => m.id !== id))
  }

  const updateMaterial = (id, field, value) => {
    setMaterials(materials.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {
      date,
      jobEntries: jobEntries.filter(e => e.jobId && e.hours),
      materials: materials.filter(m => m.jobId),
      dailyNotes,
      submittedAt: new Date().toISOString(),
      submittedBy: userName,
    }
    console.log('Timesheet submitted:', payload)
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 3000)
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1>Daily Timesheet</h1>
      <p style={{ color: '#666' }}>Logged in as: {userName}</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '2rem' }}>
          <label><strong>Date:</strong></label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ marginLeft: '0.5rem', padding: '0.5rem' }} />
        </div>
        <div style={{ marginBottom: '2rem', border: '1px solid #ddd', padding: '1rem', borderRadius: '4px' }}>
          <h3>Job Entries</h3>
          {jobEntries.map((entry, idx) => (
            <div key={entry.id} style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: idx < jobEntries.length - 1 ? '1px solid #eee' : 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label><strong>Job #:</strong></label>
                  <select value={entry.jobId} onChange={(e) => updateJobEntry(entry.id, 'jobId', e.target.value)} required style={{ width: '100%', padding: '0.5rem' }}>
                    <option value="">Select job</option>
                    {mockJobs.map(job => (
                      <option key={job.id} value={job.id}>{job.job_number} - {job.ship_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label><strong>Hours:</strong></label>
                  <input type="number" step="0.5" value={entry.hours} onChange={(e) => updateJobEntry(entry.id, 'hours', e.target.value)} required style={{ width: '100%', padding: '0.5rem' }} />
                </div>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label><strong>Description:</strong></label>
                <textarea value={entry.description} onChange={(e) => updateJobEntry(entry.id, 'description', e.target.value)} placeholder="What did you do?" style={{ width: '100%', padding: '0.5rem', minHeight: '60px' }} />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label><strong>Photo (optional):</strong></label>
                <input type="file" accept="image/*" onChange={(e) => updateJobEntry(entry.id, 'photo', e.target.files[0])} style={{ display: 'block', marginTop: '0.5rem' }} />
              </div>
              {jobEntries.length > 1 && (
                <button type="button" onClick={() => removeJobEntry(entry.id)} style={{ padding: '0.5rem 1rem', background: '#ff4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addJobEntry} style={{ padding: '0.5rem 1rem', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+ Add Job</button>
        </div>
        <div style={{ marginBottom: '2rem', border: '1px solid #ddd', padding: '1rem', borderRadius: '4px' }}>
          <h3>Shop Supplies Used</h3>
          {materials.map((mat, idx) => (
            <div key={mat.id} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: idx < materials.length - 1 ? '1px solid #eee' : 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label><strong>Job #:</strong></label>
                  <select value={mat.jobId} onChange={(e) => updateMaterial(mat.id, 'jobId', e.target.value)} style={{ width: '100%', padding: '0.5rem' }}>
                    <option value="">Select job</option>
                    {mockJobs.map(job => (
                      <option key={job.id} value={job.id}>{job.job_number} - {job.ship_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label><strong>Description:</strong></label>
                  <input type="text" value={mat.description} onChange={(e) => updateMaterial(mat.id, 'description', e.target.value)} placeholder="e.g., Welding rods" style={{ width: '100%', padding: '0.5rem' }} />
                </div>
              </div>
              {materials.length > 1 && (
                <button type="button" onClick={() => removeMaterial(mat.id)} style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', background: '#ff4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addMaterial} style={{ padding: '0.5rem 1rem', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+ Add Supply</button>
        </div>
        <div style={{ marginBottom: '2rem' }}>
          <label><strong>Daily Notes:</strong></label>
          <textarea value={dailyNotes} onChange={(e) => setDailyNotes(e.target.value)} placeholder="Any issues or comments?" style={{ width: '100%', padding: '0.5rem', minHeight: '80px' }} />
        </div>
        <button type="submit" style={{ padding: '0.75rem 2rem', background: '#00aa00', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }}>Submit Timesheet</button>
        {submitted && <p style={{ color: '#00aa00', marginTop: '1rem', fontWeight: 'bold' }}>✓ Submitted!</p>}
      </form>
    </div>
  )
}