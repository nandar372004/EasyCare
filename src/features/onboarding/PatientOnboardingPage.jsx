import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand } from '../../components/Brand.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import { getPatientOnboarding, savePatientOnboarding } from '../../services/patientOnboardingService.js'
import { PatientReportedHealthIntake } from '../health/PatientReportedHealthIntake.jsx'

const emptyProfile = { addressLine: '', township: '', city: '', emergencyContactName: '', emergencyContactRelationship: '', emergencyContactPhone: '' }
const steps = ['Personal Details', 'Contact & Address', 'Health Information', 'Family Setup', 'Review']

export function PatientOnboardingPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [record, setRecord] = useState(null)
  const [profile, setProfile] = useState(emptyProfile)
  const [step, setStep] = useState(0)
  const [screen, setScreen] = useState('welcome')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [familyChoice, setFamilyChoice] = useState('self')

  useEffect(() => {
    let active = true
    getPatientOnboarding().then((value) => {
      if (!active) return
      setRecord(value)
      setProfile({ ...emptyProfile, ...(value.profile || {}) })
      if (value.status === 'in_progress') setScreen('setup')
      if (value.status === 'completed') navigate('/dashboard', { replace: true })
    }).catch(() => { if (active) setError('We could not load your profile setup. Please try again.') })
    return () => { active = false }
  }, [navigate])

  async function persist(status) {
    setSaving(true); setError('')
    try {
      const result = await savePatientOnboarding(status, profile)
      setRecord(result)
      return true
    } catch {
      setError('We could not save your profile setup. Please try again.')
      return false
    } finally { setSaving(false) }
  }

  async function begin() {
    if (!await persist('in_progress')) return
    setScreen('setup')
  }
  async function skip() {
    const profileToSave = screen === 'setup' ? profile : {}
    setSaving(true); setError('')
    try {
      const result = await savePatientOnboarding('skipped', profileToSave)
      setRecord(result)
      navigate('/dashboard', { replace: true })
    } catch { setError('We could not save your profile setup. Please try again.') }
    finally { setSaving(false) }
  }
  async function next() {
    const isLastStep = step === steps.length - 1
    if (!await persist(isLastStep ? 'completed' : 'in_progress')) return
    if (isLastStep) navigate('/dashboard', { replace: true })
    else setStep(current => current + 1)
  }
  async function back() {
    if (await persist('in_progress')) setStep(current => Math.max(0, current - 1))
  }
  const identity = record?.identity || {}

  return <main className="patient-onboarding-page">
    <header className="patient-onboarding-brand"><Brand /></header>
    <section className="patient-onboarding-card card" aria-live="polite">
      {error && <div className="error-message" role="alert">{error}</div>}
      {screen === 'welcome' ? <>
        <span className="eyebrow">Your EasyCare journey</span>
        <h1>Welcome to EasyCare{identity.fullName ? `, ${identity.fullName.split(' ')[0]}` : ''}</h1>
        <p>Let’s set up your profile so EasyCare can support you better.</p>
        <ul className="onboarding-benefits"><li>Keep your important health information organized</li><li>Prepare for appointments and care</li><li>Stay connected with your care journey</li></ul>
        <div className="onboarding-actions"><button className="button button--primary" type="button" onClick={begin} disabled={saving || !record}>Set Up My Profile</button><button className="outline-button" type="button" onClick={skip} disabled={saving || !record}>I’ll Do This Later</button></div>
        <p className="onboarding-signin-note">You can return to this anytime from your dashboard.</p>
      </> : <>
        <span className="eyebrow">Optional profile setup</span><h1>Complete your profile</h1>
        <p>Step {step + 1} of {steps.length}: {steps[step]}</p>
        <ol className="onboarding-progress" aria-label="Profile setup progress">{steps.map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}>{label}</li>)}</ol>
        {step === 0 && <div className="onboarding-fields">
          <label>Full Name<input value={identity.fullName || auth.patient?.full_name || ''} readOnly /></label>
          <label>Date of Birth<input value={identity.dateOfBirth || 'Not provided'} readOnly /></label>
          <label>Phone Number<input value={identity.phone || 'Not provided'} readOnly /></label>
        </div>}
        {step === 1 && <div className="onboarding-fields">
          <label>Address (optional)<input maxLength="200" value={profile.addressLine} onChange={e => setProfile(current => ({ ...current, addressLine: e.target.value }))} /></label>
          <label>Township (optional)<input maxLength="200" value={profile.township} onChange={e => setProfile(current => ({ ...current, township: e.target.value }))} /></label>
          <label>City (optional)<input maxLength="200" value={profile.city} onChange={e => setProfile(current => ({ ...current, city: e.target.value }))} /></label>
          <label>Emergency Contact Name (optional)<input maxLength="200" value={profile.emergencyContactName} onChange={e => setProfile(current => ({ ...current, emergencyContactName: e.target.value }))} /></label>
          <label>Relationship (optional)<input maxLength="200" value={profile.emergencyContactRelationship} onChange={e => setProfile(current => ({ ...current, emergencyContactRelationship: e.target.value }))} /></label>
          <label>Emergency Contact Phone (optional)<input type="tel" inputMode="tel" maxLength="24" value={profile.emergencyContactPhone} onChange={e => setProfile(current => ({ ...current, emergencyContactPhone: e.target.value }))} /></label>
        </div>}
        {step === 2 && <><PatientReportedHealthIntake /><p className="onboarding-optional-note">You can skip this step and still finish your profile.</p></>}
        {step === 3 && <section className="onboarding-family-step" aria-labelledby="onboarding-family-heading">
          <h2 id="onboarding-family-heading">How will you use EasyCare?</h2>
          <p>Family setup is optional. Family membership helps organize care; it does not share health information.</p>
          <label className="onboarding-family-choice"><input type="radio" name="family-choice" value="self" checked={familyChoice === 'self'} onChange={() => setFamilyChoice('self')} /><span><strong>Just Myself</strong><small>Continue with your personal EasyCare account.</small></span></label>
          <label className="onboarding-family-choice"><input type="radio" name="family-choice" value="family" checked={familyChoice === 'family'} onChange={() => setFamilyChoice('family')} /><span><strong>Myself and My Family</strong><small>Create or join a family group with other adults.</small></span></label>
          {familyChoice === 'family' && <div className="onboarding-family-next"><p>Each adult needs their own EasyCare account. Health information stays private until that adult grants specific permissions.</p><Link className="button button--secondary" to="/family">Open Family Setup</Link></div>}
          <p className="onboarding-optional-note">Adult family groups are supported. Child and dependent profiles are not yet available.</p>
        </section>}
        {step === 4 && <><h2>Review your information</h2><p>Your personal and contact details are saved to your profile. Health details remain patient-reported until reviewed by a clinician.</p><PatientReportedHealthIntake readOnly /></>}
        <div className="onboarding-actions onboarding-step-actions"><button type="button" className="outline-button" onClick={back} disabled={saving || step === 0}>Back</button>{step === 2 && <button type="button" className="outline-button" onClick={() => setStep(3)} disabled={saving}>Skip Health Information</button>}<button type="button" className="button button--primary" onClick={next} disabled={saving}>{saving ? 'Saving…' : step === steps.length - 1 ? 'Finish Setup' : 'Continue'}</button><button type="button" className="text-button" onClick={skip} disabled={saving}>I’ll Do This Later</button></div>
        <p className="onboarding-signin-note"><Link to="/dashboard">Return to dashboard</Link></p>
      </>}
    </section>
  </main>
}
