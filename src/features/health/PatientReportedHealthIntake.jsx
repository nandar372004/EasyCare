import { useCallback, useEffect, useState } from 'react'
import {
  addMyReportedHealthItem, addMyReportedVaccination, archiveMyReportedHealthItem, getMyReportedHealthIntake,
  saveMyReportedBloodType, updateMyReportedHealthItem,
  updateMyReportedVaccination,
} from '../../services/patientReportedHealthService.js'

const categories = [
  { key: 'allergy', title: 'Allergies', singular: 'allergy', nameLabel: 'Allergen', details: [['allergenType', 'Type'], ['reaction', 'Reaction']] },
  { key: 'condition', title: 'Medical conditions', singular: 'condition', nameLabel: 'Condition', details: [['context', 'What you were told (optional)']] },
  { key: 'medication', title: 'Current medications', singular: 'medication', nameLabel: 'Medication', details: [['dose', 'Strength or dose (optional)'], ['frequency', 'How often (optional)'], ['reason', 'Reason (optional)']] },
  { key: 'vaccination', title: 'Vaccinations', singular: 'vaccination', nameLabel: 'Vaccine Name', detailFields: [['doseNumber', 'Dose / Dose Number', 'text', false], ['dateGiven', 'Date Given', 'date', true], ['location', 'Location / Clinic', 'text', false], ['notes', 'Notes', 'text', false]], requiredDetail: 'dateGiven' },
]
const bloodTypeOptions = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const emptyRecord = { bloodType: 'Unknown', bloodTypeSource: 'legacy_patient_profile', bloodTypeVerificationStatus: 'unverified', items: [] }

