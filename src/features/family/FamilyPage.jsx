import { resolveInvitationRelationship } from '../../services/familyRelationship.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'
import { familyService } from '../../services/familyService.js'
import { isFamilyAdult } from './familyEligibility.js'
import { Link } from 'react-router-dom'

const relationships = ['spouse', 'lover', 'friend', 'mother', 'father', 'parent', 'child', 'sibling', 'guardian', 'other']
const permissionLabels = {
  records: 'Health records, vitals and labs', appointments: 'Appointment access',
  medications: 'Medication access', payments: 'Payment access', alerts: 'Health alert access',
  care_plans: 'Care Plans',
}
const permissionDescriptions = { care_plans: 'View my clinician-created care plans, goals, and care tasks.' }
const noPermissions = { records: false, appointments: false, medications: false, payments: false, alerts: false, care_plans: false }
const formatDate = value => new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Yangon' })

export function FamilyPage() {
  const auth = useAuth()
  // Re-mount all private state on authentication changes, including pending codes.
  if (auth.status === 'loading') return <p role="status">Loading your account...</p>
  if (!auth.patient?.id || !auth.user?.id) return <p role="alert">Sign in with an EasyCare patient account to manage your family.</p>
  if (!isFamilyAdult(auth.patient.date_of_birth)) {
    return <div className="family-page">
      <div className="page-heading"><h1>My Family</h1></div>
      <p role="status">Family management is currently available to active accounts aged 18 or older with a recorded date of birth.</p>
    </div>
  }
  return <FamilyManagement key={auth.user.id} />
}

