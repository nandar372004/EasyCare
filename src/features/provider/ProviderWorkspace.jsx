import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { WorkspaceSwitcher } from '../auth/WorkspaceSwitcher.jsx'
import { getProviderTypeLabel } from './providerTypeLabels.js'
import { providerWorkspaceService } from '../../services/providerWorkspaceService.js'
import { providerAppointmentService } from '../../services/providerAppointmentService.js'
import { providerAvailabilityService } from '../../services/providerAvailabilityService.js'
import { providerSetupService } from '../../services/providerSetupService.js'
import { medicalDocumentService } from '../../services/medicalDocumentService.js'
import { supabase } from '../../lib/supabase.js'

export function ProviderShell() {
  const auth = useAuth()
  const navigate = useNavigate()
  const providerName = auth.provider?.displayName || auth.providerSetup?.displayName || auth.providerSetup?.fullName || 'Provider'
  const providerType = auth.provider?.type || auth.providerSetup?.type
  const navItems = providerType === 'doctor'
    ? [['/provider', 'Dashboard'], ['/provider/appointments', 'Appointments'], ['/provider/availability', 'Availability'], ['/provider/patients', 'Patients'], ['/provider/profile', 'Profile'], ['/provider/settings', 'Settings']]
    : [['/provider', 'Dashboard'], ['/provider/assigned-care', 'Assigned Care'], ['/provider/work', providerType === 'special_nurse' ? 'Monitoring' : providerType === 'skilled_nurse_aide' ? 'Monitoring / Tasks' : 'Tasks / Visits'], ['/provider/profile', 'Profile'], ['/provider/settings', 'Settings']]
  const [signOutError, setSignOutError] = useState(false)
  async function logout() {
    setSignOutError(false)
    try { await auth.signOut(); navigate('/provider/login', { replace: true }) }
    catch { setSignOutError(true); navigate('/provider/login', { replace: true, state: { signOutError: true } }) }
  }
  return <div className="provider-shell">
    <header className="provider-header"><Link to="/provider" className="provider-brand">EasyCare <span>Clinical Workspace</span></Link><div className="provider-header-actions"><span className="provider-header-identity"><strong>{providerName}</strong><small>{getProviderTypeLabel(providerType)}</small></span>{signOutError && <span className="sr-only" role="status">Sign-out failed; the local workspace was cleared.</span>}<WorkspaceSwitcher /><details className="provider-account-menu"><summary aria-label="Profile menu">Account</summary><Link to="/provider/profile">Profile</Link><Link to="/provider/settings">Settings</Link><button type="button" onClick={() => void logout()}>Sign out</button></details></div></header>
    <div className="provider-workspace-layout">
      <nav className="provider-nav" aria-label="Provider workspace">{navItems.map(([to, label], index) => <NavLink key={to} end={index === 0 || to === '/provider/assigned-care'} to={to}>{label}</NavLink>)}</nav>
      <main className="provider-content"><Outlet /></main>
    </div>
  </div>
}

