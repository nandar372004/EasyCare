import { familyHealthService } from './familyHealthService.js'
import { createCarePlanRepository } from './repositories/carePlanRepository.js'

const time = value => Date.parse(value) || 0
const ready = (sections, name) => sections[name]?.status === 'ready' ? sections[name].data : null
const order = (a, b) => a.priority - b.priority || (time(a.dueAt) || Infinity) - (time(b.dueAt) || Infinity) || a.id.localeCompare(b.id)
const recent = (row, now) => time(row.dueAt) <= +now && time(row.dueAt) >= +now - 30 * 86400000
const newest = (a, b) => time(b.dueAt) - time(a.dueAt) || a.id.localeCompare(b.id)
const unique = (rows, compare = order) => [...rows.sort(compare).reduce((map, row) => map.has(row.sourceKey) ? map : map.set(row.sourceKey, row), new Map()).values()]
const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).filter(part => ['year', 'month', 'day'].includes(part.type)).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {})
const dayNumber = value => { const parts = day(value); return Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000 }

export function upcomingCareGroup(value, now) {
  const distance = dayNumber(value) - dayNumber(now)
  const weekday = new Date(dayNumber(now) * 86400000).getUTCDay()
  const daysToSunday = (7 - weekday) % 7
  return distance === 0 ? 'Today' : distance === 1 ? 'Tomorrow' : distance > 1 && distance <= daysToSunday ? 'This week' : 'Later'
}

function priorityFor(dueAt, now, fallback = 5) {
  if (!time(dueAt)) return fallback
  if (time(dueAt) < +now) return 1
  if (dayNumber(dueAt) === dayNumber(now)) return 2
  return fallback
}