function FamilyManagement() {
  const [sections, setSections] = useState(null)
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const request = useRef(0)
  const reload = useCallback(async () => {
    const version = ++request.current
    setSections(null)
    const data = await familyService.loadMyFamilyManagement()
    if (alive.current && request.current === version) {
      setSections(data)
      setSelected(current => data.groups.data?.some(group => group.id === current) ? current : data.groups.data?.[0]?.id || '')
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void reload().catch(() => { if (alive.current) setError('Unable to load your family information.') })
    return () => { alive.current = false; request.current += 1 }
  }, [reload])
  async function run(operation, message) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation()
      if (alive.current) { setNotice(message); await reload() }
      return result
    } catch (failure) { if (alive.current) setError(failure.message) }
    finally { if (alive.current) setBusy(false) }
  }
  const groups = sections?.groups?.data || []
  const invitations = sections?.invitations?.data || []
  const group = groups.find(item => item.id === selected)
  return <div className="family-page">
    <div className="page-heading"><div><h1>My Family</h1><p>Care for the people who matter most.</p></div><Link className="button button--secondary" to="/family/overview">View Family Health</Link></div>
    <section className="card family-setup-welcome"><h2>Organize care together</h2><p>Create a family group, or generate a secure code to join someone else's group. Each adult needs their own EasyCare account.</p><p className="family-privacy-note"><strong>Family relationship tells EasyCare who this person is.</strong> Permission tells EasyCare what they may see. Membership and relationship labels never share health information by themselves.</p><p>Child and dependent profiles are not yet supported.</p><div className="family-setup-shortcuts"><a className="button button--primary" href="#create-family">Create a Family Group</a><a className="button button--secondary" href="#join-family">Join a Family Group</a><a className="button button--secondary" href="#invite-family">Invite a Family Member</a></div></section>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="dashboard-secondary-grid">
      <section id="create-family" className="card patient-health-section"><h2>Create a Family Group</h2>
        <form onSubmit={event => { event.preventDefault(); void run(async () => { await familyService.createFamilyGroup(name); if (alive.current) setName('') }, 'Family created.') }}>
          <label>Family name<input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /></label>
          <button className="button button--primary" disabled={busy}>Create Family</button>
        </form>
      </section>
      <section id="join-family" className="card patient-health-section"><h2>Join a Family Group</h2>
        <p>Generate a one-use code and share it with the family owner. The owner sends you an invitation, and you choose whether to accept it. A code expires after 24 hours. Accepting creates family membership only; health information remains private until permission is granted.</p>
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => void run(async () => {
          const code = await familyService.createFamilyJoinCode()
          if (alive.current) setJoinCode(code)
        }, 'Invitation code created. Keep it private.')}>Generate Invitation Code</button>
        {joinCode && <label>Your invitation code<input readOnly value={joinCode} /></label>}
      </section>
    </div>
    <section className="card patient-health-section"><h2>Your Families</h2>
      {!sections ? <p role="status">Loading families...</p> : sections.groups.status === 'error' ? <p role="alert">Unable to load families.</p> : !groups.length ? <p>No family groups yet.</p> : <label>Family<select value={selected} onChange={e => setSelected(e.target.value)}>{groups.map(item => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label>}
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => void run(async () => {}, 'Family information refreshed.')}>Refresh</button>
    </section>
    {group && <FamilyMembers key={group.id} group={group} onChanged={message => { setNotice(message); return reload() }} />}
    <section className="card patient-health-section"><h2>Family Invitations</h2>
      {!sections ? <p role="status">Loading invitations...</p> : sections.invitations.status === 'error' ? <p role="alert">Unable to load invitations.</p> : !invitations.length ? <p>No family invitations.</p> : <ul className="patient-health-list">{invitations.map(invitation => <li key={invitation.id}>
        <strong>{invitation.display_name}</strong><span>{invitation.is_incoming ? 'Received' : 'Sent'} · {resolveInvitationRelationship(invitation.relationship, invitation.is_incoming)} · {invitation.status}</span><span>Expires {formatDate(invitation.expires_at)} (Asia/Yangon)</span>
        {invitation.status === 'pending' && <div className="family-actions">{invitation.is_incoming ? <>
          <button className="button button--primary" disabled={busy} onClick={() => void run(() => familyService.acceptFamilyInvitation(invitation.id), 'Invitation accepted. Health access remains separate.')}>Accept Invitation</button>
          <button className="button button--secondary" disabled={busy} onClick={() => void run(() => familyService.declineFamilyInvitation(invitation.id), 'Invitation declined.')}>Decline Invitation</button>
        </> : <button className="button button--secondary" disabled={busy} onClick={() => void run(() => familyService.cancelFamilyInvitation(invitation.id), 'Invitation cancelled.')}>Cancel Invitation</button>}</div>}
      </li>)}</ul>}
    </section>
  </div>
}

