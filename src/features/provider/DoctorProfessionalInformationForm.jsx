import { useEffect, useState } from 'react'
import { DOCTOR_LICENSE_TYPES, doctorProfessionalInformationService } from '../../services/doctorProfessionalInformationService.js'
import { providerSetupService } from '../../services/providerSetupService.js'

export function calculateDoctorAge(dateOfBirth, today = new Date()) {
  if (!dateOfBirth) return ''
  const [year, month, day] = dateOfBirth.split('-').map(Number)
  if (!year || !month || !day) return ''
  let age = today.getUTCFullYear() - year
  const birthdayNotReached = today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  if (birthdayNotReached) age -= 1
  return age >= 0 ? age : ''
}

const blankFields = name => ({
  full_name: name || '', nrc: '', date_of_birth: '', work_experience_years: '', current_hospital: '',
  medical_qualification: '', mmc_registration_number: '', medical_practitioner_license_number: '', license_type: '',
  medical_license_storage_path: null, medical_license_file_name: null, medical_license_mime_type: null,
})

export function DoctorProfessionalInformationForm({
  providerId,
  providerName,
  setupDetails,
  onSetupDetailsChange,
  onSaved,
  onBack,
  actionLabel = 'Save Professional Information',
}) {
  const [fields, setFields] = useState(() => blankFields(providerName))
  const [file, setFile] = useState(null)
  const [specialties, setSpecialties] = useState([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    if (!providerId) { setLoading(false); return undefined }
    doctorProfessionalInformationService.load(providerId).then(data => {
      if (active && data) setFields({ ...blankFields(providerName), ...data })
    }).catch(() => { if (active) setError('We could not load your saved professional information. Please retry.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [providerId, providerName])

  useEffect(() => {
    if (!setupDetails) return undefined
    let active = true
    providerSetupService?.listSpecialties().then(rows => { if (active) setSpecialties(rows) })
      .catch(() => { if (active) setError('We could not load the specialty list. Refresh and try again.') })
    return () => { active = false }
  }, [Boolean(setupDetails)])

  function change(field, value) { setFields(current => ({ ...current, [field]: value })); setError(''); setNotice('') }
  function changeSetupDetail(field, value) { onSetupDetailsChange?.({ [field]: value }); setError('') }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const saved = await doctorProfessionalInformationService.save(providerId, fields, file)
      setFields(current => ({ ...current, ...saved })); setFile(null)
      if (onSaved) onSaved(saved, { specialtyName: specialties.find(item => item.id === setupDetails?.specialtyId)?.name || '' })
      else setNotice('Professional information saved.')
    } catch (failure) { setError(failure.message || 'Unable to save professional information.') }
    finally { setBusy(false) }
  }

  async function openLicense() {
    try { const url = await doctorProfessionalInformationService.createLicenseUrl(fields.medical_license_storage_path); window.open(url, '_blank', 'noopener,noreferrer') }
    catch (failure) { setError(failure.message || 'Unable to open the private license document.') }
  }

  return <>
    {error && <p className="error-message" role="alert">{error}</p>}
    {notice && <p className="profile-success" role="status">{notice}</p>}
    {loading ? <p role="status">Loading saved information…</p> : <form className="doctor-professional-form" onSubmit={save}>
      <fieldset><legend>Personal Information</legend>
        <label>Doctor Full Name *<input autoComplete="name" maxLength={160} required value={fields.full_name} onChange={event => change('full_name', event.target.value)} /></label>
        <label>NRC *<input autoComplete="off" maxLength={80} required value={fields.nrc} onChange={event => change('nrc', event.target.value)} /></label>
        <label>Date of Birth *<input type="date" required max={new Date().toISOString().slice(0, 10)} value={fields.date_of_birth || ''} onChange={event => change('date_of_birth', event.target.value)} /></label>
        <label>Age<input readOnly aria-label="Age, calculated from date of birth" value={calculateDoctorAge(fields.date_of_birth) === '' ? '' : `${calculateDoctorAge(fields.date_of_birth)} years`} placeholder="Calculated from date of birth" /></label>
        <label>Work Experience (Years) *<input type="number" min="0" max="80" step="1" required value={fields.work_experience_years} onChange={event => change('work_experience_years', event.target.value)} /></label>
        <label>Current Hospital / Clinic<input maxLength={200} value={fields.current_hospital || ''} onChange={event => change('current_hospital', event.target.value)} /></label>
      </fieldset>
      <fieldset><legend>Professional Qualifications</legend>
        <label>Medical Qualification *<input maxLength={300} required value={fields.medical_qualification} onChange={event => change('medical_qualification', event.target.value)} /></label>
        {setupDetails && <label>Specialty *<select required value={setupDetails.specialtyId || ''} onChange={event => changeSetupDetail('specialtyId', event.target.value)}><option value="">Choose a specialty</option>{specialties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label>MMC Registration Number *<input maxLength={120} required value={fields.mmc_registration_number} onChange={event => change('mmc_registration_number', event.target.value)} /></label>
        <label>Medical Practitioner License Number (ဆမ) *<input maxLength={120} required value={fields.medical_practitioner_license_number} onChange={event => change('medical_practitioner_license_number', event.target.value)} /></label>
        <label>License Type *<select required value={fields.license_type} onChange={event => change('license_type', event.target.value)}><option value="">Choose license type</option>{DOCTOR_LICENSE_TYPES.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      </fieldset>
      {setupDetails && <fieldset><legend>Consultation</legend>
        <label className="provider-setup-check"><input type="checkbox" checked={setupDetails.teleconsultEnabled === true} onChange={event => changeSetupDetail('teleconsultEnabled', event.target.checked)} /> Teleconsultation</label>
        <label className="provider-setup-check"><input type="checkbox" checked={setupDetails.homeVisitEnabled === true} onChange={event => changeSetupDetail('homeVisitEnabled', event.target.checked)} /> Home Visit</label>
        <label>Consultation Fee (MMK)<input type="number" min="0" step="1" value={setupDetails.consultationFeeMmk ?? ''} onChange={event => changeSetupDetail('consultationFeeMmk', event.target.value)} /></label>
      </fieldset>}
      <fieldset><legend>License Document</legend>
        <label>Upload Medical License<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setNotice('') }} /></label>
        <small>PDF, JPG, or PNG. Maximum 10 MB. The document is private to your provider account.</small>
        {file && <p aria-live="polite">Selected: {file.name}</p>}
        {!file && fields.medical_license_file_name && <p>Saved document: <button className="text-button" type="button" onClick={() => void openLicense()}>{fields.medical_license_file_name}</button></p>}
      </fieldset>
      <div className="doctor-professional-actions">
        {onBack && <button className="button button--secondary" type="button" onClick={onBack}>Back</button>}
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : actionLabel}</button>
      </div>
    </form>}
  </>
}
