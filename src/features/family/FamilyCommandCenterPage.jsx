import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { isFamilyAdult } from './familyEligibility.js'
import { familyCommandCenterService } from '../../services/familyCommandCenterService.js'
import { FamilyAccessPermissions } from './FamilyAccessPermissions.jsx'
import './familyCommandCenter.css'

const statusLabels = { stable: 'Up to date', monitoring: 'Monitoring', needs_attention: 'Needs attention' }
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Yangon' }).format(new Date(value)) : 'Date unavailable'
const initials = value => String(value || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '–'

function ActionLink({ item, compact = false }) {
  return item?.destination ? <Link className={`button button--secondary${compact ? ' command-compact-link' : ''}`} to={item.destination}>{item.ctaLabel || 'View details'}<span className="sr-only"> for {item.displayName}: {item.title}</span></Link> : null
}

function ItemList({ items, showPerson = true, timeline = false }) {
  return <ul className={`command-item-list${timeline ? ' command-item-list--timeline' : ''}`}>{items.map(item => <li key={item.id}>{showPerson && <span className="command-avatar command-item-avatar" aria-hidden="true">{initials(item.displayName)}</span>}<div>{showPerson && <strong>{item.displayName}</strong>}<p>{item.title}</p>{item.careType && !item.activity && <span className="command-item-meta">{item.careType}{item.sourceStatus ? ` · ${item.sourceStatus}` : ''}</span>}{item.dueAt && <time dateTime={item.dueAt}>{dateLabel(item.dueAt)} · Yangon</time>}</div><ActionLink item={item} /></li>)}</ul>
}

function Items({ title, items, empty, groups, timeline = false }) {
  return <section className={`card command-section${timeline ? ' command-section--recent' : ''}`} aria-label={title}><h2>{title}</h2>
    {!items.length ? <p className="dashboard-empty">{empty}</p> : groups ? groups.map(group => <div className="command-time-group" key={group.label}><h3>{group.label}</h3><ItemList items={group.items} /></div>) : <ItemList items={items} timeline={timeline} />}
  </section>
}

function FamilyOverview({ summary }) {
  return <section className="card command-family-overview" aria-label="Family health summary"><h2>Family Health Overview</h2><div className="command-summary-metrics">
    <div className="command-summary-metric command-summary-metric--total"><strong>{summary.peopleCount}</strong><span>family members</span></div>
    <div className="command-summary-metric command-summary-metric--attention"><strong>{summary.needsAttentionCount}</strong><span>needs attention</span></div>
    <div className="command-summary-metric command-summary-metric--monitoring"><strong>{summary.monitoringCount}</strong><span>monitoring</span></div>
    <div className="command-summary-metric command-summary-metric--stable"><strong>{summary.stableCount}</strong><span>stable</span></div>
  </div>{summary.limitedAccessCount > 0 && <small>Statuses reflect shared information. {summary.limitedAccessCount} {summary.limitedAccessCount === 1 ? 'person has' : 'people have'} limited sharing.</small>}</section>
}

function NextFamilyAction({ action }) {
  return <section className="card command-family-next" aria-label="Next family action"><span className="eyebrow">Next Family Action</span>{action ? <><strong>{action.displayName}</strong><p>{action.title}</p>{action.dueAt && <time dateTime={action.dueAt}>{dateLabel(action.dueAt)}</time>}<ActionLink item={action} /></> : <strong>No action needed right now</strong>}</section>
}

function MemberDetail({ member, id }) {
  return <section id={id} className="command-member-detail" aria-label={`Care details for ${member.displayName}`}><h3>Care at a glance</h3><p><strong>{member.limitedAccess && member.status === 'stable' ? 'Limited information' : statusLabels[member.status]}</strong> · {member.statusReason}</p><p><strong>Next:</strong> {member.nextAction.title}</p><ActionLink item={member.nextAction} compact />
    <h4>Upcoming care</h4>{member.upcomingCare.length ? <ItemList items={member.upcomingCare.slice(0, 3)} showPerson={false} /> : <p>No upcoming care scheduled.</p>}
    {member.followUpUnavailable && <p>Standalone follow-up data is unavailable with current read permissions.</p>}
    <h4>Active care plans</h4>{member.carePlanSummaries.length ? <ul className="command-plan-list">{member.carePlanSummaries.map(plan => <li key={plan.id}><span>{plan.title}</span>{plan.destination && <Link to={plan.destination}>Open care plan<span className="sr-only"> for {member.displayName}: {plan.title}</span></Link>}</li>)}</ul> : <p>No active care plan in shared information.</p>}
    <h4>Care alerts</h4>{member.alerts?.length ? <ul className="command-item-list">{member.alerts.map(alert=><li key={alert.id}><div><strong>{alert.title}</strong>{alert.message && <p>{alert.message}</p>}<p>{alert.severity} · {alert.sourceStatus}{alert.informational ? ' · Informational — acknowledged' : ''}</p>{alert.detectedAt && <time dateTime={alert.detectedAt}>{dateLabel(alert.detectedAt)} · Yangon</time>}</div><ActionLink item={alert} /></li>)}</ul> : <p>No active alerts in shared information.</p>}
    <h4>Pending reviews</h4>{member.pendingReviews.length ? <><p>{member.pendingReviewCount} document {member.pendingReviewCount === 1 ? 'item needs' : 'items need'} review.</p><ItemList items={member.pendingReviews.slice(0, 3)} showPerson={false} /></> : <p>No pending reviews in shared information.</p>}
    {member.extractionPending && <p>Document extraction is pending.</p>}{member.extractionFailed && <p>A document extraction failed. View the source document to retry.</p>}
    <small>Review counts refer to extracted candidate items.</small>
    <h4>Recent activity</h4>{member.recentActivity.length ? <ItemList items={member.recentActivity.slice(0, 3)} showPerson={false} /> : <p>No recent family health activity.</p>}
    {member.detailDestination && <Link className="button button--secondary" to={member.detailDestination}>View all shared care for {member.displayName}</Link>}
  </section>
}

function MemberCard({ member, expanded, onExpand }) {
  const detailId = useId()
  const progress = member.carePlanProgress
  return <article className={`card command-member${expanded ? ' command-member--expanded' : ''}`}>
    <div className="command-person"><span className="command-avatar" aria-hidden="true">{member.avatarInitials}</span><div><h2>{member.displayName}</h2><span className="command-relationship">{member.relationshipLabel}</span></div></div>
    <span className={`command-status command-status--${member.status}`}>{member.limitedAccess && member.status === 'stable' ? 'Limited information' : statusLabels[member.status]}</span><p>{member.statusReason}</p>
    {member.limitedAccess && <small>Some health information is not shared. This overview may be incomplete.</small>}
    <div className="command-next"><span>Next</span><strong>{member.nextAction.title}</strong>{member.nextAction.dueAt && <time dateTime={member.nextAction.dueAt}>{dateLabel(member.nextAction.dueAt)}</time>}<ActionLink item={member.nextAction} /></div>
    {member.upcomingCare[0] && <p className="command-card-upcoming"><strong>Upcoming:</strong> {member.upcomingCare[0].careType} · {dateLabel(member.upcomingCare[0].dueAt)}</p>}
    {progress && <div className="command-plan-progress"><span>Care plan today · {progress.completed} of {progress.total} tasks complete</span>{progress.total > 0 && <progress aria-label={`Today's care tasks completed for ${member.displayName}`} max={progress.total} value={progress.completed} />}</div>}
    <div className="command-counts"><span>{member.upcomingCareCount} upcoming</span><span>{member.pendingReviewCount} to review</span><span>{member.activeCarePlanCount} care plans</span></div>
    <div className="command-last-activity"><span>Last activity</span>{member.lastActivity ? <><p>{member.lastActivity.title}</p><time dateTime={member.lastActivity.dueAt}>{dateLabel(member.lastActivity.dueAt)}</time></> : <p>No activity in shared information.</p>}</div>
    <button className="button button--secondary command-expand-button" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onExpand}>{expanded ? 'Hide' : 'Show'} care details for {member.displayName}</button>
    {expanded && <MemberDetail member={member} id={detailId} />}
  </article>
}