export function PatientReportedHealthIntake({ readOnly = false }) {
  const [record, setRecord] = useState(null)
  const [bloodType, setBloodType] = useState('Unknown')
  const [editing, setEditing] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const current = await getMyReportedHealthIntake()
      setRecord(current || emptyRecord); setBloodType(current?.bloodType || 'Unknown')
    } catch { setRecord(null); setError('Unable to load your patient-reported health information.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function run(action, message = 'Your information was saved.') {
    setSaving(true); setError(''); setSuccess('')
    try {
      const result = await action()
      if (result?.items) { setRecord(result); setBloodType(result.bloodType || 'Unknown') }
      else await load()
      setSuccess(message)
      return true
    } catch (cause) {
      setError(cause?.message || 'Unable to save your patient-reported health information.')
      return false
    } finally { setSaving(false) }
  }

  async function saveBloodType(event) {
    event.preventDefault()
    await run(() => saveMyReportedBloodType(bloodType), 'Blood type saved as patient-reported and unverified.')
  }

  async function addEntry(category, entryKind = 'item') {
    if (saving) return
    const draft = drafts[category.key] || { name: '', details: {} }
    if (entryKind === 'item' && !draft.name.trim()) { setError(`Enter a ${category.nameLabel.toLowerCase()}.`); return }
    if (category.requiredDetail && !validDateOnly(draft.details?.[category.requiredDetail])) { setError('Enter a valid date given.'); return }
    const details = Object.fromEntries(Object.entries(draft.details || {}).map(([key, value]) => [key, String(value || '').trim()]).filter(([, value]) => value))
    const saveItem = category.key === 'vaccination'
      ? () => addMyReportedVaccination({ name: draft.name, ...details })
      : () => addMyReportedHealthItem({ itemType: category.key, entryKind, name: entryKind === 'item' ? draft.name.trim() : null, details: entryKind === 'item' ? details : {} })
    const saved = await run(saveItem, 'Your report was saved as patient-reported and unverified.')
    if (saved) setDrafts(current => ({ ...current, [category.key]: { name: '', details: {} } }))
  }

  async function saveEdit(category, item) {
    if (saving) return
    const draft = drafts[item.id]
    if (!draft?.name?.trim()) { setError(`Enter a ${category.nameLabel.toLowerCase()}.`); return }
    if (category.requiredDetail && !validDateOnly(draft.details?.[category.requiredDetail])) { setError('Enter a valid date given.'); return }
    const details = Object.fromEntries(Object.entries(draft.details || {}).map(([key, value]) => [key, String(value || '').trim()]).filter(([, value]) => value))
    const saveItem = category.key === 'vaccination'
      ? () => updateMyReportedVaccination({ id: item.id, name: draft.name, ...details })
      : () => updateMyReportedHealthItem({ id: item.id, name: draft.name, details })
    if (await run(saveItem, 'Your report was updated.')) setEditing(null)
  }

  async function archive(item) {
    if (await run(() => archiveMyReportedHealthItem(item.id), 'Your report was removed from the active list.')) setEditing(null)
  }

  const updateDraft = (key, field, value, details = false) => setDrafts(current => {
    const currentDraft = current[key] || { name: '', details: {} }
    const nextDetails = { ...currentDraft.details, [field]: value }
    if (details && field === 'allergenType' && !value) delete nextDetails[field]
    return { ...current, [key]: details ? { ...currentDraft, details: nextDetails } : { ...currentDraft, [field]: value } }
  })

  if (loading) return <section className="card reported-health-intake" aria-label="Patient-reported Health Information"><p role="status">Loading health information…</p></section>
  if (!record) return <section className="card reported-health-intake" aria-label="Patient-reported Health Information"><h2>Health Information</h2><p role="alert">{error}</p><button className="outline-button" type="button" onClick={() => void load()}>Try again</button></section>

  return <section className="card reported-health-intake" aria-label="Patient-reported Health Information">
    <header><h2>Health Information</h2><p>These details are reported by you and are not clinician-confirmed.</p></header>
    {error && <p className="error-message" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
    <section className="reported-health-basics" aria-labelledby="reported-blood-type-heading">
      <h3 id="reported-blood-type-heading">Health basics</h3>
      <label htmlFor="reported-blood-type">Blood type</label>
      <select id="reported-blood-type" value={bloodType} disabled={readOnly || saving} onChange={event => setBloodType(event.target.value)}>
        {bloodTypeOptions.map(option => <option key={option}>{option}</option>)}
      </select>
      <p className="reported-health-provenance">{record.bloodTypeSource === 'patient_reported' ? `Reported by you · ${record.bloodTypeVerificationStatus === 'confirmed' ? 'clinician-confirmed' : 'not verified'}` : record.bloodTypeSource === 'not_reported' ? 'Not reported yet.' : 'Legacy profile value · not verified'}. Blood type is not laboratory verified here.</p>
      {!readOnly && <button className="outline-button" type="button" onClick={saveBloodType} disabled={saving}>Save blood type</button>}
    </section>

    {categories.map(category => {
      const entries = record.items.filter(item => item.itemType === category.key)
      const activeMarker = entries.find(item => item.entryKind !== 'item')
      return <section className="reported-health-category" key={category.key} aria-labelledby={`reported-${category.key}-heading`}>
        <h3 id={`reported-${category.key}-heading`}>{category.title}</h3>
        {activeMarker && <p className="reported-health-marker">{activeMarker.entryKind === 'none_known' ? 'You reported none known.' : 'You reported that you are not sure.'} <span>Patient-reported · not verified</span></p>}
        {!activeMarker && !entries.some(item => item.entryKind === 'item') && <p>No {category.title.toLowerCase()} reported.</p>}
        <ul className="reported-health-list">
          {entries.filter(item => item.entryKind === 'item').map(item => {
            const isReviewed = item.verificationStatus !== 'unverified'
            const isEditing = editing === item.id
            const draft = drafts[item.id] || { name: item.name, details: item.details || {} }
            return <li key={item.id}>
              {isEditing ? <div className="reported-health-edit">
                <label>{category.nameLabel}<input value={draft.name} maxLength="160" onChange={event => updateDraft(item.id, 'name', event.target.value)} /></label>
                {(category.detailFields || category.details.map(([field, label]) => [field, label, 'text', false])).map(([field, label, type, required]) => <label key={field}>{label}{field === 'allergenType' ? <select value={draft.details[field] || ''} onChange={event => updateDraft(item.id, field, event.target.value, true)}><option value="">Not specified</option>{['medication','food','environmental','insect','latex','other','unknown'].map(option => <option key={option}>{option}</option>)}</select> : <input type={type} value={draft.details[field] || ''} maxLength={detailLimit(field)} required={required} onChange={event => updateDraft(item.id, field, event.target.value, true)} />}</label>)}
                <button type="button" className="outline-button" disabled={saving} onClick={() => void saveEdit(category, item)}>Save</button>
                <button type="button" className="text-button health-intake-action" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
              </div> : <>
                <strong>{item.name}</strong>
                {Object.entries(item.details || {}).filter(([, value]) => value).map(([key, value]) => <span key={key}>{({ allergenType: 'Type', dose: 'Dose', frequency: 'How often', reason: 'Reason', reaction: 'Reaction', context: 'Context', doseNumber: 'Dose / Dose Number', dateGiven: 'Date Given', location: 'Location / Clinic', notes: 'Notes' })[key] || key}: {value}</span>)}
                <span className="reported-health-provenance">{item.itemType === 'vaccination' && item.source === 'patient_reported' ? 'Patient-reported · not verified' : `Reported by you · ${isReviewed ? `reviewed: ${item.verificationStatus}` : 'not reviewed'}`}</span>
                {!readOnly && !isReviewed && <div className="reported-health-item-actions"><button type="button" className="text-button health-intake-action" disabled={saving} onClick={() => { setEditing(item.id); setDrafts(current => ({ ...current, [item.id]: { name: item.name, details: item.details || {} } })) }}>Edit</button><button type="button" className="text-button health-intake-action" disabled={saving} onClick={() => void archive(item)}>Remove</button></div>}
              </>}
            </li>
          })}
        </ul>
        {!readOnly && <>
          <div className="reported-health-entry-form">
            <label>{category.nameLabel}<input maxLength="160" value={drafts[category.key]?.name || ''} onChange={event => updateDraft(category.key, 'name', event.target.value)} /></label>
            {(category.detailFields || category.details.map(([field, label]) => [field, label, 'text', false])).map(([field, label, type, required]) => <label key={field}>{label}{field === 'allergenType' ? <select value={drafts[category.key]?.details?.[field] || ''} onChange={event => updateDraft(category.key, field, event.target.value, true)}><option value="">Not specified</option>{['medication','food','environmental','insect','latex','other','unknown'].map(option => <option key={option}>{option}</option>)}</select> : <input type={type} maxLength={detailLimit(field)} required={required} value={drafts[category.key]?.details?.[field] || ''} onChange={event => updateDraft(category.key, field, event.target.value, true)} />}</label>)}
            <button type="button" className="outline-button" disabled={saving} onClick={() => void addEntry(category)}>Add {category.singular}</button>
          </div>
          {category.key !== 'vaccination' && <div className="reported-health-unknown-actions"><button type="button" className="text-button health-intake-action" disabled={saving} onClick={() => void addEntry(category, 'none_known')}>None known</button><button type="button" className="text-button health-intake-action" disabled={saving} onClick={() => void addEntry(category, 'unknown')}>Not sure</button></div>}
        </>}
      </section>
    })}
    <p className="reported-health-disclaimer">Your reports are kept separate from clinician-confirmed records and prescriptions.</p>
  </section>
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function detailLimit(field) { return field === 'notes' ? 1000 : field === 'location' ? 160 : field === 'doseNumber' ? 80 : 240 }
