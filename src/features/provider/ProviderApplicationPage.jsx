import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { CREDENTIAL_REMOVAL_ERRORS, providerApplicationService } from '../../services/providerApplicationService.js'

const STEPS = ['Professional Role', 'Professional Details', 'License & Qualifications', 'Credential Documents', 'Review & Submit']
const EMPTY_FIELDS = {
  requested_provider_type: '', specialty_id: '', license_number: '', license_issuer: '', qualifications: '',
  years_experience: '', organization: '', professional_bio: '', languages: [], service_area: '',
}
const PROVIDER_TYPES = [
  ['doctor','Doctor'],
  ['nurse_aide','Nurse Aide'],
  ['skilled_nurse_aide','Skilled Nurse Aide'],
  ['special_nurse','Special Nurse'],
  ['caregiver','Caregiver'],
]
const DOCUMENT_TYPES = [['professional_license','Professional license'],['qualification_certificate','Qualification certificate'],['registration_evidence','Professional registration evidence'],['other','Other credential evidence']]
const STATUS_LABELS = { draft: 'Draft', submitted: 'Submitted — pending review', under_review: 'Under Review', verified: 'Verified', rejected: 'Rejected', withdrawn: 'Withdrawn' }

function fieldsFrom(application) {
  if (!application) return EMPTY_FIELDS
  return {
    requested_provider_type: application.requested_provider_type || '',
    specialty_id: application.requested_provider_type === 'doctor' ? application.specialty_id || '' : '',
    license_number: application.license_number || '', license_issuer: application.license_issuer || '', qualifications: application.qualifications || '',
    years_experience: application.years_experience ?? '', organization: application.organization || '',
    professional_bio: application.professional_bio || '', languages: application.languages || [], service_area: application.service_area || '',
  }
}

