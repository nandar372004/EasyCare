import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './dashboardLocalization.css'
import { useDashboardTranslation } from './useDashboardTranslation.js'
import { summarizeCarePlanMedicationActions } from '../../services/carePlanMedicationService.js'
import { DashboardMedications } from './DashboardMedications.jsx'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDashboardData } from './useDashboardData.js'
import { Link } from 'react-router-dom'
import { HeartPulse } from 'lucide-react'

import { useAuth } from '../auth/AuthContext.jsx'

import { HealthTrends } from './HealthTrends.jsx'

import { HealthSection, RecordedTime, label } from './PatientHealthSections.jsx'


import { isScheduledOn } from '../../services/patientMonitoringService.js'
import { getHealthWorldNews } from '../../services/healthWorldNewsService.js'


function HealthWorld() {
  const t = useDashboardTranslation()
  const { data, isPending, isError } = useQuery({
    queryKey: ['health-world', 'who-headlines'],
    queryFn: () => getHealthWorldNews(),
    staleTime: 45 * 60 * 1000,
    gcTime: 90 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  const items = data?.items || []
  return <article className="card dashboard-health-world dashboard-health-world--top" aria-label={t("Health World")}>
    <div className="dashboard-health-world-brand">
      <span className="dashboard-health-world-logo-wrap"><img className="dashboard-health-world-logo" src="/who-logo.png" alt={t("World Health Organization")} /></span>
      <header className="dashboard-health-world-heading"><h2>{t("The WHO Info")}</h2><p>{t("Latest health updates from WHO")}</p></header>
    </div>
    <div className="dashboard-health-world-content">
      {isPending ? <div className="dashboard-health-world-state" role="status">{t("Loading trusted health updates…")}</div>
        : isError && !data ? <div className="dashboard-health-world-state" role="status">{t("Health updates are temporarily unavailable.")}</div>
          : items.length ? <>{(data?.stale || isError) && <div className="dashboard-health-world-cache-note" role="status">{t("Showing recently cached updates.")}</div>}<ul className="dashboard-health-world-list">{items.map(item => <li key={item.article_url}>
            <a href={item.article_url} target="_blank" rel="noopener noreferrer"><span className="dashboard-health-world-title">{item.title}</span><span className="dashboard-health-world-meta">{item.source}{item.published_at ? ` · ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.published_at))}` : ''}</span>{item.summary && <span className="dashboard-health-world-summary">{item.summary}</span>}</a>
          </li>)}</ul></> : <div className="dashboard-health-world-state">{t("Latest trusted health updates will appear here.")}</div>}
    </div>
  </article>
}



const bangkokDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const plusDays = (day, amount) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10) }

function NeedsAttentionCard({ sections, monitoring, family }) {
  const t = useDashboardTranslation()
  const today = bangkokDate()
  const activePlans = (monitoring?.data?.plans || []).filter(plan => plan.isActive)
  const checkIns = monitoring?.data?.checkIns || []
  const todayOccurrences = activePlans.filter(plan => isScheduledOn(plan, today))
    .flatMap(plan => (plan.times?.length ? plan.times : [{ id: 'any' }]).map(time => ({ plan, key: time.id || 'any' })))
  const appointments = sections.appointment?.data?.next ? [sections.appointment.data.next] : []
  const attention = [
    ...(sections.alerts?.data || []).filter(alert => ['open', 'escalated'].includes(alert.status)).map(alert => ({ label: alert.title || t('Review monitoring alert'), href: '/monitoring' })),
    ...todayOccurrences.filter(row => !checkIns.some(check => check.monitoringPlanId === row.plan.id && check.localDate === today && check.occurrenceKey === row.key && check.status === 'done')).map(row => ({ label: t('{name} · due today', { name: row.plan.title }), href: '/my-care-plan' })),
    ...appointments.filter(row => row.status === 'pending').map(row => ({ label: t('Pending appointment request'), href: `/appointments/${row.id}` })),
    ...(family?.attentionItems || []).map(item => ({ label: `${item.displayName}: ${item.title}`, href: item.destination || '/family/overview' })),
  ]
  return <article className="card dashboard-command-card dashboard-needs-attention-card" aria-label={t("Needs Attention")}>
    <h2>{t("Needs Attention")}</h2>
    {sections.alerts?.status !== 'ready' && monitoring?.status !== 'ready' ? <p>{t("Checking care actions…")}</p>
      : attention.length ? <ul>{attention.slice(0, 5).map((item, index) => <li key={`${item.href}-${index}`}><Link to={item.href}>{item.label}</Link></li>)}</ul>
        : <p>{t("No current action due.")}</p>}
  </article>
}