// Pure operational read model. It reads no candidate values or disease severity
// and never creates clinical facts, medication events or inferred completions.
export function deriveFamilyCommandCenter(ownerPatientId, readouts, now = new Date()) {
  const model = { ownerPatientId, generatedAt: now.toISOString(), members: [], attentionItems: [], upcomingCare: [], recentChanges: [], nextActions: [] }
  const seenPatients = new Set()
  for (const { member, sections = {} } of readouts) {
    if (!member?.patient_id || seenPatients.has(member.patient_id)) continue
    seenPatients.add(member.patient_id)
    const patientId = member.patient_id
    const displayName = member.display_name || 'Family member'
    const self = patientId === ownerPatientId
    const detail = member.groupId && member.member_id ? `/family/health?groupId=${encodeURIComponent(member.groupId)}&memberId=${encodeURIComponent(member.member_id)}` : null
    const person = self ? 'Your' : `${displayName}'s`
    const actions = [], upcoming = [], changes = []
    const item = (source, title, priority, dueAt, destination, ctaLabel, careType, attention = false, activity = false) => ({ id: `${patientId}:${source}`, sourceKey: `${patientId}:${source}`, patientId, displayName, title, priority, dueAt: dueAt || null, destination: destination ? self ? destination : detail : null, ctaLabel: self ? ctaLabel : 'View shared care', careType, attention, activity })
    const change = (source, title, at, destination, ctaLabel) => changes.push(item(source, title, 9, at, destination, ctaLabel, 'Activity', false, true))
    const appointmentData = ready(sections, 'appointments')
    for (const appointment of Array.isArray(appointmentData) ? appointmentData : appointmentData ? [appointmentData] : []) {
      if (!appointment.id || !['pending', 'confirmed', 'rescheduled', 'completed'].includes(appointment.status)) continue
      if (appointment.status === 'completed') {
        // Completion is explicit stored status. updatedAt is a record activity
        // timestamp, not a claim about the exact consultation completion time.
        if (time(appointment.updatedAt)) change(`appointment-completed:${appointment.id}`, `${person} appointment is marked completed.`, appointment.updatedAt, `/appointments/${appointment.id}`, 'View appointment')
        continue
      }
      const soon = time(appointment.scheduledStart) > +now && time(appointment.scheduledStart) <= +now + 48 * 3600000
      const priority = priorityFor(appointment.scheduledStart, now, appointment.status === 'pending' ? 3 : soon ? 4 : 7)
      const row = item(`appointment:${appointment.id}`, priority === 1 ? 'Review overdue appointment' : appointment.status === 'pending' ? 'Review pending appointment' : 'View upcoming appointment', priority, appointment.scheduledStart, `/appointments/${appointment.id}`, 'View appointment', 'Appointment', priority === 1 || appointment.status === 'pending')
      row.sourceStatus = appointment.status
      actions.push(row)
      if (time(appointment.scheduledStart) >= +now) upcoming.push(row)
      if (time(appointment.createdAt)) change(`appointment-scheduled:${appointment.id}`, `${person} appointment was scheduled.`, appointment.createdAt, `/appointments/${appointment.id}`, 'View appointment')
    }
    const intelligence = ready(sections, 'documentIntelligence')
    const reviews = unique((intelligence?.pending_review_items || intelligence?.items || []).filter(row => row.review_status === 'needs_review' && row.fact_id).map(row => ({ ...row, sourceKey: row.fact_id })), (a,b) => time(b.review_created_at) - time(a.review_created_at))
    const alertDetails = []
    for (const alert of ready(sections, 'alerts') || []) {
      if (!alert.id || !['open','escalated','acknowledged'].includes(alert.status)) continue
      const row = item(`alert:${alert.id}`, alert.title?.trim() || (alert.status === 'acknowledged' ? 'Acknowledged care alert' : 'Review open care alert'), 3, null, '/dashboard', 'Review', 'Care alert', alert.status !== 'acknowledged')
      row.message = typeof alert.message === 'string' ? alert.message.slice(0, 240) : null
      row.severity = alert.severity; row.sourceStatus = alert.status
      row.detectedAt = time(alert.detected_at) ? alert.detected_at : null
      row.informational = alert.status === 'acknowledged'
      alertDetails.push(row)
      if (!row.informational) actions.push(row)
    }
    for (const review of reviews) {
      const destination = `/medical-documents?factId=${encodeURIComponent(review.fact_id)}${review.source_document_id ? `#medical-document-${encodeURIComponent(review.source_document_id)}` : ''}`
      // One action per source document, while pending count retains distinct facts.
      actions.push(item(`review:${review.source_document_id || review.fact_id}`, 'Review document item', 3, null, destination, 'Review', 'Document review', true))
      if (time(review.review_created_at)) change(`review-created:${review.source_document_id || review.fact_id}`, `A document item for ${self ? 'you' : displayName} is ready for review.`, review.review_created_at, destination, 'Review')
    }
    for (const document of ready(sections, 'documentActivity') || []) {
      if (document.id && time(document.created_at)) change(`document-uploaded:${document.id}`, `${person} health document was added.`, document.created_at, `/medical-documents#medical-document-${encodeURIComponent(document.id)}`, 'View documents')
    }
    const plans = unique((ready(sections, 'carePlan') || []).filter(row => row.plan?.id && row.plan.status === 'active').map(row => ({ ...row, sourceKey: row.plan.id })), (a,b) => a.plan.id.localeCompare(b.plan.id))
    const planSummaries = [], progress = { completed: 0, total: 0, planCount: 0 }
    for (const plan of plans) {
      const currentVersion = (plan.versions || []).find(version => version.id === plan.plan.current_version_id)
      planSummaries.push({ id: plan.plan.id, title: currentVersion?.title || 'Active care plan', destination: self ? '/my-care-plan' : detail })
      const today = plan.progress?.today
      if (today && Number.isInteger(today.total) && Number.isInteger(today.completed) && today.total >= 0 && today.completed >= 0 && today.completed <= today.total) {
        progress.total += today.total; progress.completed += today.completed; progress.planCount += 1
      }
      if (time(plan.plan.updated_at)) change(`plan-updated:${plan.plan.id}`, `${person} care plan was updated.`, plan.plan.updated_at, '/my-care-plan', 'Open care plan')
      const current = row => plan.plan.current_version_id ? row.version_id === plan.plan.current_version_id : !row.version_id
      for (const goal of (plan.goals || []).filter(current)) {
        if (goal.id && time(goal.review_at) >= +now) {
          const row = item(`goal:${goal.id}`, 'Care plan goal review', priorityFor(goal.review_at, now, 7), goal.review_at, '/my-care-plan', 'Open care plan', 'Goal review')
          upcoming.push(row); actions.push(row)
        }
      }
      const taskById = new Map((plan.tasks || []).filter(current).map(task => [task.id, task]))
      for (const occurrence of (plan.occurrences || []).filter(current)) {
        const task = taskById.get(occurrence.task_id)
        if (!task || !occurrence.id || occurrence.status === 'cancelled') continue
        const appointmentId = task.appointment?.id || task.appointment_id || occurrence.appointment_id
        const followUpId = task.follow_up?.id || task.follow_up_id || occurrence.follow_up_id
        const source = task.task_type === 'appointment' && appointmentId ? `appointment:${appointmentId}` : task.task_type === 'follow_up' && followUpId ? `follow-up:${followUpId}` : `task:${occurrence.id}`
        if (occurrence.completed || occurrence.status === 'completed') {
          if (task.task_type === 'follow_up' && time(occurrence.completed_at)) change(`completed:${source}`, `${person} follow-up was completed.`, occurrence.completed_at, '/my-care-plan', 'Open care plan')
          continue
        }
        if (occurrence.status !== 'pending' || !time(occurrence.scheduled_at)) continue
        const priority = priorityFor(occurrence.scheduled_at, now, task.task_type === 'appointment' && time(occurrence.scheduled_at) <= +now + 48 * 3600000 ? 4 : task.task_type === 'medication' ? 6 : 5)
        const careType = task.task_type === 'follow_up' ? 'Follow-up' : task.task_type === 'appointment' ? 'Appointment' : task.task_type === 'medication' ? 'Medication task' : 'Care task'
        const row = item(source, `${priority === 1 ? 'Review overdue' : priority === 2 ? 'Review today’s' : 'View'} ${careType.toLowerCase()}`, priority, occurrence.scheduled_at, '/my-care-plan', 'Open care plan', careType, priority === 1 || priority === 2)
        row.sourceStatus = priority === 1 ? 'Overdue' : priority === 2 ? 'Due today' : 'Upcoming'
        actions.push(row)
        if (time(occurrence.scheduled_at) >= +now) upcoming.push(row)
      }
    }
    for (const followUp of ready(sections, 'followUps') || []) {
      if (!followUp.id || !['pending','completed'].includes(followUp.status)) continue
      if (followUp.status === 'completed') {
        if(time(followUp.completed_at)) change(`completed:follow-up:${followUp.id}`,`${person} follow-up was completed.`,followUp.completed_at,'/health-records','View follow-up')
        continue
      }
      const priority=priorityFor(followUp.due_at,now,7)
      const row=item(`follow-up:${followUp.id}`,`${priority===1?'Review overdue':priority===2?'Review today’s':'View'} follow-up`,priority,followUp.due_at,'/health-records','View follow-up','Follow-up',priority<=2)
      row.sourceStatus=priority===1?'Overdue':priority===2?'Due today':'Upcoming'
      actions.push(row)
      if(time(followUp.due_at)>=+now) upcoming.push(row)
    }
    const medications = ready(sections, 'medications') || []
    if (medications.length) actions.push(item('medications','Review medication schedule',6,null,'/medications','View medications','Medications'))
    const sortedActions = unique(actions)
    const memberUpcoming = unique(upcoming).sort((a,b) => time(a.dueAt) - time(b.dueAt) || a.id.localeCompare(b.id))
    for (const row of memberUpcoming) row.timeGroup = upcomingCareGroup(row.dueAt, now)
    const memberChanges = unique(changes.filter(row => time(row.dueAt) <= +now), newest).sort(newest)
    const limitedAccess = ['appointments', 'documentIntelligence', 'documentActivity', 'carePlan', 'medications', 'alerts', 'followUps'].some(name => sections[name]?.status !== 'ready')
    const primary = sortedActions[0] || (plans.length ? item('plan-action', 'View active care plan', 5, null, '/my-care-plan', 'Open care plan', 'Care plan') : medications.length ? item('medications', 'Review medication schedule', 6, null, '/medications', 'View medications', 'Medications') : null)
    const status = sortedActions.some(row => row.attention) ? 'needs_attention' : plans.length || memberUpcoming.length || medications.length || alertDetails.length || intelligence?.extraction_pending || intelligence?.extraction_failed ? 'monitoring' : 'stable'
    const statusReason = status === 'needs_attention' ? sortedActions.find(row => row.attention).title : status === 'monitoring' ? 'Ongoing or upcoming care' : limitedAccess ? 'No action found in shared information' : 'No current action-required items'
    const lastActivity = memberChanges[0] || null
    model.members.push({ patientId, displayName, relationshipLabel: self ? 'Self' : member.relationshipLabel || 'Family member', avatarInitials: displayName.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(), status, statusReason, limitedAccess, nextAction: primary || item('none', 'No action needed right now', 8, null, null, null, null), upcomingCareCount: memberUpcoming.length, pendingReviewCount: Number.isInteger(intelligence?.pending_review_count) ? intelligence.pending_review_count : reviews.length, activeCarePlanCount: plans.length, carePlanProgress: progress.planCount ? progress : null, carePlanSummaries: planSummaries, lastActivity, lastRelevantHealthEventAt: lastActivity?.dueAt || null, detailDestination: self ? '/dashboard' : detail, upcomingCare: memberUpcoming, pendingReviews: sortedActions.filter(row => row.careType === 'Document review'), alerts:alertDetails, documentReviewStatus:'not_defined', extractionPending:Boolean(intelligence?.extraction_pending), extractionFailed:Boolean(intelligence?.extraction_failed), recentActivity: memberChanges.filter(row => recent(row, now)).slice(0, 5) })
    model.members.at(-1).followUpUnavailable = sections.followUps?.status === 'unsupported'
    model.attentionItems.push(...sortedActions.filter(row => row.attention))
    model.upcomingCare.push(...memberUpcoming)
    model.recentChanges.push(...memberChanges)
    if (primary) model.nextActions.push(primary)
  }
  model.nextActions.sort(order); model.attentionItems.sort(order)
  model.upcomingCare.sort((a,b) => time(a.dueAt) - time(b.dueAt) || a.id.localeCompare(b.id))
  model.upcomingCareGroups = ['Today', 'Tomorrow', 'This week', 'Later'].map(label => ({ label, items: model.upcomingCare.filter(row => row.timeGroup === label) })).filter(group => group.items.length)
  model.recentChanges = model.recentChanges.filter(row => recent(row, now)).sort(newest).slice(0, 12)
  model.summary = { peopleCount: model.members.length, needsAttentionCount: model.members.filter(row => row.status === 'needs_attention').length, monitoringCount: model.members.filter(row => row.status === 'monitoring').length, stableCount: model.members.filter(row => row.status === 'stable').length, limitedAccessCount: model.members.filter(row => row.limitedAccess).length, nextAction: model.nextActions[0] || null }
  return model
}