export function ProviderApplicationPage() {
  const { user } = useAuth()
  const [record, setRecord] = useState(null)
  const [specialties, setSpecialties] = useState([])
  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [applicationId, setApplicationId] = useState(null)
  const [documents, setDocuments] = useState([])
  const [step, setStep] = useState(0)
  const [screen, setScreen] = useState('loading')
  const [documentType, setDocumentType] = useState('professional_license')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState(null)

  async function load() {
    setScreen('loading'); setError('')
    try {
      const [data, specialtyRows] = await Promise.all([providerApplicationService.load(), providerApplicationService.listSpecialties()])
      setRecord(data); setSpecialties(specialtyRows)
      const app = data.application
      setApplicationId(app?.id || null); setFields(fieldsFrom(app)); setDocuments(app?.documents || [])
      setScreen(app?.status === 'draft' ? 'ready' : app ? 'status' : 'ready')
    } catch { setError('We could not load your provider application. Please try again.'); setScreen('error') }
  }

  useEffect(() => { void load() }, [])

  function change(field, value) { setFields(current => ({ ...current, [field]: value })); setError(''); setNotice('') }

  function changeProviderType(value) {
    setFields(current => ({
      ...current,
      requested_provider_type: value,
      specialty_id: value === 'doctor' ? current.specialty_id : '',
    }))
    setError(''); setNotice('')
  }

  async function saveDraft() {
    setBusy(true); setError(''); setNotice('')
    try {
      const id = await providerApplicationService.saveDraft(applicationId, fields)
      setApplicationId(id); setNotice('Draft saved. You can return to finish your application later.')
      return id
    } catch (failure) { setError(failure.message || 'Unable to save your draft. Please try again.'); return null }
    finally { setBusy(false) }
  }

  async function continueStep() {
    if (step === 0 && (!fields.requested_provider_type || (fields.requested_provider_type === 'doctor' && !fields.specialty_id))) {
      setError(fields.requested_provider_type === 'doctor' ? 'Choose a specialty to continue.' : 'Choose a provider type to continue.')
      return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const id = await providerApplicationService.saveDraft(applicationId, fields)
      setApplicationId(id); setStep(current => Math.min(STEPS.length - 1, current + 1))
    } catch (failure) { setError(failure.message || 'Unable to save your draft. Please try again.') }
    finally { setBusy(false) }
  }

  async function upload(file) {
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      const id = applicationId || await providerApplicationService.saveDraft(null, fields)
      setApplicationId(id)
      const uploaded = await providerApplicationService.uploadCredential(id, file, documentType)
      setDocuments(current => [...current, { id: uploaded.id, document_type: documentType, file_name: uploaded.fileName, storage_path: uploaded.storagePath, mime_type: uploaded.mimeType, file_size: uploaded.fileSize }])
      setNotice('Credential file added to your private application.')
    } catch (failure) { setError(failure.message || 'Unable to upload this credential. Please try again.') }
    finally { setBusy(false) }
  }

  async function submit() {
    setBusy(true); setError(''); setNotice('')
    try {
      const id = await providerApplicationService.saveDraft(applicationId, fields)
      setApplicationId(id)
      await providerApplicationService.submit(id)
      await load()
      setNotice('Application submitted. It is pending review; submission does not grant provider or clinical access.')
    } catch (failure) { setError(failure.message || 'Unable to submit your application. Please try again.') }
    finally { setBusy(false) }
  }

  async function download(document) {
    try {
      const url = await providerApplicationService.createDownloadUrl(document.storage_path || document.storagePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { setError('Unable to open this credential file. Please try again.') }
  }

  async function removeCredential(document) {
    if (!applicationId || record?.application?.status !== 'draft'
      || record.application.applicant_profile_id !== user?.id) return
    setBusy(true); setError(''); setNotice('')
    try {
      await providerApplicationService.removeCredential(applicationId, document.id)
      setDocuments(current => current.filter(item => item.id !== document.id))
      setNotice('Credential removed from your draft.')
    } catch (failure) {
      const reason = CREDENTIAL_REMOVAL_ERRORS.has(failure?.message) ? ` (${failure.message})` : ''
      setError(`We could not safely remove this credential${reason}. No success was recorded; please refresh and check the draft.`)
    } finally { setBusy(false) }
  }

  const ownsDraft = Boolean(user?.id && record?.application?.status === 'draft'
    && record.application.applicant_profile_id === user.id)

  if (screen === 'loading') return <section className="provider-application-page"><h1>Provider Application</h1><p role="status">Loading your application…</p></section>
  if (screen === 'error') return <section className="provider-application-page card"><h1>Provider Application</h1><p role="alert">{error}</p><button className="button button--secondary" type="button" onClick={() => void load()}>Try Again</button></section>
  if (record?.is_verified_provider) return <section className="provider-application-page card"><span className="eyebrow">Healthcare Provider</span><h1>Your provider account is already verified</h1><p>Use Provider Sign In to open your existing workspace.</p><Link className="button button--primary" to="/provider">Open Provider Workspace</Link></section>

  return <section className="provider-application-page">
    <header className="page-heading"><div><span className="eyebrow">Healthcare Provider</span><h1>Provider Application</h1><p>Apply to have your professional credentials reviewed by EasyCare.</p></div><Link className="button button--secondary" to="/settings">Profile Settings</Link></header>
    <div className="provider-application-safety"><strong>Applying does not make you a verified provider.</strong><span>Submitting an application does not change your account role or provide access to patients or the Provider Workspace.</span></div>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="profile-success" role="status">{notice}</p>}

    {screen === 'status' ? <div className="card provider-application-status"><span className="eyebrow">Application status</span><h2>{STATUS_LABELS[record.application.status] || 'Application status unavailable'}</h2><p>{record.application.status === 'submitted' || record.application.status === 'under_review' ? 'Your application is pending review. This is not provider approval and does not grant clinical access.' : record.application.status === 'verified' ? 'Your provider application has been approved. Use Provider Sign In to access your existing workspace.' : record.application.status === 'rejected' ? 'Your application was not approved.' : 'This application is closed.'}</p>{record.application.status === 'rejected' && record.application.decision_reason && <div className="provider-application-rejection"><strong>Reason</strong><p>{record.application.decision_reason}</p></div>}<dl><div><dt>Requested provider type</dt><dd>{PROVIDER_TYPES.find(([value]) => value === record.application.requested_provider_type)?.[1] || 'Not available'}</dd></div><div><dt>Submitted</dt><dd>{record.application.submitted_at ? new Date(record.application.submitted_at).toLocaleDateString() : 'Not available'}</dd></div></dl>{documents.map(document => <button key={document.id} type="button" className="provider-document-link" onClick={() => void download(document)}>Download {document.file_name}</button>)}</div> : <>
      {!applicationId && <div className="card provider-application-start"><h2>Start an application</h2><p>Your name and phone come from your signed-in EasyCare account. Requested provider type is reviewed and does not set your account role.</p><button className="button button--primary" type="button" disabled={busy} onClick={async () => { const id = await saveDraft(); if (id) setScreen('form') }}>Start Application</button></div>}
      {applicationId && screen === 'ready' && <div className="card provider-application-start"><h2>Continue your draft</h2><p>Save a draft at any point and return from Profile Settings to finish.</p><button className="button button--primary" type="button" onClick={() => setScreen('form')}>Continue Application</button></div>}
      {(screen === 'form' || (screen === 'ready' && applicationId)) && <div className="card provider-application-form">
        <ol className="provider-application-progress" aria-label="Application progress">{STEPS.map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}>{label}</li>)}</ol>
        {step === 0 && <div className="provider-application-fields"><h2>Professional Role</h2><p>Choose the role you are applying for. This is a request only.</p><label>Requested provider type<select value={fields.requested_provider_type} onChange={event => changeProviderType(event.target.value)}><option value="">Select provider type</option>{fields.requested_provider_type === 'nurse' && <option value="nurse" hidden>Nurse (legacy application)</option>}{PROVIDER_TYPES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>{fields.requested_provider_type === 'doctor' && <label>Specialty<select value={fields.specialty_id} onChange={event => change('specialty_id', event.target.value)}><option value="">Select specialty</option>{specialties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>}
        {step === 1 && <div className="provider-application-fields"><h2>Professional Details</h2><label>Full name<input value={record.profile?.full_name || ''} readOnly /></label><label>Phone number<input value={record.profile?.phone || ''} readOnly /></label><label>Years of experience<input type="number" min="0" max="80" value={fields.years_experience} onChange={event => change('years_experience', event.target.value)} /></label><label>Current organization or affiliation (optional)<input maxLength="200" value={fields.organization} onChange={event => change('organization', event.target.value)} /></label><label>Professional bio (optional)<textarea maxLength="3000" value={fields.professional_bio} onChange={event => change('professional_bio', event.target.value)} /></label><label>Languages (comma separated, optional)<input maxLength="400" value={fields.languages.join(', ')} onChange={event => change('languages', event.target.value.split(',').map(value => value.trim()).filter(Boolean).slice(0,10))} /></label><label>Service area (optional)<input maxLength="300" value={fields.service_area} onChange={event => change('service_area', event.target.value)} /></label></div>}
        {step === 2 && <div className="provider-application-fields"><h2>License & Qualifications</h2><label>Professional license or registration number<input maxLength="120" value={fields.license_number} onChange={event => change('license_number', event.target.value)} required /></label><label>License issuer<input maxLength="160" value={fields.license_issuer} onChange={event => change('license_issuer', event.target.value)} required /></label><label>Qualifications<textarea maxLength="4000" value={fields.qualifications} onChange={event => change('qualifications', event.target.value)} required /></label></div>}
        {step === 3 && <div className="provider-application-fields"><h2>Credential Documents</h2><p>Upload a license, qualification certificate, or other professional registration evidence. Files are private and visible only to you in this phase.</p><label>Document type<select value={documentType} onChange={event => setDocumentType(event.target.value)}>{DOCUMENT_TYPES.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Credential file (PDF, JPG, or PNG; up to 10 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>{documents.length === 0 ? <p>No credential documents uploaded yet.</p> : <ul className="provider-application-documents">{documents.map(document => <li key={document.id}><span>{DOCUMENT_TYPES.find(([value]) => value === document.document_type)?.[1] || 'Credential'} · {document.file_name}</span><span className="provider-application-document-actions"><button type="button" className="text-button" onClick={() => void download(document)}>Download</button>{ownsDraft && <button type="button" className="text-button" disabled={busy} onClick={() => setPendingRemoval(document)}>Remove {document.file_name}</button>}</span></li>)}</ul>}<small>At least one credential document is required before submission.</small></div>}
        {step === 4 && <div className="provider-application-fields"><h2>Review & Submit</h2><p>Check your details before sending them for review.</p><dl className="provider-application-review"><div><dt>Account name</dt><dd>{record.profile?.full_name || 'Not available'}</dd></div><div><dt>Phone</dt><dd>{record.profile?.phone || 'Not available'}</dd></div><div><dt>Requested role</dt><dd>{PROVIDER_TYPES.find(([value]) => value === fields.requested_provider_type)?.[1] || (fields.requested_provider_type === 'nurse' ? 'Nurse' : 'Not selected')}</dd></div>{fields.requested_provider_type === 'doctor' && <div><dt>Specialty</dt><dd>{specialties.find(item => item.id === fields.specialty_id)?.name || 'Not selected'}</dd></div>}<div><dt>License issuer</dt><dd>{fields.license_issuer || 'Not entered'}</dd></div><div><dt>Qualifications</dt><dd>{fields.qualifications || 'Not entered'}</dd></div><div><dt>Credential files</dt><dd>{documents.length}</dd></div></dl><p className="provider-application-safety"><strong>Submitting means Pending Review.</strong><span>It does not approve credentials, change your account role, create provider identity, or provide clinical access.</span></p></div>}
        <div className="provider-application-actions"><button type="button" className="button button--secondary" onClick={() => step > 0 ? setStep(current => current - 1) : setScreen('ready')} disabled={busy}>{step === 0 ? 'Save & Close' : 'Back'}</button><button type="button" className="button button--secondary" onClick={() => void saveDraft()} disabled={busy}>Save Draft</button>{step < STEPS.length - 1 ? <button type="button" className="button button--primary" onClick={() => void continueStep()} disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button> : <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy || documents.length === 0}>{busy ? 'Submitting…' : 'Submit Application'}</button>}</div>
      </div>}
    </>}
    {pendingRemoval && <div className="provider-application-confirm-backdrop"><section className="card provider-application-confirm" role="alertdialog" aria-modal="true" aria-labelledby="credential-remove-title" aria-describedby="credential-remove-description">
      <h2 id="credential-remove-title">Remove credential?</h2>
      <p id="credential-remove-description">Remove {pendingRemoval.file_name} from this draft? The private file and its application record will be removed together.</p>
      <div className="provider-application-actions"><button type="button" className="button button--secondary" disabled={busy} onClick={() => setPendingRemoval(null)}>Keep file</button><button type="button" className="button button--primary" disabled={busy} onClick={async () => { const document = pendingRemoval; setPendingRemoval(null); await removeCredential(document) }}>{busy ? 'Removing…' : 'Remove credential'}</button></div>
    </section></div>}
  </section>
}
