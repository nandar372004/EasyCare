import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { providerSetupService } from '../../services/providerSetupService.js'
import { getProviderSetupRedirect, validateProviderPassword } from './providerSetup.js'
import { PROVIDER_TYPE_LABELS } from './providerTypeLabels.js'
import { DoctorProfessionalInformationForm } from './DoctorProfessionalInformationForm.jsx'

function clearCallbackData() {
  if (typeof window === 'undefined' || window.location.pathname !== '/provider/setup') return
  if (window.location.search || window.location.hash) window.history.replaceState(window.history.state, '', '/provider/setup')
}

function InvalidProviderSetup() {
  return <main className="provider-setup-page"><section className="card provider-setup-card">
    <span className="eyebrow">Provider account setup</span><h1>Provider setup unavailable</h1>
    <p>This session is not linked to an eligible provider account. Sign in with the account details provided by your EasyCare administrator.</p>
    <Link className="button button--secondary" to="/provider/login">Provider sign in</Link>
  </section></main>
}

export function ProviderSetupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordErrors, setPasswordErrors] = useState({})
  const [form, setForm] = useState(null)
  const [doctorProfessionalInfo, setDoctorProfessionalInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileStep, setProfileStep] = useState(0)

  useEffect(() => { if (auth.status !== 'loading') clearCallbackData() }, [auth.status])
  useEffect(() => {
    const identity = auth.providerSetup
    if (!identity) return
    setForm({
      displayName: identity.displayName || identity.fullName,
      phone: identity.phone || '',
      bio: identity.bio || '',
      qualification: identity.qualification || '',
      specialtyId: identity.specialtyId || '',
      licenseNumber: identity.licenseNumber || '',
      teleconsultEnabled: identity.teleconsultEnabled,
      homeVisitEnabled: identity.homeVisitEnabled,
      consultationFeeMmk: identity.consultationFeeMmk === '' ? '' : String(identity.consultationFeeMmk),
    })
  }, [auth.providerSetup])
  if (auth.status === 'loading') return <main className="provider-setup-page"><p role="status">Checking your secure provider session…</p></main>
  if (!auth.isAuthenticated || !auth.providerSetup || auth.patient || auth.admin) return <InvalidProviderSetup />

  const identity = auth.providerSetup
  const redirectPath = getProviderSetupRedirect(identity.type)
  if (!redirectPath) return <InvalidProviderSetup />

  async function setField(field, value) { setForm(current => ({ ...current, [field]: value })) }
  async function submitPassword(event) {
    event.preventDefault()
    const errors = validateProviderPassword(password, confirmation)
    setPasswordErrors(errors)
    if (Object.keys(errors).length) return
    if (!providerSetupService) return setError('Secure account setup is unavailable. Try again later.')
    setBusy(true); setError('')
    try {
      await providerSetupService.changeInitialPassword(password)
      setPassword(''); setConfirmation('')
      await auth.refreshIdentity()
    } catch (failure) { setError(failure.message || 'We could not start provider setup.') }
    finally { setBusy(false) }
  }

  async function submitProfile(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await providerSetupService.complete(form)
      await auth.refreshIdentity()
      navigate(redirectPath, { replace: true })
    } catch (failure) { setError(failure.message || 'We could not save provider setup.') }
    finally { setBusy(false) }
  }

  const progressStep = identity.setupState === 'setup_required' ? 0 : profileStep + 1
  const progress = ['Change Password', 'Basic Information', identity.type === 'doctor' ? 'Professional Information' : 'Role Information', 'Review & Finish']
  return <main className="provider-setup-page"><section className="card provider-setup-card">
    <span className="eyebrow">Provider account setup · {PROVIDER_TYPE_LABELS[identity.type]}</span>
    <ol className="provider-setup-progress" aria-label="Setup progress">{progress.map((label, index) => <li key={label} className={index < progressStep ? 'done' : index === progressStep ? 'current' : ''} aria-current={index === progressStep ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <h1>{identity.setupState === 'ready' ? 'Provider setup complete' : identity.setupState === 'setup_required' ? 'Create your password' : 'Complete your provider profile'}</h1>
    {error && <p className="error-message" role="alert">{error}</p>}
    {identity.setupState === 'ready' ? <>
      <p>{identity.type === 'doctor' ? 'Your provider account setup is complete. You can review your professional information in your profile.' : `Your initial setup is complete. ${identity.verificationStatus !== 'verified' ? 'Clinical workspace access remains limited until EasyCare verifies your provider credentials.' : 'Your provider workspace is ready.'}`}</p>
      <button className="button button--primary" type="button" onClick={() => navigate(redirectPath, { replace: true })}>Continue to provider workspace</button>
    </> : identity.setupState === 'setup_required' ? <>
      <p>Choose a private password for your EasyCare provider account.</p>
      <form className="provider-setup-form" onSubmit={submitPassword}>
        <label>New Password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required aria-invalid={Boolean(passwordErrors.password)} /></label>
        {passwordErrors.password && <small className="field-error">{passwordErrors.password}</small>}
        <label>Confirm New Password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required aria-invalid={Boolean(passwordErrors.confirmation)} /></label>
        {passwordErrors.confirmation && <small className="field-error">{passwordErrors.confirmation}</small>}
        <p className="provider-setup-hint">Use at least 12 characters, including a letter and a number.</p>
        <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Changing password…' : 'Change password and continue'}</button>
      </form>
    </> : <>
      <p>Add the basic details needed to prepare your provider profile.</p>
      {profileStep === 0 && <form className="provider-setup-form" onSubmit={event => { event.preventDefault(); setProfileStep(1) }}><h2>Basic Information</h2>
        <label>Display name<input type="text" maxLength={160} required value={form?.displayName || ''} onChange={event => void setField('displayName', event.target.value)} /></label>
        <label>Phone<input type="tel" autoComplete="tel" required value={form?.phone || ''} onChange={event => void setField('phone', event.target.value)} /></label>
        <label>Short bio<textarea maxLength={1000} rows={4} value={form?.bio || ''} onChange={event => void setField('bio', event.target.value)} /></label>
        <button className="button button--primary" type="submit">Continue</button>
      </form>}
      {profileStep === 1 && identity.type === 'doctor' && <div className="provider-setup-form"><h2>Professional Information</h2>
        <DoctorProfessionalInformationForm
          providerId={identity.id}
          providerName={identity.displayName || identity.fullName}
          setupDetails={form}
          onSetupDetailsChange={patch => setForm(current => ({ ...current, ...patch }))}
          onSaved={(saved, details) => { setDoctorProfessionalInfo({ ...saved, specialty_name: details.specialtyName }); setProfileStep(2) }}
          onBack={() => setProfileStep(0)}
          actionLabel="Review"
        />
      </div>}
      {profileStep === 1 && identity.type !== 'doctor' && <div className="provider-setup-form"><h2>Role Information</h2><label>Qualification<input type="text" maxLength={300} value={form?.qualification || ''} onChange={event => void setField('qualification', event.target.value)} /></label>
        <div className="provider-setup-actions"><button className="button button--secondary" type="button" onClick={() => setProfileStep(0)}>Back</button><button className="button button--primary" type="button" onClick={() => setProfileStep(2)}>Review</button></div>
      </div>}
      {profileStep === 2 && <div className="provider-setup-form"><h2>Review &amp; Finish</h2><p>{identity.type === 'doctor' ? 'Review your saved professional information before finishing setup.' : 'Check these details before finishing setup. Professional credentials are verified separately by EasyCare.'}</p><dl className="provider-setup-review"><div><dt>Name</dt><dd>{form?.displayName}</dd></div><div><dt>Phone</dt><dd>{form?.phone}</dd></div><div><dt>Provider type</dt><dd>{PROVIDER_TYPE_LABELS[identity.type]}</dd></div>{identity.type === 'doctor' && <>
        <div><dt>Doctor Full Name</dt><dd>{doctorProfessionalInfo?.full_name || 'Not provided'}</dd></div>
        <div><dt>NRC</dt><dd>{doctorProfessionalInfo?.nrc || 'Not provided'}</dd></div>
        <div><dt>Date of Birth</dt><dd>{doctorProfessionalInfo?.date_of_birth || 'Not provided'}</dd></div>
        <div><dt>Work Experience</dt><dd>{doctorProfessionalInfo?.work_experience_years ?? 'Not provided'}{doctorProfessionalInfo?.work_experience_years != null ? ' years' : ''}</dd></div>
        <div><dt>Current Hospital / Clinic</dt><dd>{doctorProfessionalInfo?.current_hospital || 'Not provided'}</dd></div>
        <div><dt>Medical Qualification</dt><dd>{doctorProfessionalInfo?.medical_qualification || 'Not provided'}</dd></div>
        <div><dt>Specialty</dt><dd>{doctorProfessionalInfo?.specialty_name || 'Not selected'}</dd></div>
        <div><dt>MMC Registration Number</dt><dd>{doctorProfessionalInfo?.mmc_registration_number || 'Not provided'}</dd></div>
        <div><dt>Medical Practitioner License Number</dt><dd>{doctorProfessionalInfo?.medical_practitioner_license_number || 'Not provided'}</dd></div>
        <div><dt>Medical Practitioner License Type</dt><dd>{doctorProfessionalInfo?.license_type || 'Not provided'}</dd></div>
        <div><dt>Consultation</dt><dd>{[form?.teleconsultEnabled && 'Teleconsultation', form?.homeVisitEnabled && 'Home visit'].filter(Boolean).join(', ') || 'Not selected'}</dd></div>
        <div><dt>Consultation Fee</dt><dd>{form?.consultationFeeMmk ? `${form.consultationFeeMmk} MMK` : 'Not set'}</dd></div>
        <div><dt>License Document</dt><dd>{doctorProfessionalInfo?.medical_license_file_name || 'Not uploaded'}</dd></div>
      </>}</dl><div className="provider-setup-actions"><button className="button button--secondary" type="button" onClick={() => setProfileStep(1)}>Back</button><button className="button button--primary" type="button" disabled={busy || !form} onClick={event => void submitProfile({ preventDefault: () => event.preventDefault() })}>{busy ? 'Saving profile…' : 'Complete setup'}</button></div></div>}
    </>}
  </section></main>
}
