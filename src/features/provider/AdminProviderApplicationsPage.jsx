import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { adminProviderApplicationService } from '../../services/adminProviderApplicationService.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { WorkspaceSwitcher } from '../auth/WorkspaceSwitcher.jsx'
import { PROVIDER_TYPE_LABELS } from './providerTypeLabels.js'

function AdminSessionActions() {
  const auth = useAuth()
  const navigate = useNavigate()
  async function signOut() {
    try { await auth.signOut(); navigate('/login', { replace: true }) }
    catch { navigate('/login', { replace: true, state: { signOutError: true } }) }
  }
  return <div className="admin-session-actions"><WorkspaceSwitcher /><button className="button button--secondary" type="button" onClick={() => void signOut()}>Sign out</button></div>
}

const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Rejected',
}

const DOCUMENT_LABELS = {
  professional_license: 'Professional license',
  qualification_certificate: 'Qualification certificate',
  registration_evidence: 'Registration evidence',
  other: 'Other credential',
}

function dateLabel(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString()
}

export function AdminProviderApplicationsPage() {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    adminProviderApplicationService.list(status || null)
      .then(result => { if (active) setRows(Array.isArray(result) ? result : []) })
      .catch(() => { if (active) { setRows([]); setError('We could not load provider applications. Please try again.') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [status, reloadKey])

  return <main className="admin-review-page">
    <header className="admin-review-heading">
      <div><span className="eyebrow">Authorized administration</span><h1>Provider application review</h1><p>Review submitted professional applications and their private credential evidence.</p><nav className="admin-provider-nav" aria-label="Admin areas"><Link to="/admin/providers">Provider management</Link><Link to="/admin/provider-applications" aria-current="page">Application review</Link><Link to="/admin/support-messages">Support Messages</Link></nav></div>
      <AdminSessionActions />
    </header>
    <div className="admin-review-filters">
      <label htmlFor="provider-application-status">Application status</label>
      <select id="provider-application-status" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="">All review statuses</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {error && <div role="alert" className="error-message">{error} <button className="button button--secondary" type="button" onClick={() => setReloadKey(value => value + 1)}>Try again</button></div>}
    {loading ? <p role="status">Loading provider applications…</p> : rows.length === 0 ? <section className="card admin-review-empty"><h2>No applications found</h2><p>Submitted applications will appear here for authorized review.</p></section> : <div className="admin-review-table-wrap"><table className="admin-review-table">
      <thead><tr><th scope="col">Applicant</th><th scope="col">Requested provider type</th><th scope="col">Specialty</th><th scope="col">Status</th><th scope="col">Submitted</th><th scope="col"><span className="sr-only">Application details</span></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.application_id}>
        <td>{row.applicant_name}</td>
        <td>{PROVIDER_TYPE_LABELS[row.requested_provider_type] || 'Not selected'}</td>
        <td>{row.specialty_name || 'Not selected'}</td>
        <td><span className={`admin-review-status admin-review-status--${row.status}`}>{STATUS_LABELS[row.status] || row.status}</span></td>
        <td>{dateLabel(row.submitted_at)}</td>
        <td><Link className="button button--secondary" to={`/admin/provider-applications/${row.application_id}`}>Review</Link></td>
      </tr>)}</tbody>
    </table></div>}
  </main>
}

