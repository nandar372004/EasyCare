import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, ClipboardList, CreditCard, FileText, Pill, BellRing } from 'lucide-react'
import { familyService } from '../../services/familyService.js'

const permissions = [
  { key: 'appointments', label: 'Appointments / Booking', description: 'View and manage appointments where supported.', Icon: CalendarDays },
  { key: 'care_plans', label: 'Care Plan', description: 'View authorized shared care-plan information.', Icon: ClipboardList },
  { key: 'payments', label: 'Payments', description: 'Access payment information and actions where supported.', Icon: CreditCard },
  { key: 'records', label: 'Health Records', description: 'View authorized health records.', Icon: FileText },
  { key: 'medical_documents', label: 'Medical Documents', description: 'Follows Health Records access; it is not a separate permission.', Icon: FileText, derived: true },
  { key: 'medications', label: 'Medications', description: 'View authorized medication information.', Icon: Pill },
  { key: 'alerts', label: 'Health Alerts', description: 'An additional existing permission.', Icon: BellRing },
]
const emptyPermissions = { appointments: false, care_plans: false, payments: false, records: false, medications: false, alerts: false }
const activeAuthorization = authorization => authorization?.status === 'active' && (!authorization.expires_at || Date.parse(authorization.expires_at) > Date.now())
const localDateTime = value => {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function FamilyAccessPermissions({ familyName = 'My Family' }) {
  const [groups, setGroups] = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadGroups = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await familyService.loadMyFamilyManagement()
      if (result.groups.status === 'error') throw new Error('Unable to load family groups.')
      const available = result.groups.data || []
      setGroups(available)
      setSelectedGroupId(current => available.some(group => group.id === current) ? current : available[0]?.id || '')
    } catch {
      setError('Unable to load family access settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMembers = useCallback(async () => {
    if (!selectedGroupId) { setMembers([]); return }
    try {
      setMembers(await familyService.getFamilyMembers(selectedGroupId) || [])
    } catch {
      setError('Unable to load family access settings.')
    }
  }, [selectedGroupId])

  useEffect(() => { void loadGroups() }, [loadGroups])
  useEffect(() => { void loadMembers() }, [loadMembers])

  const group = groups.find(item => item.id === selectedGroupId)
  const activeMembers = members.filter(member => !member.is_self && !['removed', 'inactive'].includes(String(member.status || '').toLowerCase()) && member.is_active !== false)

  async function save(member, nextPermissions, expiresAt) {
    if (!group || !member || busyId) return
    setBusyId(member.id)
    setError('')
    setNotice('')
    try {
      const authorization = member.authorization
      if (!Object.values(nextPermissions).some(Boolean)) {
        if (authorization?.id) await familyService.revokeFamilyAuthorization(authorization.id)
      } else {
        await familyService.grantFamilyAuthorization(member.id, nextPermissions, expiresAt)
      }
      setEditingId('')
      setNotice(`Access updated for ${member.display_name}.`)
      await loadMembers()
    } catch (failure) {
      setError(failure.message || 'Unable to update family access.')
    } finally {
      setBusyId('')
    }
  }

  return <section id="family-access-permissions" className="card command-section family-access-section" aria-labelledby="family-access-heading">
    <div className="family-access-heading"><div><span className="command-banner-label">SHARING CONTROLS</span><h2 id="family-access-heading">Access &amp; Permissions</h2><p>{familyName} · Membership does not automatically share health information.</p></div>
      {groups.length > 1 && <label>Family<select aria-label="Family group for access settings" value={selectedGroupId} onChange={event => { setSelectedGroupId(event.target.value); setMembers([]); setEditingId('') }}>{groups.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>}
    </div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading access settings…</p> : !group ? <p>No family group is available.</p> : !activeMembers.length ? <p>No active family members to show.</p> : <>
      <p className="family-access-readonly-note">You control access to your own health information. Family membership does not grant access, and you cannot grant access to another member’s records.</p>
      <div className="family-access-member-list">{activeMembers.map(member => {
        const authorization = member.authorization
        const isActive = activeAuthorization(authorization)
        const isExpired = authorization?.status === 'expired' || (authorization?.expires_at && Date.parse(authorization.expires_at) <= Date.now())
        const status = isActive ? 'Active access' : isExpired ? 'Expired' : ['revoked', 'inactive'].includes(authorization?.status) ? 'Revoked' : 'No access'
        const allowed = key => key === 'medical_documents' ? isActive && authorization?.records === true : isActive && authorization?.[key] === true
        const editable = !isExpired && !['removed', 'inactive'].includes(String(member.status || '').toLowerCase())
        const initial = { ...emptyPermissions, appointments: authorization?.appointments === true, care_plans: authorization?.care_plans === true, payments: authorization?.payments === true, records: authorization?.records === true, medications: authorization?.medications === true, alerts: authorization?.alerts === true }
        return <AccessMemberCard key={member.id} member={member} status={status} allowed={allowed} editable={editable} editing={editingId === member.id} busy={busyId === member.id} initial={initial} onEdit={() => setEditingId(member.id)} onCancel={() => setEditingId('')} onSave={(values, expiresAt) => save(member, values, expiresAt)} />
      })}</div>
    </>}
  </section>
}

