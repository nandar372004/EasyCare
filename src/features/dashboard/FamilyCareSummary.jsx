import { Link } from 'react-router-dom'
import { DashboardSkeleton } from './DashboardSkeleton.jsx'

const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const localDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const internalDestination = value => typeof value === 'string' && /^\/family\/(health|overview)(?:[?#]|$)/.test(value) ? value : '/family/overview'

// Presentation of the authorization-filtered command-center model only.
export function summarizeDashboardFamilyCare(family, now = new Date()) {
  const members = [...new Map((family?.members || []).filter(member => member.patientId && member.patientId !== family.ownerPatientId).map(member => [member.patientId, member])).values()]
  const counts = { attention: 0, monitoring: 0, noAction: 0, limited: 0 }
  const actions = []
  for (const member of members) {
    const candidates = [...(member.alerts || []), ...(family.attentionItems || []).filter(item => item.patientId === member.patientId), ...(member.upcomingCare || []), ...(member.pendingReviews || []), member.nextAction].filter(Boolean)
    const ranked = candidates.map(item => {
      const due = timestamp(item.dueAt)
      const alert = item.careType === 'Care alert' && ['open', 'escalated'].includes(item.sourceStatus)
      const overdue = item.sourceStatus === 'Overdue' || (due !== null && due < +now)
      const dueToday = item.sourceStatus === 'Due today' || (due !== null && localDay(due) === localDay(now))
      const soon = item.careType === 'Appointment' && due !== null && due >= +now && due <= +now + 48 * 3600000
      const priority = alert ? 0 : overdue ? 1 : dueToday ? 2 : item.attention ? 3 : soon ? 4 : 5
      return { ...item, priority, alert, actionable: alert || overdue || dueToday || item.attention || soon }
    }).filter(item => item.actionable || member.status === 'monitoring' && item.careType)
      .sort((a, b) => a.priority - b.priority || (timestamp(a.dueAt) ?? Infinity) - (timestamp(b.dueAt) ?? Infinity) || String(a.id || '').localeCompare(String(b.id || '')))
    const action = ranked[0]
    const needsAttention = action?.alert || member.status === 'needs_attention'
    if (needsAttention) counts.attention++
    else if (member.status === 'monitoring' || action?.actionable) counts.monitoring++
    else if (member.status === 'stable' && !member.limitedAccess) counts.noAction++
    else counts.limited++
    if (!action && !['needs_attention', 'monitoring'].includes(member.status)) continue
    const reason = action?.title || member.statusReason
    if (!reason) continue
    actions.push({ patientId: member.patientId, displayName: member.displayName, reason,
      dueAt: action?.dueAt, priority: action?.priority ?? (needsAttention ? 3 : 5),
      destination: internalDestination(action?.destination || member.detailDestination),
      cta: action?.alert ? 'View monitoring' : action?.careType === 'Appointment' ? 'View appointment'
        : action?.actionable ? 'Review care action' : 'View family health' })
  }
  actions.sort((a, b) => a.priority - b.priority || (timestamp(a.dueAt) ?? Infinity) - (timestamp(b.dueAt) ?? Infinity) || a.patientId.localeCompare(b.patientId))
  return { counts, actions }
}

export function FamilyCareSummary({ family }) {
  const ready = family?.status === 'ready'
  const { counts, actions } = ready ? summarizeDashboardFamilyCare(family) : { counts: {}, actions: [] }
  return <article className="card dashboard-command-card" aria-label="Family Care Today"><h2>Family Care Today</h2>
    {family?.status === 'error' ? <p className="dashboard-compact-state" role="alert">Family care summary is temporarily unavailable.</p>
      : !ready ? <DashboardSkeleton label="Loading family care…" />
        : <>
          <div className="dashboard-family-counts" aria-label="Family care counts"><span>Needs Attention: {counts.attention}</span><span>Monitoring / Action Due: {counts.monitoring}</span><span>No Current Action Due: {counts.noAction}</span></div>
          {actions.length ? <ul>{actions.map(action => <li key={action.patientId}><span><strong>{action.displayName}</strong><br />{action.reason}{action.dueAt && timestamp(action.dueAt) !== null && <><br /><time dateTime={action.dueAt}>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Yangon' }).format(new Date(action.dueAt))} · Yangon</time></>}</span><Link to={action.destination}>{action.cta}<span className="sr-only"> for {action.displayName}</span></Link></li>)}</ul>
            : <p>{counts.limited ? 'No current action found in shared information.' : 'Everyone is up to date for now.'}</p>}
          <small>Based on authorized shared care information.{counts.limited > 0 ? ` ${counts.limited} member(s) have limited information.` : ''}</small>
        </>}
  </article>
}