export function AdminProviderApplicationDetailPage() {
  const { applicationId } = useParams()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [signedUrls, setSignedUrls] = useState({})

  async function load() {
    setLoading(true)
    setError('')
    try { setRecord(await adminProviderApplicationService.load(applicationId)) }
    catch { setRecord(null); setError('We could not load this submitted application.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [applicationId])

  async function startReview() {
    setBusy(true); setError(''); setNotice('')
    try { await adminProviderApplicationService.startReview(applicationId); setNotice('Review started.'); await load() }
    catch { setError('Unable to start review. The application may no longer be submitted.') }
    finally { setBusy(false) }
  }

  async function approve() {
    setBusy(true); setError(''); setNotice('')
    try { await adminProviderApplicationService.approve(applicationId); setDialog(''); setNotice('Application approved and provider identity verified.'); await load() }
    catch { setError('Unable to approve this application. Check its eligibility and credential evidence, then try again.') }
    finally { setBusy(false) }
  }

  async function reject() {
    setBusy(true); setError(''); setNotice('')
    try { await adminProviderApplicationService.reject(applicationId, rejectionReason); setDialog(''); setRejectionReason(''); setNotice('Application rejected. The reason is visible to the applicant.'); await load() }
    catch { setError('Unable to reject this application. Add an applicant-facing reason and try again.') }
    finally { setBusy(false) }
  }

  async function openCredential(document) {
    setError('')
    try {
      const url = await adminProviderApplicationService.createCredentialUrl(applicationId, document.storage_path)
      setSignedUrls(current => ({ ...current, [document.id]: url }))
    } catch { setError('Unable to create a secure credential link. Please try again.') }
  }

  if (loading) return <main className="admin-review-page"><p role="status">Loading application details…</p></main>
  if (!record) return <main className="admin-review-page"><p role="alert" className="error-message">{error || 'Application unavailable.'}</p><button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button><Link to="/admin/provider-applications">Back to review queue</Link></main>

  const { application, applicant, documents = [], specialty } = record
  const statusLabel = STATUS_LABELS[application.status] || application.status

  return <main className="admin-review-page">
    <Link className="admin-review-back" to="/admin/provider-applications">← Review queue</Link>
    <header className="admin-review-heading"><div><span className="eyebrow">Provider application</span><h1>{applicant.full_name}</h1><p>{PROVIDER_TYPE_LABELS[application.requested_provider_type] || 'Provider type not selected'} · {specialty || 'Specialty not selected'}</p></div><div className="admin-review-heading-actions"><span className={`admin-review-status admin-review-status--${application.status}`}>{statusLabel}</span><AdminSessionActions /></div></header>
    {error && <p role="alert" className="error-message">{error}</p>}{notice && <p role="status" className="profile-success">{notice}</p>}

    <section className="card admin-review-card"><h2>Applicant identity</h2><dl className="admin-review-details"><div><dt>Full name</dt><dd>{applicant.full_name}</dd></div><div><dt>Phone</dt><dd>{applicant.phone || 'Not provided'}</dd></div><div><dt>Email</dt><dd>{applicant.email || 'Not provided'}</dd></div><div><dt>Current account role</dt><dd>{applicant.role}</dd></div><div><dt>Account status</dt><dd>{applicant.status}</dd></div><div><dt>Submitted</dt><dd>{dateLabel(application.submitted_at)}</dd></div></dl></section>

    <section className="card admin-review-card"><h2>Professional details</h2><dl className="admin-review-details">
      <div><dt>Requested provider type</dt><dd>{PROVIDER_TYPE_LABELS[application.requested_provider_type] || 'Not selected'}</dd></div>
      <div><dt>Specialty</dt><dd>{specialty || 'Not selected'}</dd></div>
      <div><dt>License or registration number</dt><dd>{application.license_number || 'Not provided'}</dd></div>
      <div><dt>Issuer</dt><dd>{application.license_issuer || 'Not provided'}</dd></div>
      <div><dt>Qualifications</dt><dd>{application.qualifications || 'Not provided'}</dd></div>
      <div><dt>Years of experience</dt><dd>{application.years_experience ?? 'Not provided'}</dd></div>
      <div><dt>Organization</dt><dd>{application.organization || 'Not provided'}</dd></div>
      <div><dt>Languages</dt><dd>{application.languages?.join(', ') || 'Not provided'}</dd></div>
      <div><dt>Service area</dt><dd>{application.service_area || 'Not provided'}</dd></div>
      <div className="admin-review-details-wide"><dt>Professional bio</dt><dd>{application.professional_bio || 'Not provided'}</dd></div>
    </dl></section>

    <section className="card admin-review-card"><h2>Private credential documents</h2><p>Files stay in the private credential bucket. Secure links expire after 60 seconds.</p>
      {documents.length === 0 ? <p>No credential documents are recorded.</p> : <ul className="admin-review-documents">{documents.map(document => <li key={document.id}>
        <div><strong>{DOCUMENT_LABELS[document.document_type] || 'Credential'}</strong><span>{document.file_name} · {Math.ceil(document.file_size / 1024)} KB</span></div>
        {signedUrls[document.id] ? <a className="button button--secondary" href={signedUrls[document.id]} target="_blank" rel="noreferrer">Open secure document</a> : <button className="button button--secondary" type="button" onClick={() => void openCredential(document)}>Prepare secure link</button>}
      </li>)}</ul>}
    </section>

    {application.decision_reason && application.status === 'rejected' && <section className="card admin-review-card"><h2>Applicant-facing rejection reason</h2><p>{application.decision_reason}</p><p>Decision recorded {dateLabel(application.decided_at)}.</p></section>}
    {application.status === 'verified' && <section className="card admin-review-card"><h2>Verified provider identity</h2><p>Provider ID: <code>{application.provisioned_provider_id}</code></p><p>Approved {dateLabel(application.decided_at)}.</p></section>}

    <section className="admin-review-actions" aria-label="Review actions">
      {application.status === 'submitted' && <button className="button button--primary" type="button" disabled={busy} onClick={() => void startReview()}>Start Review</button>}
      {application.status === 'under_review' && <><button className="button button--primary" type="button" disabled={busy} onClick={() => setDialog('approve')}>Approve</button><button className="button button--danger" type="button" disabled={busy} onClick={() => setDialog('reject')}>Reject</button></>}
    </section>

    {dialog && <div className="admin-review-dialog-backdrop"><section className="card admin-review-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-review-dialog-title">
      <h2 id="admin-review-dialog-title">{dialog === 'approve' ? 'Approve this application?' : 'Reject this application?'}</h2>
      {dialog === 'approve' ? <p>Approval verifies the submitted provider identity, assigns its compatible account role, and records the credential reviewer. It does not create patient relationships.</p> : <><label htmlFor="rejection-reason">Safe reason shown to the applicant</label><textarea id="rejection-reason" minLength={8} maxLength={500} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} /><small>Use an applicant-facing explanation. Do not enter internal reviewer notes.</small></>}
      <div className="admin-review-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={() => setDialog('')}>Cancel</button>{dialog === 'approve' ? <button className="button button--primary" type="button" disabled={busy} onClick={() => void approve()}>Confirm Approval</button> : <button className="button button--danger" type="button" disabled={busy || rejectionReason.trim().length < 8} onClick={() => void reject()}>Confirm Rejection</button>}</div>
    </section></div>}
  </main>
}
