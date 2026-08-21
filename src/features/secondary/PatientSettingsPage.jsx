import { useCallback, useEffect, useState } from 'react'
import { LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { bloodTypeOptions, genderOptions, normalizeMyanmarPhone } from '../auth/registrationSchema.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { presentationRepository } from '../../services/repositories/index.js'

const emptyForm = {
  fullName: '', dateOfBirth: '', gender: '', preferredLanguage: 'en',
  addressLine: '', township: '', city: '', emergencyName: '',
  emergencyRelationship: '', emergencyPhone: '', bloodType: 'Unknown',
  noKnownAllergies: false, allergies: '', existingMedicalConditions: '', currentMedications: '',
}

function formFromPatient(patient) {
  const care = patient.care_preferences ?? {}
  return {
    fullName: patient.full_name ?? '', dateOfBirth: patient.date_of_birth ?? '',
    gender: patient.gender ?? '', preferredLanguage: patient.preferred_language ?? 'en',
    addressLine: patient.address_line ?? '', township: patient.township ?? '', city: patient.city ?? '',
    emergencyName: patient.emergency_contact_name ?? '',
    emergencyRelationship: patient.emergency_contact_relationship ?? '',
    emergencyPhone: patient.emergency_contact_phone ?? '', bloodType: patient.blood_type ?? 'Unknown',
    noKnownAllergies: Boolean(care.noKnownAllergies), allergies: care.allergies ?? '',
    existingMedicalConditions: care.existingMedicalConditions ?? '', currentMedications: care.currentMedications ?? '',
  }
}

function validate(form) {
  if (!form.fullName.trim()) return 'Full name is required.'
  if (form.fullName.trim().length > 160) return 'Full name must be 160 characters or fewer.'
  if (form.dateOfBirth && new Date(`${form.dateOfBirth}T00:00:00`) >= new Date()) return 'Date of birth must be in the past.'
  if (form.gender && !genderOptions.includes(form.gender)) return 'Choose a valid gender.'
  if (!['en', 'my'].includes(form.preferredLanguage)) return 'Choose a valid preferred language.'
  if (!bloodTypeOptions.includes(form.bloodType)) return 'Choose a valid blood type.'
  if (!form.noKnownAllergies && !form.allergies.trim()) return 'List allergies or select “No known allergies”.'
  if (form.allergies.length > 1000 || form.existingMedicalConditions.length > 2000 || form.currentMedications.length > 2000) return 'Medical profile text is too long.'
  if (form.emergencyPhone.trim()) {
    try { normalizeMyanmarPhone(form.emergencyPhone) } catch { return 'Enter a valid emergency contact phone number.' }
  }
  return null
}

export function PatientSettingsPage() {
  const { patient, user, signOut, synchronizePatient } = useAuth()
  const { setLanguage } = useLocalization()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(''); setSuccess('')
    if (!patient?.id || !user?.id) { setError('Unable to load your profile. Please try again.'); setLoading(false); return }
    try {
      const current = await presentationRepository.getPatientProfile({ patientId: patient.id, authUserId: user.id })
      setProfile(current); setForm(formFromPatient(current))
    } catch { setError('Unable to load your profile. Please try again.') }
    finally { setLoading(false) }
  }, [patient?.id, user?.id])

  useEffect(() => { void load() }, [load])
  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [field]: value, ...(field === 'noKnownAllergies' && value ? { allergies: '' } : {}) }))
    setError(''); setSuccess('')
  }

  const save = async (event) => {
    event.preventDefault(); if (saving) return
    const validationError = validate(form)
    if (validationError) { setError(validationError); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      const carePreferences = {
        ...(profile?.care_preferences ?? {}),
        noKnownAllergies: form.noKnownAllergies,
        allergies: form.noKnownAllergies ? '' : form.allergies.trim(),
        existingMedicalConditions: form.existingMedicalConditions.trim(),
        currentMedications: form.currentMedications.trim(),
      }
      const updated = await presentationRepository.updatePatientProfile({
        patientId: patient.id,
        authUserId: user.id,
        changes: {
          full_name: form.fullName.trim(), date_of_birth: form.dateOfBirth || null,
          gender: form.gender || null, preferred_language: form.preferredLanguage,
          address_line: form.addressLine.trim() || null, township: form.township.trim() || null,
          city: form.city.trim() || null, emergency_contact_name: form.emergencyName.trim() || null,
          emergency_contact_relationship: form.emergencyRelationship.trim() || null,
          emergency_contact_phone: form.emergencyPhone.trim() ? normalizeMyanmarPhone(form.emergencyPhone) : null,
          blood_type: form.bloodType, care_preferences: carePreferences,
        },
      })
      setProfile(updated); setForm(formFromPatient(updated)); synchronizePatient(updated)
      setLanguage(updated.preferred_language); setSuccess('Profile updated successfully.')
    } catch { setError('Unable to update your profile. Please try again.') }
    finally { setSaving(false) }
  }

  const logout = async () => { await signOut(); navigate('/login', { replace: true }) }
  if (loading) return <section><h1>Profile Settings</h1><p role="status">Loading profile…</p></section>
  if (!profile) return <section className="card empty-state"><h1>Profile Settings</h1><p role="alert">{error}</p><button className="outline-button" type="button" onClick={() => void load()}>Try again</button></section>

  return <section className="secondary-page patient-settings-page">
    <header className="page-heading secondary-heading"><div className="secondary-title-icon"><SettingsIcon /></div><div><h1>Profile Settings</h1><p>Manage your patient information.</p></div></header>
    <form className="patient-profile-form" onSubmit={save}>
      <ProfileSection title="Personal Information">
        <Field label="Full Name"><input value={form.fullName} onChange={update('fullName')} maxLength="160" required /></Field>
        <Field label="Date of Birth"><input type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} /></Field>
        <Field label="Gender"><select value={form.gender} onChange={update('gender')}><option value="">Choose gender</option>{genderOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Preferred Language"><select value={form.preferredLanguage} onChange={update('preferredLanguage')}><option value="en">English</option><option value="my">မြန်မာ</option></select></Field>
        <Field label="Phone Number"><input value={profile.primary_phone ?? ''} readOnly aria-readonly="true" /><small>Used for account sign-in · read only</small></Field>
      </ProfileSection>
      <ProfileSection title="Address">
        <Field label="Address"><input value={form.addressLine} onChange={update('addressLine')} maxLength="300" /></Field>
        <Field label="Township"><input value={form.township} onChange={update('township')} maxLength="120" /></Field>
        <Field label="City"><input value={form.city} onChange={update('city')} maxLength="120" /></Field>
      </ProfileSection>
      <ProfileSection title="Emergency Contact">
        <Field label="Name"><input value={form.emergencyName} onChange={update('emergencyName')} maxLength="160" /></Field>
        <Field label="Relationship"><input value={form.emergencyRelationship} onChange={update('emergencyRelationship')} maxLength="80" /></Field>
        <Field label="Phone Number"><input value={form.emergencyPhone} onChange={update('emergencyPhone')} inputMode="tel" /></Field>
      </ProfileSection>
      <ProfileSection title="Medical Profile">
        <Field label="Blood Type"><select value={form.bloodType} onChange={update('bloodType')}>{bloodTypeOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <label className="profile-checkbox"><input type="checkbox" checked={form.noKnownAllergies} onChange={update('noKnownAllergies')} /><span>No known allergies</span></label>
        <Field label="Allergies"><textarea value={form.allergies} onChange={update('allergies')} disabled={form.noKnownAllergies} maxLength="1000" rows="3" /></Field>
        <Field label="Existing Medical Conditions"><textarea value={form.existingMedicalConditions} onChange={update('existingMedicalConditions')} maxLength="2000" rows="3" /></Field>
        <Field label="Current Medications"><textarea value={form.currentMedications} onChange={update('currentMedications')} maxLength="2000" rows="3" /></Field>
      </ProfileSection>
      {error && <div className="error-message" role="alert">{error}</div>}
      {success && <div className="profile-success" role="status">{success}</div>}
      <div className="profile-save-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button></div>
    </form>
    <article className="card profile-account"><h2>Account</h2><p><strong>{profile.primary_phone}</strong><br /><small>This phone number is used for account sign-in.</small></p><button className="outline-button danger-text" type="button" onClick={logout}><LogOut aria-hidden="true" /> Logout</button></article>
  </section>
}

function ProfileSection({ title, children }) { return <fieldset className="card profile-section"><legend>{title}</legend><div className="profile-fields">{children}</div></fieldset> }
function Field({ label, children }) { return <label className="profile-field"><span>{label}</span>{children}</label> }