export function ProviderOverviewPage() {
  const auth = useAuth()
  const type = auth.provider?.type || auth.providerSetup?.type
  if (type !== 'doctor') return <ProviderCareDashboard />
  const providerName = auth.provider?.displayName || auth.providerSetup?.displayName || auth.providerSetup?.fullName || 'Provider'
  const [count, setCount] = useState(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [summary, setSummary] = useState({ appointments: null, availability: null })
  useEffect(() => {
    let active = true
    setError(false)
    setCount(null)
    providerWorkspaceService.listPatients().then(rows => { if (active) setCount(rows.length) }).catch(() => { if (active) setError(true) })
    Promise.all([providerAppointmentService.list(), providerAvailabilityService.listMySlots(auth.provider?.id)])
      .then(([appointments, slots]) => { if (active) setSummary({ appointments, availability: slots }) })
      .catch(() => { if (active) setSummary({ appointments: [], availability: [] }) })
    return () => { active = false }
  }, [reloadKey, auth.provider?.id])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayAppointments = summary.appointments?.filter(row => row.scheduled_start?.slice(0, 10) === today) || []
  const upcomingAppointments = summary.appointments?.filter(row => new Date(row.scheduled_start) >= new Date() && ['pending', 'confirmed'].includes(row.status)) || []
  const pendingAppointments = summary.appointments?.filter(row => row.status === 'pending') || []
  return <section className="provider-overview">
    <span className="eyebrow">Clinical Workspace</span>
    <h1>Welcome, {providerName}</h1>
    {auth.provider ? <p>Your provider workspace is ready.</p> : <p>Your initial setup is complete. Clinical access remains limited until EasyCare verifies your provider credentials.</p>}
    <div className="provider-summary-grid">
      <article className="card"><h2>Today’s appointments</h2><p>{summary.appointments === null ? 'Loading appointments…' : todayAppointments.length}</p><Link to="/provider/appointments">Review schedule</Link></article>
      <article className="card"><h2>Upcoming</h2><p>{summary.appointments === null ? 'Loading appointments…' : upcomingAppointments.length}</p><Link to="/provider/appointments">View upcoming</Link></article>
      <article className="card"><h2>Pending requests</h2><p>{summary.appointments === null ? 'Loading appointments…' : pendingAppointments.length}</p><Link to="/provider/appointments">Review requests</Link></article>
      <article className="card"><h2>Available slots</h2><p>{summary.availability === null ? 'Loading availability…' : summary.availability.filter(slot => slot.status === 'available').length}</p><Link to="/provider/availability">Manage availability</Link></article>
      <article className="card"><h2>Authorized Patients</h2>{error ? <><p role="alert">Unable to load your authorized patient count.</p><button className="button button--secondary" type="button" onClick={() => setReloadKey(value => value + 1)}>Try again</button></> : <p role={count === null ? 'status' : undefined}>{count === null ? 'Loading your authorized patient count…' : `${count} current patients`}</p>}<Link className="button button--primary" to="/provider/patients">View Patients</Link></article>
      <article className="card"><h2>Appointments</h2><p>Review requests and confirmed visits.</p><Link to="/provider/appointments">Open appointments</Link></article>
      <article className="card"><h2>Availability</h2><p>Manage bookable consultation slots.</p><Link to="/provider/availability">Manage availability</Link></article>
      <article className="card"><h2>Care Plans</h2><p>Review and manage plans for your patients.</p><Link to="/provider/care-plans">View Care Plans</Link></article>
    </div>
  </section>
}

function ProviderCareDashboard() {
  const auth = useAuth()
  const type = auth.provider?.type || auth.providerSetup?.type
  const label = getProviderTypeLabel(type)
  const [patients, setPatients] = useState(null)
  useEffect(() => { let active = true; providerWorkspaceService.listPatients().then(rows => { if (active) setPatients(rows) }).catch(() => { if (active) setPatients([]) }); return () => { active = false } }, [auth.provider?.id])
  return <section className="provider-overview"><span className="eyebrow">Provider Workspace</span><h1>{label} Dashboard</h1><p>Welcome, {auth.provider?.displayName || auth.providerSetup?.displayName || 'Provider'}.</p><div className="provider-summary-grid"><article className="card"><h2>Assigned Care</h2><p>{patients === null ? 'Loading assigned care…' : `${patients.length} current patient relationships`}</p><Link to="/provider/assigned-care">View assigned care</Link></article><article className="card"><h2>{type === 'special_nurse' ? 'Monitoring' : type === 'skilled_nurse_aide' ? 'Monitoring / Tasks' : 'Tasks / Visits'}</h2><p>Task and monitoring tools are not available for this account yet.</p></article></div></section>
}

export function ProviderProfilePage() {
  const auth = useAuth(); const profile = { ...(auth.providerSetup || {}), ...(auth.provider || {}) }; const type = profile.type
  const photoUrl = profile.photoUrl || profile.avatarUrl || auth.user?.user_metadata?.avatar_url
  const [specialtyName, setSpecialtyName] = useState('')
  useEffect(() => { let active = true; if (type === 'doctor' && profile.specialtyId) providerSetupService?.listSpecialties().then(items => { if (active) setSpecialtyName(items.find(item => item.id === profile.specialtyId)?.name || profile.specialtyId) }).catch(() => { if (active) setSpecialtyName(profile.specialtyId) }); return () => { active = false } }, [type, profile.specialtyId])
  const fields = [['Display name', profile.displayName || profile.fullName], ['Email', auth.user?.email, true], ['Phone', profile.phone], ['Bio', profile.bio], ['Provider type', getProviderTypeLabel(type), true], ['Account status', profile.accountStatus || (auth.provider ? 'Active' : 'Setup') , true], ['Setup status', profile.setupState || 'Ready', true]]
  if (type === 'doctor') fields.push(['Specialty', specialtyName || profile.specialtyName || profile.specialtyId], ['License / registration', profile.licenseNumber], ['Qualification', profile.qualification], ['Consultation type', [profile.teleconsultEnabled && 'Teleconsultation', profile.homeVisitEnabled && 'Home visit'].filter(Boolean).join(', ')], ['Consultation fee', profile.consultationFeeMmk ? `${profile.consultationFeeMmk} MMK` : 'Not set'])
  return <section className="provider-profile"><h1>Profile</h1><div className="card provider-profile-card">{photoUrl ? <img className="provider-avatar" src={photoUrl} alt="Provider profile" /> : <div className="provider-avatar" aria-hidden="true">{(profile.displayName || profile.fullName || 'P').slice(0, 1).toUpperCase()}</div>}<dl>{fields.map(([label, value, fixed]) => <div key={label}><dt>{label}{fixed ? ' · read-only' : ''}</dt><dd>{value || 'Not provided'}</dd></div>)}</dl>{type === 'doctor' && <Link className="button button--secondary" to="/provider/professional-information">Edit Professional Information</Link>}<p>Profile updates are not available yet.</p></div></section>
}

export function ProviderSettingsPage() {
  const auth = useAuth(); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  async function changePassword(event) { event.preventDefault(); setMessage(''); if (password.length < 12 || password !== confirmation) { setMessage('Use at least 12 characters and make both password fields match.'); return } if (!supabase || !auth.session?.user) { setMessage('Password changes are unavailable in this session.'); return } setBusy(true); try { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setMessage('Password updated.'); setPassword(''); setConfirmation('') } catch { setMessage('Password could not be updated. Please try again.') } finally { setBusy(false) } }
  return <section className="provider-settings"><h1>Settings</h1><div className="card"><h2>Account</h2><label>Email<input readOnly value={auth.user?.email || ''} /></label><form onSubmit={changePassword}><h2>Change password</h2><label>New password<input type="password" autoComplete="new-password" minLength={12} value={password} onChange={event => setPassword(event.target.value)} required /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label><button className="button button--primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form>{message && <p role="status">{message}</p>}<button className="button button--secondary" type="button" onClick={() => void auth.signOut()}>Sign out</button></div></section>
}

export function ProviderWorkPlaceholder() { const type = useAuth().provider?.type; const label = type === 'special_nurse' ? 'Monitoring' : type === 'skilled_nurse_aide' ? 'Monitoring and tasks' : 'Tasks and visits'; return <section><h1>{label}</h1><div className="card"><p>{label} are not available in the current provider workspace.</p></div></section> }

export function ProviderPatientsPage() {
  const [patients, setPatients] = useState([])
  const [status, setStatus] = useState('loading')
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [patientDocuments, setPatientDocuments] = useState([])
  const [documentsStatus, setDocumentsStatus] = useState('idle')
  const [documentError, setDocumentError] = useState('')
  const [documentsReloadKey, setDocumentsReloadKey] = useState(0)
  const [openingDocumentId, setOpeningDocumentId] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let active = true
    setStatus('loading')
    setPatients([])
    setSelectedPatient(null)
    providerWorkspaceService.listPatients().then(rows => { if (active) { setPatients(rows); setStatus(rows.length ? 'ready' : 'empty') } }).catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [reloadKey])
  useEffect(() => {
    let active = true
    if (!selectedPatient?.id) { setPatientDocuments([]); setDocumentsStatus('idle'); setDocumentError(''); return undefined }
    setPatientDocuments([]); setDocumentsStatus('loading'); setDocumentError('')
    medicalDocumentService.list(selectedPatient.id)
      .then(rows => { if (active) { setPatientDocuments(rows); setDocumentsStatus(rows.length ? 'ready' : 'empty') } })
      .catch(() => { if (active) { setDocumentsStatus('error'); setDocumentError('We could not load documents allowed by this patient relationship.') } })
    return () => { active = false }
  }, [selectedPatient?.id, documentsReloadKey])

  async function openPatientDocument(document) {
    if (!selectedPatient?.id || openingDocumentId) return
    setOpeningDocumentId(document.id); setDocumentError('')
    try {
      const url = await medicalDocumentService.createSignedUrl(document, selectedPatient.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { setDocumentError('This document is no longer available under the current clinical relationship. Refresh and try again.') }
    finally { setOpeningDocumentId('') }
  }
  return <section className="provider-patients">
    <span className="eyebrow">Clinical Workspace</span><h1>Patients</h1>
    {status === 'loading' && <p role="status">Loading your authorized patients…</p>}
    {status === 'error' && <div className="card provider-empty-state" role="alert"><h2>Patient list unavailable</h2><p>We could not load patients connected to your current clinical relationships.</p><button className="button button--secondary" type="button" onClick={() => setReloadKey(value => value + 1)}>Try again</button></div>}
    {status === 'empty' && <div className="card"><h2>No current patients</h2><p>Patients appear here when there is an active clinical relationship.</p></div>}
    {selectedPatient && <>
      <p role="status">Selected patient: {selectedPatient.displayName}</p>
      <section className="card provider-patient-documents" aria-labelledby="provider-patient-documents-title">
        <h2 id="provider-patient-documents-title">Patient Medical Documents</h2>
        <p>Patient-uploaded source files are shown only while your current clinical relationship authorizes record access. Files have not been interpreted by EasyCare.</p>
        {documentsStatus === 'loading' && <p role="status">Loading authorized documents…</p>}
        {documentsStatus === 'error' && <div role="alert"><p>{documentError}</p><button className="button button--secondary" type="button" onClick={() => setDocumentsReloadKey(value => value + 1)}>Try again</button></div>}
        {documentsStatus === 'empty' && <p>No patient-uploaded documents are available under this relationship.</p>}
        {documentsStatus === 'ready' && <ul className="medical-document-list-items">{patientDocuments.map(document => <li className="medical-document-card" key={document.id}>
          <div className="medical-document-card-main"><span className="eyebrow">{document.document_type.replaceAll('_', ' ')}</span><h3>{document.title}</h3><p>{document.original_filename || document.title}</p></div>
          <button className="button button--secondary" type="button" disabled={Boolean(openingDocumentId)} onClick={() => void openPatientDocument(document)}>{openingDocumentId === document.id ? 'Opening…' : 'View / Download'}</button>
        </li>)}</ul>}
        {documentError && documentsStatus !== 'error' && <p role="alert">{documentError}</p>}
      </section>
    </>}
    {status === 'ready' && <div className="provider-patient-list">{patients.map(patient => <article className="card provider-patient-card" key={patient.id}><h2>{patient.displayName}</h2><p>Relationship: {patient.relationshipContext === 'appointment' ? 'Appointment' : 'Care assignment'}</p><button className="button button--secondary" type="button" onClick={() => setSelectedPatient(patient)} aria-pressed={selectedPatient?.id === patient.id}>Select patient</button></article>)}</div>}
  </section>
}

export { ProviderCarePlansPlaceholder } from './ProviderCarePlans.jsx'