function DashboardOperationalCards({ sections, monitoring, goals, medicationSummary, medicationCard, careStack }) {
  const t = useDashboardTranslation()
  const today = bangkokDate()
  const activePlans = (monitoring?.data?.plans || []).filter(plan => plan.isActive)
  const checkIns = monitoring?.data?.checkIns || []
  const todayPlans = activePlans.filter(plan => isScheduledOn(plan, today))
  const todayOccurrences = todayPlans.flatMap(plan => (plan.times?.length ? plan.times : [{ id: 'any', timeOfDay: null }]).map(time => ({ plan, key: time.id || 'any' })))
  const todayMonitoringDone = todayOccurrences.filter(occurrence => checkIns.some(row => row.monitoringPlanId === occurrence.plan.id && row.localDate === today && row.occurrenceKey === occurrence.key && row.status === 'done')).length
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const weekStartOffset = -((weekday + 6) % 7)
  const weekDays = Array.from({ length: 7 }, (_, index) => plusDays(today, weekStartOffset + index))
  const weekOccurrences = activePlans.flatMap(plan => weekDays.flatMap(day => isScheduledOn(plan, day) ? (plan.times?.length ? plan.times : [{ id: 'any' }]).map(time => ({ plan, day, key: time.id || 'any' })) : []))
  const weekMonitoringDone = weekOccurrences.filter(occurrence => checkIns.some(row => row.monitoringPlanId === occurrence.plan.id && row.localDate === occurrence.day && row.occurrenceKey === occurrence.key && row.status === 'done')).length
  const goalRows = goals?.data || []
  const activeGoals = goalRows.filter(goal => !goal.isCompleted)
  const completedGoals = goalRows.filter(goal => goal.isCompleted)
  const medData = sections.medications?.data || {}
  const medicationCheckIns = medData.checkIns
  const medRequired = medicationSummary.required
  const medDone = medicationSummary.done
  const actionTotal = medRequired + todayOccurrences.length
  const actionDone = medDone + todayMonitoringDone
  const dailySourcesReady = sections.medications?.status === 'ready' && sections.appointment?.status === 'ready' && monitoring?.status === 'ready'
  const progressSourcesReady = dailySourcesReady && goals?.status === 'ready'
  const recentSourcesReady = ['records', 'labs', 'prescriptions', 'medications'].every(name => sections[name]?.status === 'ready') && monitoring?.status === 'ready' && goals?.status === 'ready'
  const appointments = sections.appointment?.data?.next ? [sections.appointment.data.next] : []
  const recentUpdates = [
    ...(sections.records?.data || []).map(row => ({ label: row.record.title || row.record.chiefComplaint || t('Health record updated'), at: row.recordedAt, href: row.kind === 'document' ? '/medical-documents' : '/health-records' })),
    ...(sections.labs?.data || []).map(row => ({ label: t('{name} recorded', { name: row.testName || t('Lab result') }), at: row.observedAt || row.createdAt, href: '/lab-results' })),
    ...(sections.prescriptions?.data || []).map(row => ({ label: `${t('Prescription recorded')}${row.prescriptionItems?.[0]?.medicationName ? ` · ${row.prescriptionItems[0].medicationName}` : ''}`, at: row.issuedAt, href: '/prescriptions' })),
    ...appointments.filter(row => row.status === 'completed').map(row => ({ label: t('Appointment completed'), at: row.updatedAt || row.scheduledStart, href: `/appointments/${row.id}` })),
    ...checkIns.filter(row => row.status === 'done').map(row => ({ label: t('Monitoring check-in completed'), at: row.completedAt, href: '/my-care-plan' })),
    ...(medicationCheckIns || []).filter(row => row.status === 'taken').map(row => ({ label: t('Medication check-in recorded'), at: row.completedAt, href: '/my-care-plan#care-my-medications' })),
    ...goalRows.filter(row => row.isCompleted).map(row => ({ label: t('Goal completed: {name}', { name: row.title }), at: row.completedAt, href: '/my-care-plan' })),
  ].filter(row => Date.parse(row.at)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5)
  return <>
    <div className="dashboard-command-grid">
      <div className="dashboard-command-column">
        {medicationCard}
        <article className="card dashboard-command-card" aria-label={t("Monitoring Progress")}><h2>{t("Monitoring Progress")}</h2>{monitoring?.status === 'error' ? <p className="dashboard-compact-state">{t("Temporarily unavailable.")}</p> : monitoring?.status !== 'ready' ? <p className="dashboard-compact-state">{t("Loading…")}</p> : <>{activePlans.length ? <><p>{t('Today: {done}/{total} completed', { done: todayMonitoringDone, total: todayOccurrences.length })}</p><p>{t('This week: {done}/{total} completed', { done: weekMonitoringDone, total: weekOccurrences.length })}</p>{todayOccurrences.length > todayMonitoringDone && <p>{t("Next due:")} {todayOccurrences.find(row => !checkIns.some(check => check.monitoringPlanId === row.plan.id && check.localDate === today && check.occurrenceKey === row.key && check.status === 'done'))?.plan.title}</p>}</> : <p>{t("No active monitoring routines.")}</p>}</>}<Link to="/my-care-plan">{t("View Monitoring Plan")}</Link></article>
      </div>
      <div className="dashboard-command-column">
        {careStack}
        <article className="card dashboard-command-card" aria-label={t("Health Goals")}><h2>{t("Health Goals")}</h2>{goals?.status === 'error' ? <p className="dashboard-compact-state">{t("Temporarily unavailable.")}</p> : goals?.status !== 'ready' ? <p className="dashboard-compact-state">{t("Loading…")}</p> : <p>{t('{active} active · {done} completed', { active: activeGoals.length, done: completedGoals.length })}</p>}<Link to="/my-care-plan">{t("View Health Goals")}</Link></article>
        <article className="card dashboard-command-card" aria-label={t("Recent Health Updates")}><h2>{t("Recent Health Updates")}</h2>{recentUpdates.length ? <ul>{recentUpdates.map((row, index) => <li key={`${row.href}-${index}`}><Link to={row.href}>{row.label}</Link><time>{new Date(row.at).toLocaleDateString()}</time></li>)}</ul> : <p className="dashboard-compact-state">{recentSourcesReady ? t("No recent health updates recorded.") : t("Loading…")}</p>}</article>
        <article className="card dashboard-command-card" aria-label={t("Care Progress")}><h2>{t("Care Progress")}</h2>{progressSourcesReady ? <ul><li><span>{t("Today’s required actions")}</span><strong>{actionDone}/{actionTotal} {t("completed")}</strong></li><li><span>{t("Medication actions")}</span><strong>{medDone}/{medRequired} {t("completed")}</strong></li><li><span>{t("Monitoring this week")}</span><strong>{weekMonitoringDone}/{weekOccurrences.length}</strong></li><li><span>{t("Health goals")}</span><strong>{t('{active} active · {done} completed', { active: activeGoals.length, done: completedGoals.length })}</strong></li></ul> : <p className="dashboard-compact-state">{t("Temporarily unavailable.")}</p>}</article>
      </div>
    </div>
  </>
}