export function createFamilyCommandCenterService(health = familyHealthService, care = null, now = () => new Date()) {
  return { async load(patient, { sharedOwnSections } = {}) {
    if (!patient?.id) throw new Error('Patient account required.')
    const groupsPromise = health.getGroups()
    // Group aggregation shares directory rechecks; no authorization cache survives
    // this request. Per-member clinical queries retain existing RLS/RPC boundaries.
    const familyPromise = groupsPromise.then(groups => Promise.all(groups.map(async group => {
      if (health.loadCommandCenterGroup) return health.loadCommandCenterGroup(group.id)
      const members = await health.getMembers(group.id)
      return (await Promise.all(members.filter(member => !member.is_self && member.patient_id !== patient.id).map(async member => {
        const result = await health.loadHealth({ groupId: group.id, memberId: member.member_id, commandCenter: true })
        return !result.membershipRemoved && result.member?.patient_id === member.patient_id ? { ...result, member: { ...result.member, groupId: group.id } } : null
      }))).filter(Boolean)
    })))
    const selfPromise = health.loadHealth({ selfPatient: patient, commandCenter: true, ...(sharedOwnSections ? { sharedOwnSections } : {}) })
    const repository = care || createCarePlanRepository()
    const planPromise = repository.listMyPlans().then(summaries => Promise.all(summaries.filter(plan => plan.patient_id === patient.id && plan.status === 'active').map(async plan => {
      const [detail, occurrences] = await Promise.all([repository.getDetail(plan.id), repository.getOccurrences(plan.id)])
      return { ...detail, occurrences }
    })))
    const [self, plans, families, groups] = await Promise.all([selfPromise, planPromise, familyPromise, groupsPromise])
    const ownReadout = { ...self, member: { patient_id: patient.id, member_id: 'self', display_name: patient.full_name || 'You', is_self: true }, sections: { ...self.sections, carePlan: { status: 'ready', data: plans } } }
    const generatedAt = now()
    // Grants can expire while another member/own-plan read is still pending.
    // Validate at assembly time as well as within each secure group read.
    const readouts = [ownReadout, ...families.flat().filter(row => row.member?.patient_id !== patient.id
      && row.authorizationStatus === 'active'
      && ['records', 'appointments', 'medications', 'alerts', 'care_plans'].some(scope => row.permissions?.[scope] === true)
      && (!row.expiresAt || time(row.expiresAt) > +generatedAt))]
    if (readouts.some(row => ['appointments', 'medications', 'carePlan', 'documentIntelligence', 'documentActivity', 'alerts', 'followUps'].some(name => row.sections[name]?.status === 'error'))) throw new Error('Overview unavailable.')
    const model = deriveFamilyCommandCenter(patient.id, readouts, generatedAt)
    model.familyName = groups.find(group => typeof group.display_name === 'string' && group.display_name.trim())?.display_name.trim() || 'My Family'
    model.hasConnectedMembers = families.flat().some(row => row.member?.patient_id && row.member.patient_id !== patient.id)
    model.accessExpiresAt = readouts.map(row => row.expiresAt).filter(value => time(value) > +generatedAt).sort((a,b) => time(a) - time(b))[0] || null
    return model
  } }
}
export const familyCommandCenterService = createFamilyCommandCenterService()
