import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import LookupPicker from './LookupPicker'

const inputStyle = { padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }
const btnPrimary = { padding: '0.4rem 0.9rem', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }
const btnSecondary = { padding: '0.4rem 0.9rem', background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }
const btnSmall = { padding: '0.25rem 0.6rem', fontSize: '0.78rem', border: '1px solid #ccc', background: '#fff', borderRadius: '4px', cursor: 'pointer' }
const btnDanger = { padding: '0.25rem 0.6rem', fontSize: '0.78rem', border: '1px solid #e0b0b0', background: '#fff', color: '#c0392b', borderRadius: '4px', cursor: 'pointer' }

// Small caption above a field — placeholders alone go blank once a field
// actually has a value, which was the whole complaint (Jim: "it's not super
// clear once they have data in them"). Sized down from AdminPanel.jsx's
// Field component to fit this denser card UI.
function LabeledField({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: '0.72rem', color: '#888', marginBottom: '0.2rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const blankEngine = () => ({
  engine_type_id: '', side: '', manufacturer: '', model: '', arrangement_number: '', serial_number: '',
  cylinder_count: '', kw: '', install_date: '', terminated_date: '', notes: '',
})
const blankComponent = () => ({ position_label: '', component_type_id: '', serial_number: '', install_date: '', notes: '' })
const blankServiceEntry = () => ({ service_date: '', description: '', hours_at_service: '', performed_by: '', work_order_id: '' })