function FamilyMembers({ group, onChanged }) {
  const [members, setMembers] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [relationship, setRelationship] = useState('other')
  const [viewer, setViewer] = useState(null)
  const alive = useRef(true)
  const reload = useCallback(async () => {
    const rows = await familyService.getFamilyMembers(group.id)
    if (alive.current) setMembers(rows)
  }, [group.id])
  useEffect(() => {
    alive.current = true
    void reload().catch(() => { if (alive.current) setError('Unable to load family members.') })
    return () => { alive.current = false }
  }, [reload])
  async function run(operation, message) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation(); if (alive.current) { setViewer(null); await onChanged(message) } }
    catch (failure) { if (alive.current) setError(failure.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section id="invite-family" className="card patient-health-section"><h2>{group.display_name} Members</h2>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!members && !error ? <p role="status">Loading family members...</p> : members?.length === 0 ? <p>No connected members.</p> : <ul className="patient-health-list">{members?.map(member => <li key={member.id}>
      <strong>{member.display_name}{member.is_self ? ' (You)' : ''}</strong><span>{member.is_self ? 'Self' : member.relationshipLabel || 'Family member'} · {member.role} · Connected</span>
      {!member.is_self && <><span>Access you granted: {member.authorization?.status || 'Not granted'}{member.authorization?.expires_at ? ` · expires ${formatDate(member.authorization.expires_at)} (Asia/Yangon)` : ''}</span>
        {member.authorization && <span>{Object.keys(permissionLabels).filter(scope => member.authorization[scope]).map(scope => permissionLabels[scope]).join(', ') || 'No permissions'}</span>}
        <div className="family-actions"><button className="button button--secondary" disabled={busy} onClick={() => setViewer(member)}>Manage Access</button>
          {member.authorization?.status === 'active' && <button className="button button--secondary" disabled={busy} onClick={() => void run(() => familyService.revokeFamilyAuthorization(member.authorization.id), 'Access revoked.')}>Revoke Access</button>}</div>
      </>}
      {member.role !== 'owner' && (group.is_owner || member.is_self) && <button className="button button--secondary" disabled={busy} onClick={() => void run(() => familyService.removeFamilyMember(member.id), 'Membership removed. Records were preserved.')}>{member.is_self ? 'Leave Family' : 'Remove Member'}</button>}
    </li>)}</ul>}
    {viewer && <AccessForm key={viewer.id} member={viewer} busy={busy} onCancel={() => setViewer(null)} onSubmit={(permissions, expiresAt) => run(() => familyService.grantFamilyAuthorization(viewer.id, permissions, expiresAt), 'Your selected access was granted.')} />}
    {group.is_owner && <form className="family-invite-form" onSubmit={event => { event.preventDefault(); void run(() => familyService.inviteFamilyMember(group.id, code, relationship), 'Invitation sent. The intended member must accept it from their account.') }}>
      <h3>Invite a Family Member</h3><p>Invite an adult who has their own EasyCare account. Ask them to generate an invitation code in My Family. Acceptance adds family membership and shows the relationship label; it does not grant health access.</p>
      <label>Member's invitation code<input value={code} onChange={e => setCode(e.target.value)} required autoComplete="off" /></label>
      <label>Relationship to you<select value={relationship} onChange={e => setRelationship(e.target.value)}>{relationships.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      <button className="button button--primary" disabled={busy}>Send Invitation</button>
    </form>}
  </section>
}

function AccessForm({ member, busy, onCancel, onSubmit }) {
  const [permissions, setPermissions] = useState(noPermissions)
  const [expires, setExpires] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  return <form className="family-access-form" onSubmit={event => {
    event.preventDefault(); setError('')
    const expiry = new Date(expires)
    const latestExpiry = new Date(); latestExpiry.setFullYear(latestExpiry.getFullYear() + 1)
    if (!Object.values(permissions).some(Boolean) || !consent || !Number.isFinite(+expiry) || +expiry <= Date.now() || +expiry > +latestExpiry) { setError('Choose permissions, an expiry within one year and confirm your consent.'); return }
    void onSubmit(permissions, expiry.toISOString())
  }}>
    <h3>Share Your Information with {member.display_name}</h3><p>You control access to your own records. Family ownership does not permit granting access to another member's records.</p>
    <fieldset><legend>Permissions</legend>{Object.entries(permissionLabels).map(([scope, text]) => <label className="family-checkbox" key={scope}><input type="checkbox" checked={permissions[scope]} onChange={e => setPermissions(current => ({ ...current, [scope]: e.target.checked }))} />{text}{permissionDescriptions[scope] && <small>{permissionDescriptions[scope]}</small>}</label>)}</fieldset>
    <p>These use existing EasyCare permissions. Medication dose confirmation and AI Overview generation remain limited to your own account. Appointment access does not add cancel/reschedule features.</p>
    <label>Access expires (your device's local time)<input type="datetime-local" required value={expires} onChange={e => setExpires(e.target.value)} /></label><small>Choose a future date within one year. You can revoke access earlier.</small>
    <label className="family-checkbox"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} />I consent to sharing my selected information until this expiry.</label>
    {error && <p role="alert">{error}</p>}
    <div className="family-actions"><button className="button button--primary" disabled={busy}>Grant Selected Access</button><button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>Close</button></div>
  </form>
}
