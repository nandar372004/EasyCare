import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminProviderManagementService } from '../../services/adminProviderManagementService.js'
import { PROVIDER_TYPE_LABELS } from './providerTypeLabels.js'
import { WorkspaceSwitcher } from '../auth/WorkspaceSwitcher.jsx'

const PROVIDER_TYPES = ['doctor', 'nurse_aide', 'skilled_nurse_aide', 'special_nurse']
const ACCOUNT_LABELS = { invited: 'Invited', active: 'Active', disabled: 'Disabled' }
const SETUP_LABELS = { setup_required: 'Setup required', profile_incomplete: 'Profile incomplete', ready: 'Ready' }

export function AdminProvidersPage() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ email: '', displayName: '', providerType: 'doctor', initialPassword: '', confirmInitialPassword: '' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    adminProviderManagementService.list().then(rows => { if (active) { setProviders(rows); setError('') } })
      .catch(() => { if (active) { setProviders([]); setError('We could not load provider accounts.') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (form.initialPassword !== form.confirmInitialPassword) return setError('The initial passwords do not match.')
    if (form.initialPassword.length < 12 || form.initialPassword.length > 128 || !/[A-Za-z]/.test(form.initialPassword) || !/[0-9]/.test(form.initialPassword))
      return setError('Use an initial password with 12 to 128 characters, including a letter and a number.')
    setBusy(true)
    try {
      await adminProviderManagementService.create(form)
      setForm({ email: '', displayName: '', providerType: 'doctor', initialPassword: '', confirmInitialPassword: '' })
      setShowForm(false)
      setNotice('Provider account created. The provider must change the initial password and complete setup before using EasyCare.')
      setReload(value => value + 1)
    } catch (failure) { setError(failure.message || 'We could not create this provider account.') }
    finally { setBusy(false) }
  }

  return <main className="admin-review-page">
    <nav className="admin-provider-nav" aria-label="Admin areas"><Link to="/admin/providers" aria-current="page">Providers</Link><Link to="/admin/provider-applications">Application review</Link><Link to="/admin/support-messages">Support Messages</Link><WorkspaceSwitcher /></nav>
    <header className="admin-review-heading">
      <div><span className="eyebrow">Authorized administration</span><h1>Provider management</h1><p>Create provider accounts and review their account and setup status.</p></div>
      <button className="button button--primary" type="button" onClick={() => { setShowForm(value => !value); setError(''); setNotice('') }}>{showForm ? 'Cancel' : 'Add Provider'}</button>
    </header>
    {error && <p role="alert" className="error-message">{error} <button className="button button--secondary" type="button" onClick={() => setReload(value => value + 1)}>Try again</button></p>}
    {notice && <p role="status" className="profile-success">{notice}</p>}
    {showForm && <form className="card admin-provider-form" onSubmit={submit}>
      <h2>Create provider account</h2><p>Share the initial password with the provider securely. They must change it before completing profile setup.</p>
      <label>Email<input type="email" required maxLength={320} autoComplete="email" value={form.email} onChange={event => setForm(value => ({ ...value, email: event.target.value }))} /></label>
      <label>Name<input type="text" required maxLength={160} autoComplete="name" value={form.displayName} onChange={event => setForm(value => ({ ...value, displayName: event.target.value }))} /></label>
      <label>Provider type<select value={form.providerType} onChange={event => setForm(value => ({ ...value, providerType: event.target.value }))}>{PROVIDER_TYPES.map(type => <option key={type} value={type}>{PROVIDER_TYPE_LABELS[type]}</option>)}</select></label>
      <label>Initial password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.initialPassword} onChange={event => setForm(value => ({ ...value, initialPassword: event.target.value }))} /></label>
      <label>Confirm initial password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.confirmInitialPassword} onChange={event => setForm(value => ({ ...value, confirmInitialPassword: event.target.value }))} /></label>
      <div className="admin-review-actions"><button className="button button--primary" type="submit" disabled={busy || form.initialPassword !== form.confirmInitialPassword}>{busy ? 'Creating account…' : 'Create Provider'}</button></div>
    </form>}
    {loading ? <p role="status">Loading provider accounts…</p> : providers.length === 0 ? <section className="card admin-review-empty"><h2>No provider accounts yet</h2><p>New accounts you create will appear here. Existing synthetic directory entries are not changed.</p></section> : <div className="admin-review-table-wrap"><table className="admin-review-table admin-provider-table">
      <thead><tr><th scope="col">Provider</th><th scope="col">Email</th><th scope="col">Provider type</th><th scope="col">Account status</th><th scope="col">Profile/setup</th></tr></thead>
      <tbody>{providers.map(row => { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; return <tr key={row.id}><td>{row.display_name || profile?.full_name || 'Unnamed provider'}</td><td>{profile?.email || 'No login account'}</td><td>{PROVIDER_TYPE_LABELS[row.provider_type] || row.provider_type}</td><td><span className={`admin-review-status admin-review-status--${profile ? row.account_status : 'disabled'}`}>{profile ? ACCOUNT_LABELS[row.account_status] || row.account_status : 'No login account'}</span></td><td><span className={`admin-review-status admin-review-status--${profile ? row.setup_state : 'profile_incomplete'}`}>{profile ? SETUP_LABELS[row.setup_state] || row.setup_state : 'Unlinked record'}</span></td></tr> })}</tbody>
    </table></div>}
  </main>
}