// Admin-only engine/component/service-log manager for one vessel — reached
// from the "Engines" button on the Vessels tab. Deliberately no tech-facing
// path anywhere near this: it's a record the office maintains, not something
// SMS/mobile touches. Inline-editable cards, not nested modals — matches how
// GearPhotos.jsx already handles this shape of per-item CRUD elsewhere.
export default function VesselEngines({ vessel, jobs, onClose }) {
  const [engines, setEngines] = useState([])
  const [engineTypes, setEngineTypes] = useState([])
  const [componentTypes, setComponentTypes] = useState([])
  const [components, setComponents] = useState([])
  const [serviceLog, setServiceLog] = useState([])
  const [loading, setLoading] = useState(true)

  const [addingEngine, setAddingEngine] = useState(false)
  const [newEngine, setNewEngine] = useState(blankEngine())
  const [editingEngineId, setEditingEngineId] = useState(null)
  const [engineDraft, setEngineDraft] = useState({})
  const [expandedEngineId, setExpandedEngineId] = useState(null)
  const [saving, setSaving] = useState(false)

  const [addingComponentFor, setAddingComponentFor] = useState(null) // engine id
  const [newComponent, setNewComponent] = useState(blankComponent())
  const [editingComponentId, setEditingComponentId] = useState(null)
  const [componentDraft, setComponentDraft] = useState({})

  const [addingServiceFor, setAddingServiceFor] = useState(null) // engine id
  const [newServiceEntry, setNewServiceEntry] = useState(blankServiceEntry())
  const [editingServiceId, setEditingServiceId] = useState(null)
  const [serviceDraft, setServiceDraft] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data: e } = await supabase.schema('Cores').from('engines').select('*').eq('vessel_id', vessel.id).order('created_at')
    const engineList = e || []
    setEngines(engineList)
    const engineIds = engineList.map(x => x.id)
    const [{ data: et }, { data: ct }, compsRes, logRes] = await Promise.all([
      supabase.schema('Cores').from('engine_types').select('*').order('name'),
      supabase.schema('Cores').from('component_types').select('*').order('name'),
      engineIds.length
        ? supabase.schema('Cores').from('engine_components').select('*').in('engine_id', engineIds).order('position_label')
        : Promise.resolve({ data: [] }),
      engineIds.length
        ? supabase.schema('Cores').from('engine_service_log').select('*, jobs(job_number)').in('engine_id', engineIds).order('service_date', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    setEngineTypes(et || [])
    setComponentTypes(ct || [])
    setComponents(compsRes.data || [])
    setServiceLog(logRes.data || [])
    setLoading(false)
  }, [vessel.id])

  useEffect(() => { load() }, [load])

  function engineNumField(v) { return v === '' ? null : Number(v) }

  // Shared between add and edit.
  function engineFields(d) {
    return {
      engine_type_id: d.engine_type_id || null,
      side: d.side || null,
      manufacturer: d.manufacturer || null,
      model: d.model || null,
      arrangement_number: d.arrangement_number || null,
      serial_number: d.serial_number || null,
      cylinder_count: engineNumField(d.cylinder_count),
      kw: engineNumField(d.kw),
      install_date: d.install_date || null,
      terminated_date: d.terminated_date || null,
      notes: d.notes || null,
    }
  }

  async function saveNewEngine() {
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engines').insert({ vessel_id: vessel.id, ...engineFields(newEngine) })
    setSaving(false)
    if (error) { alert('Error adding engine: ' + error.message); return }
    setAddingEngine(false)
    setNewEngine(blankEngine())
    load()
  }

  function startEditEngine(engine) {
    setEditingEngineId(engine.id)
    setEngineDraft({
      engine_type_id: engine.engine_type_id || '', side: engine.side || '', manufacturer: engine.manufacturer || '',
      model: engine.model || '', arrangement_number: engine.arrangement_number || '', serial_number: engine.serial_number || '',
      cylinder_count: engine.cylinder_count ?? '', kw: engine.kw ?? '', install_date: engine.install_date || '',
      terminated_date: engine.terminated_date || '', notes: engine.notes || '',
    })
  }

  async function saveEngineEdit(engineId) {
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engines').update(engineFields(engineDraft)).eq('id', engineId)
    setSaving(false)
    if (error) { alert('Error saving engine: ' + error.message); return }
    setEditingEngineId(null)
    load()
  }

  async function deleteEngine(engine) {
    const typeName = engineTypes.find(t => t.id === engine.engine_type_id)?.name
    const desc = [typeName, engine.manufacturer].filter(Boolean).join(' ') || 'this engine'
    if (!confirm(`Delete "${desc}"? This also deletes its components and service log.`)) return
    const { error } = await supabase.schema('Cores').from('engines').delete().eq('id', engine.id)
    if (error) { alert('Error deleting engine: ' + error.message); return }
    load()
  }

  async function saveNewComponent(engineId) {
    if (!newComponent.position_label.trim()) { alert('Give the component a position (e.g. "Left1", "Right8")'); return }
    if (!newComponent.component_type_id) { alert('Pick or add a component type'); return }
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engine_components').insert({
      engine_id: engineId,
      position_label: newComponent.position_label.trim(),
      component_type_id: newComponent.component_type_id,
      serial_number: newComponent.serial_number || null,
      install_date: newComponent.install_date || null,
      notes: newComponent.notes || null,
    })
    setSaving(false)
    if (error) { alert('Error adding component: ' + error.message); return }
    setAddingComponentFor(null)
    setNewComponent(blankComponent())
    load()
  }

  function startEditComponent(c) {
    setEditingComponentId(c.id)
    setComponentDraft({ position_label: c.position_label, component_type_id: c.component_type_id, serial_number: c.serial_number || '', install_date: c.install_date || '', notes: c.notes || '' })
  }

  async function saveComponentEdit(componentId) {
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engine_components').update({
      position_label: componentDraft.position_label.trim(),
      component_type_id: componentDraft.component_type_id,
      serial_number: componentDraft.serial_number || null,
      install_date: componentDraft.install_date || null,
      notes: componentDraft.notes || null,
    }).eq('id', componentId)
    setSaving(false)
    if (error) { alert('Error saving component: ' + error.message); return }
    setEditingComponentId(null)
    load()
  }

  async function deleteComponent(c) {
    if (!confirm(`Delete component "${c.position_label}"?`)) return
    const { error } = await supabase.schema('Cores').from('engine_components').delete().eq('id', c.id)
    if (error) { alert('Error deleting component: ' + error.message); return }
    load()
  }

  async function saveNewServiceEntry(engineId) {
    if (!newServiceEntry.service_date) { alert('Pick a service date'); return }
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engine_service_log').insert({
      engine_id: engineId,
      service_date: newServiceEntry.service_date,
      description: newServiceEntry.description || null,
      hours_at_service: engineNumField(newServiceEntry.hours_at_service),
      performed_by: newServiceEntry.performed_by || null,
      work_order_id: newServiceEntry.work_order_id || null,
    })
    setSaving(false)
    if (error) { alert('Error adding service entry: ' + error.message); return }
    setAddingServiceFor(null)
    setNewServiceEntry(blankServiceEntry())
    load()
  }

  function startEditServiceEntry(s) {
    setEditingServiceId(s.id)
    setServiceDraft({ service_date: s.service_date, description: s.description || '', hours_at_service: s.hours_at_service ?? '', performed_by: s.performed_by || '', work_order_id: s.work_order_id || '' })
  }

  async function saveServiceEdit(serviceId) {
    setSaving(true)
    const { error } = await supabase.schema('Cores').from('engine_service_log').update({
      service_date: serviceDraft.service_date,
      description: serviceDraft.description || null,
      hours_at_service: engineNumField(serviceDraft.hours_at_service),
      performed_by: serviceDraft.performed_by || null,
      work_order_id: serviceDraft.work_order_id || null,
    }).eq('id', serviceId)
    setSaving(false)
    if (error) { alert('Error saving service entry: ' + error.message); return }
    setEditingServiceId(null)
    load()
  }

  async function deleteServiceEntry(s) {
    if (!confirm('Delete this service log entry?')) return
    const { error } = await supabase.schema('Cores').from('engine_service_log').delete().eq('id', s.id)
    if (error) { alert('Error deleting service entry: ' + error.message); return }
    load()
  }

  const engineField = (draft, setDraft, key) => ({
    value: draft[key] ?? '',
    onChange: e => setDraft(d => ({ ...d, [key]: e.target.value })),
  })
  const engineTypeById = Object.fromEntries(engineTypes.map(t => [t.id, t.name]))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 250, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: '8px', padding: '1.75rem', width: '100%', maxWidth: '900px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{vessel.name} — Engines</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#aaa', lineHeight: 1 }}>×</button>
        </div>

        {loading ? (
          <div style={{ color: '#999', padding: '2rem 0', textAlign: 'center' }}>Loading…</div>
        ) : (
          <>
            {engines.map(engine => {
              const isEditing = editingEngineId === engine.id
              const isExpanded = expandedEngineId === engine.id
              const engineComponents = components.filter(c => c.engine_id === engine.id)
              const engineServiceLog = serviceLog.filter(s => s.engine_id === engine.id)
              const typeById = Object.fromEntries(componentTypes.map(t => [t.id, t.name]))

              return (
                <div key={engine.id} style={{ border: '1px solid #ddd', borderRadius: '6px', marginBottom: '1rem', overflow: 'hidden' }}>
                  <div style={{ padding: '0.9rem 1.1rem', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                    {isEditing ? (
                      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' }}>
                        <LabeledField label="Engine Type">
                          <LookupPicker table="engine_types" types={engineTypes} placeholder="Engine Type…"
                            value={engineDraft.engine_type_id}
                            onChange={id => setEngineDraft(d => ({ ...d, engine_type_id: id }))}
                            onTypeCreated={t => setEngineTypes(p => [...p, t].sort((a, b) => a.name.localeCompare(b.name)))} />
                        </LabeledField>
                        <LabeledField label="Side">
                          <select style={inputStyle} {...engineField(engineDraft, setEngineDraft, 'side')}>
                            <option value="">Unspecified</option>
                            <option value="port">Port</option>
                            <option value="starboard">Starboard</option>
                          </select>
                        </LabeledField>
                        <LabeledField label="Manufacturer">
                          <input style={inputStyle} {...engineField(engineDraft, setEngineDraft, 'manufacturer')} />
                        </LabeledField>
                        <LabeledField label="Model">
                          <input style={inputStyle} {...engineField(engineDraft, setEngineDraft, 'model')} />
                        </LabeledField>
                        <LabeledField label="Arrangement #">
                          <input style={inputStyle} {...engineField(engineDraft, setEngineDraft, 'arrangement_number')} />
                        </LabeledField>
                        <LabeledField label="Serial Number">
                          <input style={inputStyle} {...engineField(engineDraft, setEngineDraft, 'serial_number')} />
                        </LabeledField>
                        <LabeledField label="Cylinders">
                          <input style={inputStyle} type="number" {...engineField(engineDraft, setEngineDraft, 'cylinder_count')} />
                        </LabeledField>
                        <LabeledField label="kW">
                          <input style={inputStyle} type="number" step="0.1" {...engineField(engineDraft, setEngineDraft, 'kw')} />
                        </LabeledField>
                        <LabeledField label="Install Date">
                          <input style={inputStyle} type="date" {...engineField(engineDraft, setEngineDraft, 'install_date')} />
                        </LabeledField>
                        <LabeledField label="Terminated Date">
                          <input style={inputStyle} type="date" {...engineField(engineDraft, setEngineDraft, 'terminated_date')} />
                        </LabeledField>
                        <LabeledField label="Notes" style={{ gridColumn: '1 / -1' }}>
                          <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }} {...engineField(engineDraft, setEngineDraft, 'notes')} />
                        </LabeledField>
                      </div>
                    ) : (
                      <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpandedEngineId(isExpanded ? null : engine.id)}>
                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                          <span style={{ color: '#aaa', fontSize: '0.85rem', marginRight: '0.4rem' }}>{isExpanded ? '▾' : '▸'}</span>
                          {engineTypeById[engine.engine_type_id]
                            || <span style={{ fontWeight: 400, fontStyle: 'italic', color: '#aaa' }}>Unspecified type</span>}
                          {engine.side && <span style={{ fontWeight: 400 }}> · {engine.side === 'port' ? 'Port' : 'Starboard'}</span>}
                          {engine.terminated_date && (
                            <span style={{ fontWeight: 400, color: '#888', marginLeft: '0.5rem', fontSize: '0.82rem' }}>
                              terminated {engine.terminated_date}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.2rem' }}>
                          {[engine.manufacturer, engine.model, engine.serial_number && `S/N ${engine.serial_number}`, engine.arrangement_number && `Arr# ${engine.arrangement_number}`, engine.kw && `${engine.kw} kW`, engine.cylinder_count && `${engine.cylinder_count} cyl`]
                            .filter(Boolean).join(' · ') || 'No details yet'}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                      {isEditing ? (
                        <>
                          <button style={btnSmall} onClick={() => setEditingEngineId(null)} disabled={saving}>Cancel</button>
                          <button style={{ ...btnPrimary, padding: '0.25rem 0.7rem', fontSize: '0.78rem' }} onClick={() => saveEngineEdit(engine.id)} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button style={btnSmall} onClick={() => startEditEngine(engine)}>Edit</button>
                          <button style={btnDanger} onClick={() => deleteEngine(engine)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>

                  {isExpanded && !isEditing && (
                    <div style={{ padding: '1rem 1.1rem' }}>
                      {/* ── Components ── */}
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#555' }}>Components</div>
                          {addingComponentFor !== engine.id && (
                            <button style={btnSmall} onClick={() => { setAddingComponentFor(engine.id); setNewComponent(blankComponent()) }}>+ Add Component</button>
                          )}
                        </div>
                        {engineComponents.length === 0 && addingComponentFor !== engine.id && (
                          <div style={{ color: '#bbb', fontSize: '0.82rem' }}>No components tracked yet</div>
                        )}
                        {engineComponents.map(c => {
                          const isEditingC = editingComponentId === c.id
                          return isEditingC ? (
                            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr auto', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                              <input style={inputStyle} placeholder="Position (Left1…)" {...engineField(componentDraft, setComponentDraft, 'position_label')} />
                              <LookupPicker table="component_types" placeholder="Type a component…" types={componentTypes} value={componentDraft.component_type_id}
                                onChange={id => setComponentDraft(d => ({ ...d, component_type_id: id }))}
                                onTypeCreated={t => setComponentTypes(p => [...p, t].sort((a, b) => a.name.localeCompare(b.name)))} />
                              <input style={inputStyle} placeholder="Serial number" {...engineField(componentDraft, setComponentDraft, 'serial_number')} />
                              <input style={inputStyle} type="date" {...engineField(componentDraft, setComponentDraft, 'install_date')} />
                              <div style={{ display: 'flex', gap: '0.3rem' }}>
                                <button style={btnSmall} onClick={() => setEditingComponentId(null)} disabled={saving}>Cancel</button>
                                <button style={{ ...btnPrimary, padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => saveComponentEdit(c.id)} disabled={saving}>Save</button>
                              </div>
                            </div>
                          ) : (
                            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem' }}>
                              <div>
                                <strong>{c.position_label}</strong> — {typeById[c.component_type_id] || 'Unknown type'}
                                {c.serial_number && <span style={{ color: '#666' }}> · S/N {c.serial_number}</span>}
                                {c.install_date && <span style={{ color: '#999' }}> · installed {c.install_date}</span>}
                              </div>
                              <div style={{ display: 'flex', gap: '0.3rem' }}>
                                <button style={btnSmall} onClick={() => startEditComponent(c)}>Edit</button>
                                <button style={btnDanger} onClick={() => deleteComponent(c)}>×</button>
                              </div>
                            </div>
                          )
                        })}
                        {addingComponentFor === engine.id && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1fr auto', gap: '0.4rem', marginTop: '0.5rem', alignItems: 'center' }}>
                            <input style={inputStyle} placeholder="Position (Left1…)" {...engineField(newComponent, setNewComponent, 'position_label')} />
                            <LookupPicker table="component_types" placeholder="Type a component…" types={componentTypes} value={newComponent.component_type_id}
                              onChange={id => setNewComponent(d => ({ ...d, component_type_id: id }))}
                              onTypeCreated={t => setComponentTypes(p => [...p, t].sort((a, b) => a.name.localeCompare(b.name)))} />
                            <input style={inputStyle} placeholder="Serial number" {...engineField(newComponent, setNewComponent, 'serial_number')} />
                            <input style={inputStyle} type="date" {...engineField(newComponent, setNewComponent, 'install_date')} />
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button style={btnSmall} onClick={() => setAddingComponentFor(null)} disabled={saving}>Cancel</button>
                              <button style={{ ...btnPrimary, padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => saveNewComponent(engine.id)} disabled={saving}>Add</button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Service Log ── */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#555' }}>Service Log</div>
                          {addingServiceFor !== engine.id && (
                            <button style={btnSmall} onClick={() => { setAddingServiceFor(engine.id); setNewServiceEntry(blankServiceEntry()) }}>+ Add Service Entry</button>
                          )}
                        </div>
                        {engineServiceLog.length === 0 && addingServiceFor !== engine.id && (
                          <div style={{ color: '#bbb', fontSize: '0.82rem' }}>No service history yet</div>
                        )}
                        {engineServiceLog.map(s => {
                          const isEditingS = editingServiceId === s.id
                          return isEditingS ? (
                            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr auto', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                              <input style={inputStyle} type="date" {...engineField(serviceDraft, setServiceDraft, 'service_date')} />
                              <input style={inputStyle} placeholder="What was done" {...engineField(serviceDraft, setServiceDraft, 'description')} />
                              <input style={inputStyle} type="number" step="0.1" placeholder="Hours" {...engineField(serviceDraft, setServiceDraft, 'hours_at_service')} />
                              <input style={inputStyle} placeholder="Performed by" {...engineField(serviceDraft, setServiceDraft, 'performed_by')} />
                              <select style={inputStyle} {...engineField(serviceDraft, setServiceDraft, 'work_order_id')}>
                                <option value="">— no work order —</option>
                                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number}</option>)}
                              </select>
                              <div style={{ display: 'flex', gap: '0.3rem' }}>
                                <button style={btnSmall} onClick={() => setEditingServiceId(null)} disabled={saving}>Cancel</button>
                                <button style={{ ...btnPrimary, padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => saveServiceEdit(s.id)} disabled={saving}>Save</button>
                              </div>
                            </div>
                          ) : (
                            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.85rem' }}>
                              <div>
                                <strong>{s.service_date}</strong>
                                {s.description && <span> — {s.description}</span>}
                                {s.hours_at_service != null && <span style={{ color: '#666' }}> · {s.hours_at_service}h</span>}
                                {s.performed_by && <span style={{ color: '#666' }}> · {s.performed_by}</span>}
                                {s.jobs?.job_number && <span style={{ color: '#999' }}> · WO {s.jobs.job_number}</span>}
                              </div>
                              <div style={{ display: 'flex', gap: '0.3rem' }}>
                                <button style={btnSmall} onClick={() => startEditServiceEntry(s)}>Edit</button>
                                <button style={btnDanger} onClick={() => deleteServiceEntry(s)}>×</button>
                              </div>
                            </div>
                          )
                        })}
                        {addingServiceFor === engine.id && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr auto', gap: '0.4rem', marginTop: '0.5rem', alignItems: 'center' }}>
                            <input style={inputStyle} type="date" {...engineField(newServiceEntry, setNewServiceEntry, 'service_date')} />
                            <input style={inputStyle} placeholder="What was done" {...engineField(newServiceEntry, setNewServiceEntry, 'description')} />
                            <input style={inputStyle} type="number" step="0.1" placeholder="Hours" {...engineField(newServiceEntry, setNewServiceEntry, 'hours_at_service')} />
                            <input style={inputStyle} placeholder="Performed by" {...engineField(newServiceEntry, setNewServiceEntry, 'performed_by')} />
                            <select style={inputStyle} {...engineField(newServiceEntry, setNewServiceEntry, 'work_order_id')}>
                              <option value="">— no work order —</option>
                              {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number}</option>)}
                            </select>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button style={btnSmall} onClick={() => setAddingServiceFor(null)} disabled={saving}>Cancel</button>
                              <button style={{ ...btnPrimary, padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => saveNewServiceEntry(engine.id)} disabled={saving}>Add</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {engines.length === 0 && !addingEngine && (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#999', background: '#f9f9f9', borderRadius: '6px', marginBottom: '1rem' }}>No engines recorded for this vessel yet</div>
            )}

            {addingEngine ? (
              <div style={{ border: '1px dashed #0066cc', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <LabeledField label="Engine Type">
                    <LookupPicker table="engine_types" types={engineTypes} placeholder="Engine Type…"
                      value={newEngine.engine_type_id}
                      onChange={id => setNewEngine(d => ({ ...d, engine_type_id: id }))}
                      onTypeCreated={t => setEngineTypes(p => [...p, t].sort((a, b) => a.name.localeCompare(b.name)))} />
                  </LabeledField>
                  <LabeledField label="Side">
                    <select style={inputStyle} {...engineField(newEngine, setNewEngine, 'side')}>
                      <option value="">Unspecified</option>
                      <option value="port">Port</option>
                      <option value="starboard">Starboard</option>
                    </select>
                  </LabeledField>
                  <LabeledField label="Manufacturer">
                    <input style={inputStyle} {...engineField(newEngine, setNewEngine, 'manufacturer')} />
                  </LabeledField>
                  <LabeledField label="Model">
                    <input style={inputStyle} {...engineField(newEngine, setNewEngine, 'model')} />
                  </LabeledField>
                  <LabeledField label="Arrangement #">
                    <input style={inputStyle} {...engineField(newEngine, setNewEngine, 'arrangement_number')} />
                  </LabeledField>
                  <LabeledField label="Serial Number">
                    <input style={inputStyle} {...engineField(newEngine, setNewEngine, 'serial_number')} />
                  </LabeledField>
                  <LabeledField label="Cylinders">
                    <input style={inputStyle} type="number" {...engineField(newEngine, setNewEngine, 'cylinder_count')} />
                  </LabeledField>
                  <LabeledField label="kW">
                    <input style={inputStyle} type="number" step="0.1" {...engineField(newEngine, setNewEngine, 'kw')} />
                  </LabeledField>
                  <LabeledField label="Install Date">
                    <input style={inputStyle} type="date" {...engineField(newEngine, setNewEngine, 'install_date')} />
                  </LabeledField>
                  <LabeledField label="Terminated Date">
                    <input style={inputStyle} type="date" {...engineField(newEngine, setNewEngine, 'terminated_date')} />
                  </LabeledField>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button style={btnSecondary} onClick={() => { setAddingEngine(false); setNewEngine(blankEngine()) }} disabled={saving}>Cancel</button>
                  <button style={btnPrimary} onClick={saveNewEngine} disabled={saving}>{saving ? 'Saving…' : 'Add Engine'}</button>
                </div>
              </div>
            ) : (
              <button style={btnPrimary} onClick={() => setAddingEngine(true)}>+ Add Engine</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