function Skeletons() {
  return <div className="command-loading" role="status" aria-label="Loading family health overview"><div className="card command-skeleton command-summary-skeleton" aria-hidden="true"><span /><span /></div><div className="command-member-grid" aria-hidden="true">{[0,1,2].map(key => <div key={key} className="card command-skeleton"><span /><span /><span /><span /><span /></div>)}</div><div className="command-section-grid" aria-hidden="true">{[0,1,2,3].map(key => <div key={key} className="card command-skeleton command-section-skeleton"><span /><span /></div>)}</div></div>
}

export function FamilyCommandCenterView({ model, loading, error, expired, onRetry }) {
  const [expandedId, setExpandedId] = useState(null)
  return <div className="family-command-center"><header className="command-page-heading"><div className="command-banner-copy"><span className="command-banner-label">YOUR HEALTH CIRCLE</span><h1>{model?.familyName?.trim() || 'My Family'}</h1><p>Manage your family’s care, appointments, and updates together.</p><Link className="button button--secondary command-manage-button" to="/family">Manage Health Circle</Link></div><div className="command-banner-artwork"><img src="/family-health-circle.png" alt="" aria-hidden="true" /></div></header>
    <p className="command-context">These statuses describe care actions, not medical health. The overview uses information shared with you.</p>
    {loading ? <Skeletons /> : expired ? <section className="card command-section"><p role="status">Shared access has expired. Reopen this page to load currently authorized information.</p></section> : error ? <section className="card command-section"><p role="alert">We couldn't load your family health overview. Please try again.</p><button className="button button--primary" onClick={onRetry}>Try again</button></section> : model && <>
      <nav className="command-family-tabs" aria-label="My Family sections"><a href="#command-family-members-heading">Family Members</a><a href="#family-access-permissions">Access &amp; Permissions</a><a className="is-active" href="#health-overview">Health Overview</a><Link to="/family/health">Family Care Plan</Link></nav>
      <div id="health-overview" className="command-summary-grid"><FamilyOverview summary={model.summary} /><NextFamilyAction action={model.summary.nextAction} /></div>
      {model.members.length <= 1 && <section className="card command-section">{model.hasConnectedMembers ? <><p>No family health access is shared right now. Manage your Health Circle to review sharing.</p><Link className="button button--primary" to="/family">Manage Health Circle sharing</Link></> : <><p>Add someone to your Health Circle to manage care together.</p><Link className="button button--primary" to="/family">Add someone</Link></>}</section>}
      <section className="command-member-section" aria-labelledby="command-family-members-heading"><h2 id="command-family-members-heading">Family Members</h2><div className="command-member-grid" aria-label="Family overview">{model.members.map(member => <MemberCard key={member.patientId} member={member} expanded={expandedId === member.patientId} onExpand={() => setExpandedId(current => current === member.patientId ? null : member.patientId)} />)}</div></section>
      <FamilyAccessPermissions familyName={model.familyName} />
      <div className="command-lower-columns"><div className="command-lower-column"><Items title="Who needs attention" items={model.attentionItems} empty="Everyone is up to date." /><Items title="Upcoming care" items={model.upcomingCare} groups={model.upcomingCareGroups} empty="No upcoming care scheduled." /></div><div className="command-lower-column"><Items title="Next actions" items={model.nextActions} empty="No action needed right now" /><Items title="Recent changes" items={model.recentChanges} empty="No recent family health activity." timeline /></div></div>
      <p className="command-context">Updated {dateLabel(model.generatedAt)} · Yangon{model.summary.limitedAccessCount > 0 ? ' · Up-to-date messages apply only to available shared information.' : ''}</p>
    </>}
  </div>
}