function AccessMemberCard({ member, status, allowed, editable, editing, busy, initial, onEdit, onCancel, onSave }) {
  const [values, setValues] = useState(initial)
  const [expiresAt, setExpiresAt] = useState(localDateTime(member.authorization?.expires_at))
  const [consent, setConsent] = useState(false)
  useEffect(() => {
    setValues(initial)
    setExpiresAt(localDateTime(member.authorization?.expires_at))
  }, [member.id, member.authorization?.id, member.authorization?.status, member.authorization?.expires_at, member.authorization?.appointments, member.authorization?.care_plans, member.authorization?.payments, member.authorization?.records, member.authorization?.medications, member.authorization?.alerts])
  function submit(event) {
    event.preventDefault()
    const expiry = new Date(expiresAt)
    const latest = new Date(); latest.setFullYear(latest.getFullYear() + 1)
    if (!Object.values(values).some(Boolean) && member.authorization?.id) { onSave(values, null); return }
    if (!Object.values(values).some(Boolean) || !consent || !Number.isFinite(+expiry) || +expiry <= Date.now() || +expiry > +latest) return
    onSave(values, expiry.toISOString())
  }
  return <article className="family-access-member card">
    <header className="family-access-person"><span className="command-avatar" aria-hidden="true">{String(member.display_name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')}</span><div><h3>{member.display_name}</h3><p>{member.relationshipLabel || 'Family member'} · {member.role === 'owner' ? 'Owner' : 'Member'}</p></div><span className={`command-status family-access-status${status === 'Active access' ? ' is-allowed' : status === 'Expired' || status === 'Revoked' ? ' is-expired' : ''}`}>{status}</span></header>
    {!editing ? <>
      <ul className="family-access-permission-list">{permissions.map(({ key, label, description, Icon, derived }) => <li key={key} className={derived ? 'is-derived' : ''}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span><b className={allowed(key) ? 'is-allowed' : 'is-denied'}>{derived ? (allowed(key) ? 'Allowed via Records' : 'Not Allowed') : allowed(key) ? 'Allowed' : 'Not Allowed'}</b></li>)}</ul>
      {editable && <button className="button button--secondary" type="button" onClick={onEdit}>Manage permissions</button>}
    </> : <form className="family-access-edit" onSubmit={submit}>
      <fieldset disabled={busy}><legend>Choose access for {member.display_name}</legend>{permissions.filter(permission => !permission.derived).map(({ key, label, description, Icon }) => <label className="family-access-toggle" key={key}><span className="family-access-toggle-copy"><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span></span><input type="checkbox" checked={Boolean(values[key])} onChange={event => setValues(current => ({ ...current, [key]: event.target.checked }))} /><span aria-hidden="true" className="family-toggle-track" /></label>)}<p className="family-access-scope-note">Medical Documents access follows Health Records and cannot be changed independently.</p>
        {Object.values(values).some(Boolean) && <><label className="family-access-expiry">Access expires<input type="datetime-local" required value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label><label className="family-access-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} required />I consent to sharing these selected parts of my health information until the expiry above.</label></>}
      </fieldset><div className="family-access-actions"><button className="button button--primary" disabled={busy || (!Object.values(values).some(Boolean) && !member.authorization?.id) || (Object.values(values).some(Boolean) && !consent)}>{Object.values(values).some(Boolean) ? 'Save permissions' : 'Revoke all access'}</button><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
    </form>}
  </article>
}