export function DashboardPage() {
  const t = useDashboardTranslation()
  const localization = useOptionalLocalization()
  const auth = useAuth()
  const patientId = auth.patient?.id
  const { sections, onboarding, family, monitoring, goals } = useDashboardData(auth)
  const state = name => sections?.[name] ?? { status: patientId && auth.status !== 'loading' ? 'loading' : 'error' }
  const overview = sections?.overview?.data
  const name = overview?.profile?.fullName || (patientId && auth.patient?.full_name) || t('EasyCare Patient')
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Yangon', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const appointment = sections?.appointment?.data
  const medicationData = sections?.medications?.data || {}
  const medicationSummary = useMemo(() => summarizeCarePlanMedicationActions(medicationData), [sections?.medications?.data])
  return <div className="dashboard-page phase11-dashboard individual-health-dashboard" lang={localization?.language || 'en'}>
    {localization && <div className="dashboard-language" role="group" aria-label="Myanmar | English"><button type="button" lang="my" aria-label="Myanmar" aria-pressed={localization.language === 'my'} onClick={() => localization.setLanguage('my')}>မြန်မာ</button><span aria-hidden="true">|</span><button type="button" lang="en" aria-pressed={localization.language === 'en'} onClick={() => localization.setLanguage('en')}>English</button></div>}
    {patientId && onboarding && onboarding.status !== 'completed' && <section className="card dashboard-onboarding-card" aria-label={t("Profile setup")}>
      <div><span className="eyebrow">{t("Optional next step")}</span><h2>{t("Complete your profile")}</h2><p>{t("Add a few details to get more from EasyCare.")}</p></div>
      <Link className="button button--primary" to="/onboarding">{t("Continue Setup")}</Link>
    </section>}
    {patientId && family && <section className="card dashboard-family-card" aria-label={t("Family setup")}>
      {family.status === 'ready' && family.hasConnectedMembers ? <>
        <div><span className="eyebrow">{t("Family care")}</span><h2>{family.familyName || t('My Family')}</h2><ul className="dashboard-family-groups">{family.members.filter(member => member.patientId !== family.ownerPatientId).map(member => <li key={member.patientId}><strong>{member.displayName}</strong><span>{member.statusReason}</span></li>)}</ul><p>{t("Health information is shared only when each adult grants permission.")}</p></div>
        <div className="dashboard-family-actions"><Link className="button button--secondary" to="/family">{t("Manage Care Circle")}</Link><Link className="button button--primary" to="/family/overview">{t("View Family Health")}</Link></div>
      </> : <><div><span className="eyebrow">{t("Optional")}</span><h2>{t("Care for your family with EasyCare")}</h2>{family.status !== 'error' && <p>{t("Create or join a family group to organize care together. Health information stays private until each adult gives permission.")}</p>}</div><Link className="button button--primary" to="/family">{t("Set Up Family")}</Link></>}
    </section>}
    {!patientId && auth.status !== 'loading' && <p role="alert">{t("Sign in with a patient account to view your records.")}</p>}
    <section className="dashboard-hero-section">
      <div className="card dashboard-hero"><div className="dashboard-hero-copy">
        <span className="eyebrow">{t("Your Health Today")}</span><h1>{t(greeting)}{localization?.language === 'my' ? '၊ ' : ', '}{name}</h1><p>{t("Here is your latest health and care information.")}</p>
        <div className="dashboard-personal-health-note" aria-label={t("Personal Health Information")}><HeartPulse aria-hidden="true" /><span><strong>{t("Personal Health Information")}</strong><small>{t("Cervical Spondylosis")}</small></span></div>
        <div className="dashboard-hero-actions"><Link className="button button--primary" to="/care/start">{t("I Need Care")}</Link><Link className="button button--secondary" to="/health-guardian">{t("AI Health Guardian")}</Link></div>
      </div><div className="dashboard-hero-visual" aria-hidden="true"><img className="hero-doctor" src="/dashboard-doctors.png" alt="" /></div></div>
    </section>
    <HealthWorld />
    <NeedsAttentionCard sections={sections || {}} monitoring={monitoring} family={family} />
    <HealthTrends key={patientId} monitoring={monitoring} patientName={name} />

    <DashboardOperationalCards
      sections={sections || {}}
      monitoring={monitoring}
      goals={goals}
      medicationSummary={medicationSummary}
      medicationCard={<DashboardMedications section={state('medications')} summary={medicationSummary} />}
      careStack={<div className="dashboard-care-stack">
        <HealthSection title="Upcoming Care" section={state('appointment')} hasData={!!appointment?.next} empty="No upcoming appointment.">
          {appointment?.next && <div className="patient-health-details">
            <strong>{appointment.doctor?.displayName || (appointment.providerError ? t("Provider information unavailable") : t("Provider name not recorded"))}</strong>
            <span>{appointment.doctor?.specialty || t('Specialty not recorded')}</span>
            <span>{t(label(appointment.next.appointmentType))} · {t(label(appointment.next.consultationChannel))}</span>
            <RecordedTime localized value={appointment.next.scheduledStart} /><span className={`status-badge status-${appointment.next.status}`}>{t(label(appointment.next.status))}</span>
            <Link to={`/appointments/${appointment.next.id}`}>{t("View Appointment")}</Link>
          </div>}
        </HealthSection>
      </div>}
    />
    <section aria-label={t("Quick Actions")}><h2>{t("Quick Actions")}</h2><div className="dashboard-quick-actions">
      {[[ '/doctors', 'Book Appointment' ],[ '/medications', 'Medications' ],[ '/health-records', 'Health Records' ],[ '/lab-results', 'Lab Results' ],[ '/health-guardian', 'AI Health Guardian' ]].map(([to, text]) => <Link className="card quick-action-card" key={to} to={to}><strong>{t(text)}</strong></Link>)}
    </div></section>
  </div>
}