function Content({ patient }) {
  const [state, setState] = useState({ loading: true })
  const [version, setVersion] = useState(0)
  const patientRef = useRef(patient)
  const generation = useRef(0)
  patientRef.current = patient
  const refresh = useCallback(() => {
    generation.current += 1
    setState({ loading: true })
    setVersion(value => value + 1)
  }, [])
  useEffect(() => {
    let active = true
    const requestGeneration = generation.current
    setState({ loading: true })
    familyCommandCenterService.load(patientRef.current).then(model => {
      if (!active || requestGeneration !== generation.current) return
      // Never display an already-expired response or reschedule its expiry
      // immediately in a zero-delay loop. Manual reads remain available.
      const expiry = model.accessExpiresAt && Date.parse(model.accessExpiresAt)
      setState(model.accessExpiresAt && (!Number.isFinite(expiry) || expiry <= Date.now()) ? { error: true } : { model })
    }, () => { if (active && requestGeneration === generation.current) setState({ error: true }) })
    return () => { active = false }
  }, [patient.id, version])
  useEffect(() => {
    if (!state.model?.accessExpiresAt) return
    const expiry = Date.parse(state.model.accessExpiresAt)
    let timer
    // Timer chunks handle long deadlines locally, without backend requests.
    const clearAtExpiry = () => {
      const remaining = expiry - Date.now()
      if (remaining <= 0) setState({ expired: true })
      else timer = window.setTimeout(clearAtExpiry, Math.min(2147483647, remaining))
    }
    clearAtExpiry()
    return () => window.clearTimeout(timer)
  }, [state.model])
  return <FamilyCommandCenterView {...state} onRetry={refresh} />
}

export function FamilyCommandCenterPage() {
  const auth = useAuth()
  if (auth.status === 'loading') return <FamilyCommandCenterView loading />
  if (!auth.patient?.id || !auth.user?.id) return <p role="alert">Sign in with a patient account to view Family Health.</p>
  if (!isFamilyAdult(auth.patient.date_of_birth)) return <p role="status">Family Health is available to active accounts aged 18 or older with a recorded date of birth.</p>
  return <Content key={`${auth.user.id}:${auth.patient.id}`} patient={auth.patient} />
}
