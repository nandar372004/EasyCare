import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { RecordedTime, label } from '../dashboard/PatientHealthSections.jsx'
import { familyHealthService } from '../../services/familyHealthService.js'
import { getFamilyPresentationAppointmentForMember } from '../../data/presentationFamilyAppointments.js'
import { isFamilyAdult } from './familyEligibility.js'
import { canShowConsultationJoin } from '../../services/bookingService.js'
import { presentationRepository } from '../../services/repositories/index.js'
import { getFamilyPresentationHealthRecord } from '../../data/presentationFamilyHealthRecords.js'
import { FamilyCarePlanReadOnlyDetail } from './FamilyCarePlanSection.jsx'
import { familyPatientCarePlanHasData, FamilyPatientCarePlanReadOnlyDetail, FamilyPatientCarePlanSummary } from './FamilyPatientCarePlan.jsx'
import './familyHealthPage.css'
import { CalendarDays, ClipboardCheck, FileText, FolderHeart, Pill } from 'lucide-react'

const FAMILY_READOUT_MS = 15_000
const EMPTY_SECTION = { status: 'loading', data: null }

function MemberButton({ member, selected, onSelect, self = false }) {
  const authorization = member.authorization
  const status = self ? 'Self' : authorization?.status === 'active'
    ? (authorization.records || authorization.appointments || authorization.medications || authorization.alerts || authorization.care_plans ? 'Health access shared' : 'Limited access')
    : authorization?.status === 'expired' ? 'Access expired'
      : ['revoked', 'inactive'].includes(authorization?.status) ? 'Access no longer active'
        : 'No health access shared'
  const initials = (member.display_name || ' ').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <button type="button" className={`card family-member-choice${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="family-choice-avatar" aria-hidden="true">{initials || '?'}</span>
    <span className="family-choice-copy"><strong>{member.display_name}{self ? ' — You' : ''}</strong>
    <span>{self ? 'Self' : member.relationshipLabel || 'Family member'}</span>
    <small>{status}</small></span>
  </button>
}

const ACCESS_LABELS = [
  ['appointments', 'Appointments'], ['care_plans', 'Care Plan'], ['records', 'Health Records'],
  ['documents', 'Medical Documents'], ['medications', 'Medications'], ['payments', 'Payments'],
]

function AccessChip({ label: text, allowed, own = false, note }) {
  return <span className={`family-access-chip${allowed ? ' is-shared' : ' is-locked'}`}>
    <span aria-hidden="true">{allowed ? '✓' : '×'}</span>{text}<small>{note || (allowed ? own ? 'Your access' : 'Shared' : 'Not shared')}</small>
  </span>
}

function SelectedMemberSummary({ name, relationship, permissions, isSelf, groupName }) {
  const active = permissions?.status === 'active'
  const has = scope => isSelf || (active && permissions?.[scope] === true)
  const access = {
    appointments: has('appointments'), care_plans: has('care_plans'), records: has('records'),
    documents: has('records'), medications: has('medications'), payments: has('payments'), alerts: has('alerts'),
  }
  const initials = (name || ' ').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <section className="card family-selected-summary" aria-label={`Shared information for ${name}`}>
    <div className="family-selected-person"><span className="family-selected-avatar" aria-hidden="true">{initials || '?'}</span><div>
      <span className="eyebrow">Viewing shared information for{groupName ? ` · ${groupName}` : ''}</span>
      <h2>{name}</h2><p>{relationship}{isSelf ? ' · Your own health information' : ''}</p>
    </div></div>
    <div className="family-access-chip-list" aria-label="Shared access permissions">
      {ACCESS_LABELS.map(([scope, text]) => <AccessChip key={scope} label={text} allowed={access[scope]} own={isSelf} note={scope === 'documents' && access.documents ? 'Available under Health Records' : undefined} />)}
    </div>
  </section>
}

function AppointmentSection({ section }) {
  const [detailsId, setDetailsId] = useState('')
  const [providers, setProviders] = useState({})
  const [providerLookupComplete, setProviderLookupComplete] = useState('')
  const appointments = Array.isArray(section?.data) ? section.data : section?.data ? [section.data] : []
  const presentationSample = getFamilyPresentationAppointmentForMember(section?.member)
  const isPresentationTarget = Boolean(presentationSample)
  const providerIds = [...new Set(appointments.map(item => item.providerId || item.doctorId).filter(Boolean))].join('|')
  useEffect(() => {
    let current = true
    setProviders({})
    const ids = providerIds ? providerIds.split('|') : []
    if (!ids.length) setProviderLookupComplete(providerIds)
    Promise.all(ids.map(async id => [id, await presentationRepository.getDoctor(id).catch(() => null)]))
      .then(rows => { if (current) { setProviders(Object.fromEntries(rows.filter(([, doctor]) => doctor))); setProviderLookupComplete(providerIds) } })
    return () => { current = false }
  }, [providerIds])
  const typeNames = { video: 'Video consultation', voice: 'Voice call', chat: 'Chat', home_visit: 'Home visit' }
  const providerLookupReady = providerLookupComplete === providerIds
  const usableRealAppointments = appointments.filter(appointment => {
    const provider = appointment.doctor || providers[appointment.providerId || appointment.doctorId]
    const scheduledAt = appointment.scheduledAt || appointment.scheduledStart
    const mode = appointment.consultationType || appointment.consultationChannel
    const timestamp = Date.parse(scheduledAt)
    return Boolean(appointment.id && provider?.displayName?.trim() && Number.isFinite(timestamp) && timestamp > Date.now()
      && Object.hasOwn(typeNames, mode) && ['pending', 'confirmed', 'rescheduled'].includes(appointment.status))
  })
  const displayAppointments = isPresentationTarget
    ? providerLookupReady ? usableRealAppointments : []
    : appointments
  const sampleAppointment = section?.status === 'ready' && isPresentationTarget && providerLookupReady && !usableRealAppointments.length
    ? presentationSample.appointment : null
  return <article className="card patient-health-section family-health-section family-appointments-card" aria-label="Appointments">
    <div className="section-title"><CalendarDays aria-hidden="true"/><h2>Appointments</h2></div>
    {section?.status === 'loading' && <p role="status">Loading appointments…</p>}
    {section?.status === 'error' && <p className="dashboard-compact-state" role="alert">Appointments are temporarily unavailable.</p>}
    {isPresentationTarget && section?.status === 'ready' && !providerLookupReady && <p role="status">Checking appointment details…</p>}
    {section?.status === 'ready' && !displayAppointments.length && !sampleAppointment && providerLookupReady && <p className="dashboard-empty">No upcoming appointments.</p>}
    {sampleAppointment && <ul className="patient-health-list family-module-list family-appointment-list"><li className="family-appointment-card">
      <strong className="family-appointment-doctor">{sampleAppointment.doctor.displayName}</strong>
      <span className="family-appointment-specialty">{sampleAppointment.doctor.specialty}</span>
      <small className="family-appointment-rating" aria-label={`Rating ${sampleAppointment.doctor.rating} out of 5`}>★ {sampleAppointment.doctor.rating}</small>
      <span className="family-appointment-mode">Video consultation</span>
      <time className="family-appointment-datetime" dateTime={sampleAppointment.scheduledAt}>{sampleAppointment.dateLabel} · {sampleAppointment.timeLabel} (Asia/Yangon)</time>
      <span className="status-badge status-pending family-appointment-status">Pending</span>
      {sampleAppointment.feeMmk != null && <span className="family-appointment-meta">Fee: {sampleAppointment.feeMmk} MMK</span>}
      {sampleAppointment.bookingCode && <span className="family-appointment-meta">Reference: {sampleAppointment.bookingCode}</span>}
      <div className="family-appointment-actions">
        <Link className="button button--primary" to={`/consultations/${sampleAppointment.id}`} state={{ easycarePresentationSample: true }}>Join Consultation</Link>
        <button className="button button--secondary" type="button" aria-expanded={detailsId === sampleAppointment.id} onClick={() => setDetailsId(current => current === sampleAppointment.id ? '' : sampleAppointment.id)}>{detailsId === sampleAppointment.id ? sampleAppointment.hideDetailsButtonLabel : sampleAppointment.detailsButtonLabel}</button>
      </div>
      {detailsId === sampleAppointment.id && <div className="family-appointment-detail"><strong>{sampleAppointment.doctor.displayName} · {sampleAppointment.doctor.specialty}</strong><span>{sampleAppointment.dateLabel} · {sampleAppointment.timeLabel}</span><span>Video consultation · Pending · Rating: {sampleAppointment.doctor.rating}</span>{sampleAppointment.feeMmk != null && <span>Fee: {sampleAppointment.feeMmk} MMK</span>}{sampleAppointment.bookingCode && <span>Reference: {sampleAppointment.bookingCode}</span>}</div>}
    </li></ul>}
    {!!displayAppointments.length && <ul className="patient-health-list family-module-list family-appointment-list">{displayAppointments.map(appointment => {
      const joinAppointment = { ...appointment, consultationType: appointment.consultationType || appointment.consultationChannel }
      const provider = providers[appointment.providerId || appointment.doctorId]
      return <li key={appointment.id} className="family-appointment-card">
        <strong className="family-appointment-doctor">{provider?.displayName || 'Provider details unavailable'}</strong>
        {provider?.specialty && <span className="family-appointment-specialty">{provider.specialty}</span>}
        <span className="family-appointment-mode">{typeNames[joinAppointment.consultationType] || label(joinAppointment.appointmentType || joinAppointment.consultationType)}</span>
        <span className="family-appointment-datetime"><RecordedTime value={appointment.scheduledAt || appointment.scheduledStart} /></span>
        <span className={`status-badge status-${appointment.status} family-appointment-status`}>{label(appointment.status)}</span>
        <div className="family-appointment-actions"><button className="button button--secondary" type="button" aria-expanded={detailsId === appointment.id} onClick={() => setDetailsId(current => current === appointment.id ? '' : appointment.id)}>{detailsId === appointment.id ? 'Hide Appointment' : 'View Appointment'}</button>
          {canShowConsultationJoin(joinAppointment) && <Link className="button button--primary" to={`/consultations/${appointment.id}`}>Join Consultation</Link>}</div>
        {detailsId === appointment.id && <p className="family-appointment-detail">{provider?.displayName || 'Provider details unavailable'} · {typeNames[joinAppointment.consultationType] || label(joinAppointment.appointmentType)} · {label(appointment.status)} · <RecordedTime value={appointment.scheduledEnd} /></p>}
      </li>
    })}</ul>}
  </article>
}

function MedicationSection({ section }) {
  const rows = section?.data || []
  return <article className="card patient-health-section family-health-section family-medications-card" aria-label="Medications">
    <div className="section-title"><Pill aria-hidden="true"/><h2>Medications</h2></div>
    {section?.status === 'loading' && <p role="status">Loading medications…</p>}
    {section?.status === 'error' && <p className="dashboard-compact-state" role="alert">Medications are temporarily unavailable.</p>}
    {section?.status === 'ready' && !rows.length && <p className="dashboard-empty">No medications shared.</p>}
    {!!rows.length && <ul className="patient-health-list family-module-list">{rows.slice(0, 3).map(medication => <li key={medication.id}>
      <strong>{medication.medication_name}</strong><span>{medication.dose || 'Dose not recorded'}</span>
      {medication.instructions && <span>{medication.instructions}</span>}
      {medication.medication_schedules?.map(schedule => <span key={schedule.id}>{schedule.time_of_day} · {schedule.timezone || 'Asia/Yangon'}</span>)}
      <small className="family-medication-status">{label(medication.status)} · Today's check-in status is not included in shared medication data.</small>
    </li>)}</ul>}
  </article>
}

function CarePlanSection({ section, patientSection, isSelf, memberName, memberId, authorized, onView }) {
  const [expandedPlans, setExpandedPlans] = useState({})
  const plans = Array.isArray(section?.data) ? section.data : []
  const patientData = patientSection?.data
  const hasPatientData = patientSection?.status === 'ready' && familyPatientCarePlanHasData(patientData)
  useEffect(() => { setExpandedPlans({}) }, [memberId])
  const localDate = zone => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
  }
  return <article className="card patient-health-section family-health-section family-care-plan-card" aria-label={isSelf ? 'My Care Plan' : `${memberName}'s Care Plan`}>
    <div className="section-title"><ClipboardCheck aria-hidden="true"/><h2>{isSelf ? 'My Care Plan' : `${memberName} — Care Plan`}</h2></div>
    {isSelf && <><p>Your own care plan is available in My Care Plan.</p><Link className="button button--secondary" to="/my-care-plan">Open My Care Plan</Link></>}
    {!isSelf && !authorized && <p>This family member has not shared their Care Plan with you.</p>}
    {!isSelf && authorized && section?.status === 'loading' && <p role="status">Loading care plan…</p>}
    {!isSelf && authorized && ['expired', 'revoked', 'inactive', 'not_authorized'].includes(section?.status) && <p>This family member has not shared their Care Plan with you.</p>}
    {!isSelf && authorized && section?.status === 'error' && <p className="dashboard-compact-state" role="alert">Care plan is temporarily unavailable.</p>}
    {!isSelf && authorized && patientSection?.status === 'error' && <p className="dashboard-compact-state" role="alert">Shared patient care plan details are temporarily unavailable.</p>}
    {!isSelf && authorized && section?.status === 'ready' && patientSection?.status === 'ready' && !plans.length && !hasPatientData && (patientData?.access?.medications && patientData?.access?.appointments) && <p className="dashboard-empty">No current care plan information has been shared.</p>}
    {!isSelf && authorized && section?.status === 'ready' && patientSection?.status === 'ready' && !plans.length && !hasPatientData && !(patientData?.access?.medications && patientData?.access?.appointments) && <p className="dashboard-empty">No shared care plan details are available. Medication or appointment sharing may be limited.</p>}
    {!isSelf && authorized && hasPatientData && <section className="family-care-plan-summary family-patient-care-readonly">
      <h3>{memberName} — Care Plan</h3>
      <FamilyPatientCarePlanSummary data={patientData} />
      <button className="button button--secondary" type="button" aria-expanded={Boolean(expandedPlans.patientOwned)} aria-label={`${expandedPlans.patientOwned ? 'Hide' : 'View'} Care Plan for ${memberName}`} onClick={() => { setExpandedPlans(current => ({ ...current, patientOwned: !current.patientOwned })); if (!expandedPlans.patientOwned) onView?.() }}>{expandedPlans.patientOwned ? 'Hide Care Plan' : 'View Care Plan'}</button>
      {expandedPlans.patientOwned && <FamilyPatientCarePlanReadOnlyDetail data={patientData} />}
    </section>}
    {!isSelf && authorized && section?.status === 'ready' && plans.map(item => {
      const plan = item.plan || {}
      const taskById = new Map((item.tasks || []).map(task => [task.id, task]))
      const due = (item.occurrences || []).filter(row => row.local_due_date === localDate(plan.timezone) && row.status !== 'cancelled')
      const tally = taskType => {
        const rows = due.filter(row => taskById.get(row.task_id)?.task_type === taskType && row.required !== false)
        return rows.length ? `${rows.filter(row => row.completed === true).length} of ${rows.length} completed today` : null
      }
      const medicationProgress = tally('medication')
      const monitoringProgress = tally('vital_check')
      const progress = item.progress?.today
      const status = progress?.state === 'no_tasks_due' || (progress?.state === 'tasks_due' && progress.total > 0 && progress.completed === progress.total)
        ? 'Up to date for today'
        : progress?.state === 'tasks_due' && progress.completed < progress.total ? 'Actions remaining' : 'Current action status unavailable'
      const version = (item.versions || []).find(value => value.id === plan.current_version_id) || (item.versions || []).at(-1)
      const expanded = Boolean(expandedPlans[plan.id])
      return <section className="family-care-plan-summary" key={plan.id || version?.id || 'care-plan'}>
        <h3>{version?.title || 'Care Plan'}</h3>
        {medicationProgress && <p><strong>Medications</strong><span>{medicationProgress}</span></p>}
        {monitoringProgress && <p><strong>Monitoring</strong><span>{monitoringProgress}</span></p>}
        {!!item.goals?.length && <p><strong>Health Goals</strong><span>{item.goals.length} shared care-plan goals</span></p>}
        {progress?.state === 'tasks_due' && <p><strong>Care actions</strong><span>{progress.completed} of {progress.total} completed today</span></p>}
        <p className={status === 'Actions remaining' ? 'is-actions-remaining' : ''}><strong>Today’s Care</strong><span>{status}</span></p>
        <button className="button button--secondary" type="button" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'View'} Care Plan for ${memberName}`} onClick={() => { setExpandedPlans(current => ({ ...current, [plan.id]: !current[plan.id] })); if (!expanded) onView?.() }}>{expanded ? 'Hide Care Plan' : 'View Care Plan'}</button>
        {expanded && <FamilyCarePlanReadOnlyDetail item={item} />}
      </section>
    })}
  </article>
}

function RecordsSection({ section, patientId, documentsOnly = false, member }) {
  const [openingDocument, setOpeningDocument] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [expanded, setExpanded] = useState('')
  const [showAll, setShowAll] = useState(false)
  async function openDocument(documentId) {
    if (!patientId || openingDocument) return
    setOpeningDocument(documentId); setDocumentError('')
    try {
      const url = await familyHealthService.createDocumentSignedUrl(patientId, documentId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch { setDocumentError('We could not open this document. Check that your records access is still active and try again.') }
    finally { setOpeningDocument('') }
  }
  const kindLabels = { encounter: 'Care Encounter', document: 'Medical Document', history: 'Medical History', reported: '' }
  const rows = (section.data || []).filter(row => documentsOnly ? row.kind === 'document' : row.kind !== 'document')
  const presentationRecord = documentsOnly ? null : getFamilyPresentationHealthRecord(member)
  const showPresentationRecord = Boolean(presentationRecord && !rows.length && ['ready', 'error'].includes(section?.status))
  const visibleRows = showAll ? rows : rows.slice(0, 3)
  return <article className={`card patient-health-section family-health-section ${documentsOnly ? 'family-documents-card' : 'family-records-card'}`} aria-label={documentsOnly ? 'Medical Documents' : 'Health Records'}>
    <div className="section-title">{documentsOnly ? <FileText aria-hidden="true"/> : <FolderHeart aria-hidden="true"/>}<h2>{documentsOnly ? 'Medical Documents' : 'Health Records'}</h2></div>
    {section?.status === 'loading' && <p role="status">Loading {documentsOnly ? 'documents' : 'health records'}…</p>}
    {section?.status === 'error' && !showPresentationRecord && <p className="dashboard-compact-state" role="alert">{documentsOnly ? 'Medical documents are not available yet.' : 'Health records are temporarily unavailable.'}</p>}
    {section?.status === 'ready' && !rows.length && !showPresentationRecord && <p className="dashboard-empty">{documentsOnly ? 'Medical documents are not available yet.' : 'No health records have been shared yet.'}</p>}
    {!!rows.length && <ul className="patient-health-list family-module-list">{visibleRows.map(({ kind, recordedAt, record }) => <li key={`${kind}-${record.id}`}>
      {kindLabels[kind] && <span>{kindLabels[kind]}</span>}
      <strong>{record.title || record.chief_complaint || label(record.encounter_type)}</strong>
      {(record.description || record.assessment_summary || record.details) && <button className="family-record-details-toggle" type="button" aria-expanded={expanded === record.id} onClick={() => setExpanded(current => current === record.id ? '' : record.id)}>{expanded === record.id ? 'Hide details' : 'View details'}</button>}
      {expanded === record.id && <p>{typeof record.details === 'string' ? record.details : Object.entries(record.details || {}).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') || record.description || record.assessment_summary}</p>}
      <RecordedTime value={recordedAt || record.document_date} />
      {documentsOnly && record.storage_path && <button className="button button--secondary" type="button" disabled={Boolean(openingDocument)} onClick={() => void openDocument(record.id)}>{openingDocument === record.id ? 'Opening…' : 'View document'}</button>}
    </li>)}</ul>}
    {showPresentationRecord && <ul className="patient-health-list family-module-list family-presentation-record-list"><li className="family-presentation-record">
      <div className="family-presentation-record-heading"><FolderHeart aria-hidden="true"/><div><strong>{presentationRecord.title}</strong><span>{presentationRecord.type}</span></div></div>
      {presentationRecord.latestReading && <div className="family-presentation-record-reading"><span>Latest Reading</span><strong>{presentationRecord.latestReading}</strong></div>}
      <div className="family-presentation-record-facts"><span><small>Recorded</small><strong>{presentationRecord.recordedLabel}</strong></span><span><small>Status</small><strong className="family-presentation-record-status">{presentationRecord.status}</strong></span></div>
      <p className="family-presentation-record-summary">{presentationRecord.summary}</p>
      <button className="family-record-details-toggle" type="button" aria-expanded={expanded === presentationRecord.id} onClick={() => setExpanded(current => current === presentationRecord.id ? '' : presentationRecord.id)}>{expanded === presentationRecord.id ? 'Hide Details' : 'View Details'}</button>
      {expanded === presentationRecord.id && <div className="family-presentation-record-detail">
        {presentationRecord.recentReadings?.map(reading => <div key={`${reading.date}-${reading.value}`}><span>{reading.date}</span><strong>{reading.value}</strong></div>)}
        {presentationRecord.details?.map(detail => <div key={detail.label}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}
      </div>}
    </li></ul>}
    {rows.length > 3 && <button type="button" className="family-record-details-toggle" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show recent' : 'View all'} →</button>}
    {documentError && <p className="dashboard-compact-state" role="alert">{documentError}</p>}
  </article>
}

export function FamilyHealthPage() {
  const auth = useAuth()
  if (auth.status === 'loading') return <p role="status">Loading your account...</p>
  if (!auth.patient?.id || !auth.user?.id) return <p role="alert">Sign in with an EasyCare patient account to view Family Health.</p>
  if (!isFamilyAdult(auth.patient.date_of_birth)) return <p role="status">Family Health is available to active accounts aged 18 or older with a recorded date of birth.</p>
  return <FamilyHealthContent key={`${auth.user.id}:${auth.patient.id}`} auth={auth} />
}

function FamilyHealthContent({ auth }) {
  const [searchParams] = useSearchParams()
  const [groups, setGroups] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [members, setMembers] = useState(null)
  const [selectedMemberId, setSelectedMemberId] = useState('self')
  const [directoryError, setDirectoryError] = useState('')
  const [checkingAccess, setCheckingAccess] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [loaded, setLoaded] = useState(null)
  const directoryRequest = useRef(0)
  const healthRequest = useRef(0)
  const selectedMemberIdRef = useRef(selectedMemberId)
  selectedMemberIdRef.current = selectedMemberId

  const refreshGroups = useCallback(async () => {
    try {
      const rows = await familyHealthService.getGroups()
      setGroups(current => JSON.stringify(current) === JSON.stringify(rows) ? current : rows)
      setDirectoryError('')
      setGroupId(current => rows.some(group => group.id === current) ? current : rows.find(group => group.id === searchParams.get('groupId'))?.id || rows[0]?.id || '')
    } catch {
      setDirectoryError("We couldn't load your family members. Refresh or open My Family to review your membership.")
      setGroups(current => current ?? [])
    }
  }, [])

  useEffect(() => { void refreshGroups() }, [refreshGroups])

  const refreshMembers = useCallback(async () => {
    const requestId = ++directoryRequest.current
    if (!groupId) { setMembers([]); setDirectoryError(''); setCheckingAccess(false); return }
    setCheckingAccess(true)
    try {
      const rows = await familyHealthService.getMembers(groupId)
      if (requestId !== directoryRequest.current) return
      setMembers(current => JSON.stringify(current) === JSON.stringify(rows) ? current : rows)
      setDirectoryError('')
      if (selectedMemberIdRef.current !== 'self' && !rows.some(member => member.member_id === selectedMemberIdRef.current && !member.is_self)) {
        setSelectedMemberId('self')
        setLoaded(null)
      }
    } catch {
      if (requestId === directoryRequest.current) {
        setMembers([])
        setSelectedMemberId('self')
        setLoaded(null)
        setDirectoryError("We couldn't verify your current family access. No family health information is shown.")
      }
    } finally {
      if (requestId === directoryRequest.current) setCheckingAccess(false)
    }
  }, [groupId])

  useEffect(() => { setMembers(null); setSelectedMemberId('self'); setLoaded(null); void refreshMembers() }, [refreshMembers])

  const familyMembers = (members || []).filter(member => !member.is_self)
  useEffect(() => {
    const requested = searchParams.get('memberId')
    if (requested && members?.some(member => member.member_id === requested && !member.is_self)) setSelectedMemberId(requested)
  }, [searchParams, members])
  const selectedMember = familyMembers.find(member => member.member_id === selectedMemberId)
  const selectedGroup = groups?.find(group => group.id === groupId)
  const selectionKey = selectedMemberId === 'self' ? 'self' : JSON.stringify([
    groupId, selectedMember?.member_id, selectedMember?.patient_id, selectedMember?.authorization,
  ])

  const loadSelected = useCallback(async () => {
    const requestId = ++healthRequest.current
    setLoaded(null)
    try {
      const result = await familyHealthService.loadHealth(selectedMemberId === 'self'
        ? { selfPatient: auth.patient }
        : { groupId, memberId: selectedMemberId, initialMembers: members || undefined })
      if (requestId !== healthRequest.current) return
      if (result.membershipRemoved) {
        setLoaded(null)
        await refreshMembers()
        return
      }
      setLoaded({ key: selectionKey, result })
    } catch {
        if (requestId !== healthRequest.current) return
        setLoaded({ key: selectionKey, result: { member: selectedMember || null, authorizationStatus: 'error', permissions: {}, sections: Object.fromEntries(['appointments','medications','records','carePlan'].map(name => [name, { status: 'error', data: null }])) } })
    }
  }, [auth.patient, groupId, members, refreshMembers, selectedMember, selectedMemberId, selectionKey])

  useEffect(() => { void loadSelected(); return () => { healthRequest.current += 1 } }, [loadSelected, refreshVersion])

  useEffect(() => {
    const refreshAccess = async () => {
      await refreshMembers()
    }
    const interval = window.setInterval(refreshAccess, FAMILY_READOUT_MS)
    window.addEventListener('focus', refreshAccess)
    let expiryTimer
    if (loaded?.result?.expiresAt) {
      const delay = Math.min(2147483647, Math.max(0, Date.parse(loaded.result.expiresAt) - Date.now()))
      expiryTimer = window.setTimeout(refreshAccess, delay)
    }
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshAccess)
      if (expiryTimer) window.clearTimeout(expiryTimer)
    }
  }, [loaded, refreshMembers])

  const result = !checkingAccess && loaded?.key === selectionKey ? loaded.result : null
  const sections = result?.sections || {}
  const selectedIsSelf = selectedMemberId === 'self'
  const selectedName = selectedIsSelf ? (auth.patient.full_name || 'You') : (selectedMember?.display_name || result?.member?.display_name || 'This family member')
  const selectedAuthorization = result?.member?.authorization || selectedMember?.authorization
  const anyFamilyAccess = selectedIsSelf || Object.values(result?.permissions || {}).some(Boolean)
  const hasAccess = scope => {
    if (selectedIsSelf) return true
    if (result) return result.permissions?.[scope] === true
    const active = selectedAuthorization?.status === 'active' && (!selectedAuthorization.expires_at || Date.parse(selectedAuthorization.expires_at) > Date.now())
    return Boolean(active && selectedAuthorization?.[scope] === true)
  }
  const requestedMemberId = searchParams.get('memberId')
  const requestedGroupId = searchParams.get('groupId')
  const directAccessDenied = requestedMemberId && requestedMemberId !== 'self' && groups !== null && members !== null && !checkingAccess && (
    !groups.some(group => group.id === requestedGroupId)
    || !familyMembers.some(member => member.member_id === requestedMemberId)
    || (selectedMemberId === requestedMemberId && result && !anyFamilyAccess)
  )
  if (directAccessDenied) return <div className="dashboard-page family-health-page"><h1>Family Health</h1><p role="alert">Shared care is no longer available. Review your current Health Circle access.</p><Link className="button button--secondary" to="/family/overview">Family overview</Link></div>
  return <div className="dashboard-page family-health-page">
    <div className="page-heading"><div><h1>Family Health</h1><p>Real health information shared by adult family members.</p>{selectedGroup?.display_name && <span className="family-health-current-group">{selectedGroup.display_name}</span>}</div>
      <Link className="button button--secondary" to="/family/overview">Family overview</Link><Link className="button button--secondary" to="/family">Manage Care Circle</Link></div>
    {groups?.length > 1 && <label className="family-health-group-select">Family<select aria-label="Family group" value={groupId} onChange={event => setGroupId(event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.display_name}</option>)}</select></label>}
    <section aria-label="Family members" className="family-member-choices">
      <MemberButton self selected={selectedIsSelf} member={{ display_name: auth.patient.full_name || 'You' }} onSelect={() => setSelectedMemberId('self')} />
      {familyMembers.map(member => <MemberButton key={member.member_id} member={member} selected={selectedMemberId === member.member_id} onSelect={() => setSelectedMemberId(member.member_id)} />)}
    </section>
    {!groups?.length && groups !== null && <p className="dashboard-empty">No family members are connected yet. <Link to="/family">Manage Care Circle</Link>.</p>}
    {directoryError && <p role="alert">{directoryError}</p>}
    {checkingAccess && <p role="status">Checking current family access...</p>}
    <div className="family-health-toolbar">
      <button className="button button--secondary" type="button" disabled={checkingAccess} onClick={() => { void refreshMembers().then(() => setRefreshVersion(value => value + 1)) }}>Refresh health information</button>
      {selectedIsSelf && <Link className="button button--secondary" to="/dashboard">Open My Dashboard</Link>}
    </div>
    <SelectedMemberSummary name={selectedName} relationship={selectedIsSelf ? 'Self' : selectedMember?.relationshipLabel || 'Family member'} permissions={selectedAuthorization} isSelf={selectedIsSelf} groupName={selectedGroup?.display_name} />
    {!selectedIsSelf && result && !anyFamilyAccess && <div className="card family-no-access"><p>Health information has not been shared with you.</p><Link className="button button--secondary" to="/family">Manage Care Circle</Link></div>}
    <div className="family-health-columns">
      <div className="family-health-column family-health-column--primary">
        {hasAccess('appointments') && <AppointmentSection section={{ ...(sections.appointments || EMPTY_SECTION), member: result?.member || selectedMember }} />}
        {hasAccess('medications') && <MedicationSection section={sections.medications || EMPTY_SECTION} />}
        {hasAccess('records') && <RecordsSection key={`medical-documents-${selectionKey}`} section={selectedIsSelf ? sections.records || EMPTY_SECTION : sections.medicalDocuments || EMPTY_SECTION} patientId={result?.member?.patient_id} documentsOnly />}
      </div>
      <div className="family-health-column family-health-column--secondary">
        <CarePlanSection key={`care-plan-${selectionKey}`} section={sections.carePlan || EMPTY_SECTION} patientSection={sections.patientCarePlan || EMPTY_SECTION} isSelf={selectedIsSelf} memberName={selectedName} memberId={selectedMemberId} authorized={hasAccess('care_plans')} onView={() => { setLoaded(null); setRefreshVersion(value => value + 1) }} />
        {hasAccess('records') && <RecordsSection key={`health-records-${selectionKey}`} section={sections.records || EMPTY_SECTION} patientId={result?.member?.patient_id} member={result?.member || selectedMember} />}
      </div>
    </div>
  </div>
}

