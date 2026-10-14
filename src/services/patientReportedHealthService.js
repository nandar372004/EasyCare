import { supabase } from '../lib/supabase.js'

const itemTypes = new Set(['allergy', 'condition', 'medication'])
const entryKinds = new Set(['item', 'none_known', 'unknown'])
const bloodTypes = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'])
let fixtureRecord = { bloodType: 'Unknown', bloodTypeSource: 'legacy_patient_profile', bloodTypeVerificationStatus: 'unverified', items: [] }
let fixtureSequence = 0

export async function getMyReportedHealthIntake(client = supabase) {
  if (!client) return structuredClone(fixtureRecord)
  const { data, error } = await client.rpc('get_my_reported_health_intake')
  if (error) throw error
  return data
}

export async function saveMyReportedBloodType(bloodType, client = supabase) {
  if (!bloodTypes.has(bloodType)) throw new Error('Choose a valid blood type.')
  if (!client) { fixtureRecord = { ...fixtureRecord, bloodType, bloodTypeSource: 'patient_reported', bloodTypeVerificationStatus: 'unverified' }; return structuredClone(fixtureRecord) }
  const { data, error } = await client.rpc('save_my_reported_blood_type', { p_blood_type: bloodType })
  if (error) throw error
  return data
}

export async function addMyReportedHealthItem({ itemType, entryKind = 'item', name = null, details = {} }, client = supabase) {
  if (!itemTypes.has(itemType) || !entryKinds.has(entryKind)) throw new Error('Invalid reported health item.')
  if (!client) {
    fixtureRecord.items = fixtureRecord.items.filter(item => item.itemType !== itemType)
    fixtureRecord.items.push({ id: `fixture-${++fixtureSequence}`, itemType, entryKind, name, details, source: 'patient_reported', verificationStatus: 'unverified' })
    return structuredClone(fixtureRecord)
  }
  const { data, error } = await client.rpc('add_my_reported_health_item', {
    p_item_type: itemType, p_entry_kind: entryKind, p_item_name: name, p_details: details,
  })
  if (error) throw error
  return data
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function vaccinationPayload({ name, doseNumber = '', dateGiven, location = '', notes = '' }) {
  if (!name?.trim()) throw new Error('Enter a vaccine name.')
  if (name.trim().length > 160) throw new Error('Vaccine name must be 160 characters or fewer.')
  if (!validDateOnly(dateGiven)) throw new Error('Enter a valid date given.')
  const details = { dateGiven }
  for (const [key, value, limit] of [['doseNumber', doseNumber, 80], ['location', location, 160], ['notes', notes, 1000]]) {
    const clean = String(value || '').trim()
    if (clean.length > limit) throw new Error(`${key === 'doseNumber' ? 'Dose / dose number' : key === 'location' ? 'Location / clinic' : 'Notes'} is too long.`)
    if (clean) details[key] = clean
  }
  return { p_item_name: name.trim(), p_details: details }
}

export async function addMyReportedVaccination(input, client = supabase) {
  const payload = vaccinationPayload(input)
  if (!client) {
    fixtureRecord.items.push({ id: `fixture-${++fixtureSequence}`, itemType: 'vaccination', entryKind: 'item', name: payload.p_item_name, details: payload.p_details, source: 'patient_reported', verificationStatus: 'unverified' })
    return structuredClone(fixtureRecord)
  }
  const { data, error } = await client.rpc('add_my_reported_vaccination', payload)
  if (error) throw error
  return data
}

export async function updateMyReportedVaccination({ id, ...input }, client = supabase) {
  if (!id) throw new Error('A reported vaccination is required.')
  const payload = vaccinationPayload(input)
  if (!client) {
    fixtureRecord.items = fixtureRecord.items.map(item => item.id === id && item.itemType === 'vaccination' ? { ...item, name: payload.p_item_name, details: payload.p_details } : item)
    return structuredClone(fixtureRecord)
  }
  const { data, error } = await client.rpc('update_my_reported_vaccination', { p_item_id: id, ...payload })
  if (error) throw error
  return data
}

export async function updateMyReportedHealthItem({ id, name, details = {} }, client = supabase) {
  if (!id || !name?.trim()) throw new Error('A name is required.')
  if (!client) {
    fixtureRecord.items = fixtureRecord.items.map(item => item.id === id ? { ...item, name: name.trim(), details } : item)
    return structuredClone(fixtureRecord)
  }
  const { data, error } = await client.rpc('update_my_reported_health_item', {
    p_item_id: id, p_item_name: name.trim(), p_details: details,
  })
  if (error) throw error
  return data
}

export async function archiveMyReportedHealthItem(id, client = supabase) {
  if (!id) throw new Error('A reported item is required.')
  if (!client) { fixtureRecord.items = fixtureRecord.items.filter(item => item.id !== id); return structuredClone(fixtureRecord) }
  const { data, error } = await client.rpc('archive_my_reported_health_item', { p_item_id: id })
  if (error) throw error
  return data
}
