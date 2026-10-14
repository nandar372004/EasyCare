import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Clock3, HeartPulse, LoaderCircle, Pill, Stethoscope } from 'lucide-react'
import { carePlanService } from '../../services/carePlanService.js'
import { useAuth } from '../auth/AuthContext.jsx'

const currentVersionId = plan => plan?.current_version_id || plan?.current_version?.id
const asDate = value => value ? new Date(value) : null
const isValidDate = value => value instanceof Date && !Number.isNaN(value.getTime())
const localDate = (date, timezone) => {
  if (!isValidDate(date)) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
const calendarDay = (value, zone) => {
  if (!value) return null
  if (dateOnly(value)) return value
  return localDate(asDate(value), zone)
}
const dayIndex = date => Date.UTC(...date.split('-').map((part, index) => index === 1 ? Number(part) - 1 : Number(part))) / 86400000
export function planDayLabel(plan, now = new Date()) {
  const zone = plan?.timezone || 'Asia/Yangon'
  const starts = calendarDay(plan?.starts_at, zone)
  const today = localDate(now, zone)
  if (!starts || !today) return null
  const day = Math.floor(dayIndex(today) - dayIndex(starts)) + 1
  if (day < 1) return null
  const ends = calendarDay(plan?.target_end_at, zone)
  return ends ? `Day ${day} of ${Math.floor(dayIndex(ends) - dayIndex(starts)) + 1}` : `Day ${day}`
}
const formatDate = (value, zone = 'Asia/Yangon') => {
  const date = asDate(value)
  if (!isValidDate(date)) return 'Not available'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: zone }).format(date)
}
const formatLocalDate = (value) => {
  const date = dateOnly(value) ? new Date(`${value}T12:00:00Z`) : asDate(value)
  return isValidDate(date) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date) : 'Date unavailable'
}
const formatTime = (value, zone = 'Asia/Yangon') => {
  const date = asDate(value)
  return isValidDate(date) ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(date) : 'Time unavailable'
}
const statusLabel = status => ({ draft: 'Draft', active: 'Active', paused: 'Paused', completed: 'Completed', discontinued: 'Discontinued', cancelled: 'Cancelled' })[status] || 'Status unavailable'
const taskTypeLabel = type => ({ medication: 'Medication', vital_check: 'Vital check', appointment: 'Appointment', follow_up: 'Follow-up', activity: 'Activity', instruction: 'Instruction', custom: 'Care task' })[type] || 'Care task'
const taskIcon = type => type === 'medication' ? Pill : type === 'vital_check' ? HeartPulse : type === 'appointment' || type === 'follow_up' ? CalendarDays : CheckCircle2
const taskDayTitle = (occurrence, today) => occurrence.local_due_date === today ? 'Today' : formatLocalDate(occurrence.local_due_date)
const chooseDefaultPlan = plans => {
  const active = plans.filter(plan => plan.status === 'active')
  if (active.length === 1) return active[0].id
  if (active.length > 1) return ''
  return plans[0]?.id || ''
}

function TaskCard({ occurrence, task, today, now, planStatus, onAcknowledge, acknowledging }) {
  if (!task) return null
  const Icon = taskIcon(task.task_type)
  const completed = occurrence.completed === true
  const due = asDate(occurrence.scheduled_at)
  const canAcknowledge = planStatus === 'active' && !completed && task.manual_acknowledgement && ['activity', 'instruction', 'custom'].includes(task.task_type)
    && occurrence.status === 'pending' && due && due.getTime() <= now.getTime()
  let state = completed ? 'Completed' : occurrence.status === 'cancelled' ? 'Cancelled' : due && due < now ? 'Incomplete' : 'Upcoming'
  if (!completed && occurrence.status === 'pending' && due && due <= now) state = 'Due'
  let sourceLabel = ''
  if (completed) {
    if (occurrence.source?.type === 'medication_event') sourceLabel = 'Taken'
    else if (occurrence.source?.type === 'vital_reading') sourceLabel = `Recorded ${formatTime(occurrence.source.reading?.recorded_at, occurrence.timezone)}`
    else if (occurrence.source?.type === 'appointment') sourceLabel = 'Appointment completed'
    else if (occurrence.source?.type === 'follow_up') sourceLabel = 'Follow-up completed'
    else sourceLabel = 'Completed as instructed'
  }
  if (!completed && task.task_type === 'appointment' && task.appointment?.status) sourceLabel = `Appointment ${task.appointment.status}`
  if (!completed && task.task_type === 'follow_up' && task.follow_up?.status) sourceLabel = `Follow-up ${task.follow_up.status}`
  return <article className={`my-care-task${completed ? ' is-complete' : ''}`}>
    <div className="my-care-task-icon"><Icon aria-hidden="true" /></div>
    <div className="my-care-task-main">
      <div className="my-care-task-heading"><h3>{task.title}</h3><span className={`my-care-task-status status-${completed ? 'completed' : state.toLowerCase()}`}>{state}</span></div>
      <p className="my-care-task-meta">{taskTypeLabel(task.task_type)} <span aria-hidden="true">·</span> {taskDayTitle(occurrence, today)} at {formatTime(occurrence.scheduled_at, occurrence.timezone)}</p>
      {task.instructions && <p className="my-care-task-instructions">{task.instructions}</p>}
      {task.task_type === 'follow_up' && task.follow_up?.instructions && <p className="my-care-task-instructions">{task.follow_up.instructions}</p>}
      {sourceLabel && <p className="my-care-task-source">{sourceLabel}{completed && occurrence.completed_at ? ` · ${formatTime(occurrence.completed_at, occurrence.timezone)}` : ''}</p>}
      {task.task_type === 'vital_check' && !completed && <Link className="my-care-inline-link" to="/health-records">View health records</Link>}
      {task.task_type === 'appointment' && task.appointment?.id && <Link className="my-care-inline-link" to={`/appointments/${task.appointment.id}`}>View appointment</Link>}
      {canAcknowledge && <button className="button button--secondary my-care-ack" type="button" disabled={acknowledging} onClick={() => onAcknowledge(occurrence.id)}>
        {acknowledging ? <><LoaderCircle aria-hidden="true" className="my-care-spinner" /> Saving…</> : 'Mark as done'}
      </button>}
    </div>
  </article>
}

export function MyCarePlanPage({ service = carePlanService, nowProvider = () => new Date() }) {
  const auth = useAuth()
  const patientId = auth.patient?.id
  const [plansState, setPlansState] = useState({ status: 'loading', plans: [] })
  const [selectedId, setSelectedId] = useState('')
  const [detailState, setDetailState] = useState({ status: 'idle' })
  const [occurrences, setOccurrences] = useState([])
  const [occurrencesState, setOccurrencesState] = useState('idle')
  const [reconcileError, setReconcileError] = useState('')
  const [ackError, setAckError] = useState('')
  const [ackSuccess, setAckSuccess] = useState('')
  const [acknowledgingId, setAcknowledgingId] = useState('')
  const [listRetry, setListRetry] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const reconciled = useRef(new Set())
  const request = useRef(0)
  const now = nowProvider()

  useEffect(() => {
    let current = true
    setSelectedId('')
    setPlansState({ status: patientId ? 'loading' : auth.status === 'loading' ? 'loading' : 'identity', plans: [] })
    setDetailState({ status: 'idle' }); setOccurrences([]); setOccurrencesState('idle'); setReconcileError('')
    if (!patientId) return () => { current = false }
    service.listMyPlans().then(result => {
      if (!current) return
      if (!Array.isArray(result)) throw new Error('Care plan access could not be verified.')
      const ownPlans = result.filter(plan => plan.patient_id === patientId)
      setPlansState({ status: 'ready', plans: ownPlans })
      setSelectedId(chooseDefaultPlan(ownPlans))
    }).catch(() => { if (current) setPlansState({ status: 'error', plans: [] }) })
    return () => { current = false }
  }, [patientId, auth.status, service, listRetry])

  const selectedPlan = useMemo(() => plansState.plans.find(plan => plan.id === selectedId), [plansState.plans, selectedId])
  const reloadDetail = useCallback(async (planId, version) => {
    const [detailResult, rowsResult] = await Promise.allSettled([service.getDetail(planId), service.getOccurrences(planId)])
    const detail = detailResult.status === 'fulfilled' ? detailResult.value : null
    if (!detail || !detail.plan) throw new Error('Care plan details are unavailable.')
    if (version !== request.current) return
    setDetailState({ status: 'ready', detail })
    if (rowsResult.status === 'fulfilled' && Array.isArray(rowsResult.value)) {
      setOccurrences(rowsResult.value); setOccurrencesState('ready')
    } else { setOccurrences([]); setOccurrencesState('error') }
  }, [service])

  useEffect(() => {
    if (!selectedPlan) return undefined
    const version = ++request.current
    let current = true
    setDetailState({ status: 'loading' }); setOccurrences([]); setOccurrencesState('loading'); setReconcileError(''); setAckError(''); setAckSuccess('')
    const load = async () => {
      try {
        await reloadDetail(selectedPlan.id, version)
        if (!current || version !== request.current) return
        if (selectedPlan.status === 'active' && !reconciled.current.has(selectedPlan.id)) {
          reconciled.current.add(selectedPlan.id)
          try {
            const changed = await service.reconcileOccurrences(selectedPlan.id)
            if (changed !== 0 && current && version === request.current) await reloadDetail(selectedPlan.id, version)
          } catch {
            if (current && version === request.current) setReconcileError('Some source records could not be refreshed. The care plan details below are still available.')
          }
        }
      } catch {
        if (current && version === request.current) setDetailState({ status: 'error' })
      }
    }
    void load()
    return () => { current = false }
  }, [selectedPlan, service, reloadDetail, detailRetry])

  const handleAcknowledge = async occurrenceId => {
    if (acknowledgingId) return
    setAcknowledgingId(occurrenceId); setAckError(''); setAckSuccess('')
    try {
      await service.acknowledgeOccurrence(occurrenceId)
      await reloadDetail(selectedId, request.current)
      setAckSuccess('Care task marked as done.')
    } catch {
      setAckError('This task could not be updated. Refresh the page or try again later.')
    } finally { setAcknowledgingId('') }
  }

  if (auth.status === 'loading' || plansState.status === 'loading') return <main className="my-care-page" aria-busy="true"><h1>My Care Plan</h1><div className="my-care-state" role="status"><LoaderCircle aria-hidden="true" className="my-care-spinner" /> Loading your care plan…</div></main>
  if (!patientId || plansState.status === 'identity') return <main className="my-care-page"><h1>My Care Plan</h1><section className="my-care-state" role="alert"><h2>Patient account required</h2><p>Sign in with your patient account to view your clinical care plan.</p></section></main>
  if (plansState.status === 'error') return <main className="my-care-page"><h1>My Care Plan</h1><section className="my-care-state" role="alert"><h2>Unable to load your care plans</h2><p>Check your connection and try again.</p><button type="button" className="button button--secondary" onClick={() => { reconciled.current.clear(); setPlansState({ status: 'loading', plans: [] }); setSelectedId(''); setListRetry(value => value + 1) }}>Try again</button></section></main>
  if (!plansState.plans.length) return <main className="my-care-page"><header className="my-care-header"><div><span className="eyebrow">Your clinical care journey</span><h1>My Care Plan</h1><p>Follow the guidance your care provider creates for you.</p></div></header><section className="my-care-state my-care-empty"><Stethoscope aria-hidden="true" /><h2>No active care plan</h2><p>Your clinical care plan will appear here when your care provider creates one for you.</p><Link className="my-care-inline-link" to="/care-plan">Explore Home Care separately</Link></section></main>
  if (!selectedPlan) return <main className="my-care-page"><header className="my-care-header"><div><span className="eyebrow">Your clinical care journey</span><h1>My Care Plan</h1><p>Select a plan to view its tasks and progress.</p></div></header><PlanSelector plans={plansState.plans} selectedId={selectedId} onChange={setSelectedId} /></main>

  const detail = detailState.detail
  const plan = detail?.plan || selectedPlan
  const versionId = currentVersionId(plan)
  const version = detail?.versions?.find(item => item.id === versionId) || selectedPlan.current_version || {}
  const tasks = detail?.tasks || []
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const goals = (detail?.goals || []).filter(goal => goal.version_id === versionId)
  const timezone = plan.timezone || 'Asia/Yangon'
  const today = localDate(now, timezone)
  const todayRows = occurrences.filter(row => row.local_due_date === today).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))
  const upcoming = selectedPlan.status === 'active' ? occurrences.filter(row => row.required && row.status === 'pending' && row.completed !== true && asDate(row.scheduled_at) > now)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))[0]
    : null
  const upcomingTask = upcoming && taskById.get(upcoming.task_id)
  const progress = detail?.progress?.today
  const displayDay = planDayLabel(plan, now)
  const lifecycle = plan.status
  const unavailable = detailState.status === 'error'

  return <main className="my-care-page">
    <header className="my-care-header"><div><span className="eyebrow">Your clinical care journey</span><h1>My Care Plan</h1><p>Tasks and guidance from your care provider.</p></div>
      {plansState.plans.length > 1 && <PlanSelector plans={plansState.plans} selectedId={selectedId} onChange={setSelectedId} compact />}
    </header>
    <section className="my-care-hero card" aria-labelledby="my-care-plan-title">
      <div className="my-care-hero-top"><div><span className="eyebrow">{statusLabel(lifecycle)} care plan</span><h2 id="my-care-plan-title">{version.title || selectedPlan.current_version?.title || 'Care plan title unavailable'}</h2>{version.summary && <p>{version.summary}</p>}</div><span className={`my-care-plan-status status-${lifecycle}`}>{statusLabel(lifecycle)}</span></div>
      <div className="my-care-facts"><div><span>Plan dates</span><strong>{displayDay || 'Day information unavailable'}</strong></div><div><span>Started</span><strong>{formatDate(plan.starts_at, timezone)}</strong></div><div><span>Target end</span><strong>{plan.target_end_at ? formatDate(plan.target_end_at, timezone) : 'Not set'}</strong></div><div><span>Responsible provider</span><strong>Provider information unavailable</strong></div></div>
      {version.instructions && <div className="my-care-instructions"><h3>Plan instructions</h3><p>{version.instructions}</p></div>}
    </section>
    {detailState.status === 'loading' && <div className="my-care-state" role="status" aria-live="polite"><LoaderCircle aria-hidden="true" className="my-care-spinner" /> Loading plan details…</div>}
    {unavailable && <section className="my-care-state" role="alert"><h2>Plan details are temporarily unavailable</h2><p>Your plan summary remains visible. Try again to load tasks and progress.</p><button type="button" className="button button--secondary" onClick={() => setDetailRetry(value => value + 1)}>Try again</button></section>}
    {reconcileError && <p className="my-care-inline-error" role="status">{reconcileError}</p>}
    {ackError && <p className="my-care-inline-error" role="alert">{ackError}</p>}
    {ackSuccess && <p className="my-care-inline-success" role="status">{ackSuccess}</p>}
    {!unavailable && detailState.status === 'ready' && <>
      <section className="my-care-progress card" aria-labelledby="my-care-progress-title">
        <div className="my-care-section-heading"><div><span className="eyebrow">Today's Care Tasks</span><h2 id="my-care-progress-title">Today's Progress</h2></div></div>
        {progress?.state === 'no_tasks_due' ? <p className="my-care-semantic-empty">No care tasks due today</p> : progress?.state === 'tasks_due' ? <><p className="my-care-progress-copy"><strong>{progress.completed} of {progress.total} tasks completed</strong></p><progress aria-label="Today's care tasks completed" max={progress.total} value={progress.completed}>{progress.completed} of {progress.total}</progress><p className="my-care-muted">{Math.max(0, progress.total - progress.completed)} tasks remaining today</p></> : <p className="my-care-muted">Today's progress is unavailable.</p>}
      </section>
      <section className="my-care-section" aria-labelledby="today-tasks-title"><div className="my-care-section-heading"><div><span className="eyebrow">Your schedule</span><h2 id="today-tasks-title">Today</h2></div></div>
        {occurrencesState === 'error' ? <div className="my-care-state my-care-small-state" role="alert"><p>Today's care tasks could not be loaded.</p></div> : todayRows.length ? <div className="my-care-task-list">{todayRows.map(row => <TaskCard key={row.id} occurrence={row} task={taskById.get(row.task_id)} today={today} now={now} planStatus={lifecycle} onAcknowledge={handleAcknowledge} acknowledging={acknowledgingId === row.id} />)}</div> : <div className="my-care-state my-care-small-state"><p>No care tasks due today</p></div>}
      </section>
      <section className="my-care-next card" aria-labelledby="my-care-next-title"><div><span className="eyebrow">Next</span><h2 id="my-care-next-title">Next care task</h2></div>{occurrencesState === 'error' ? <p className="my-care-muted" role="status">Upcoming tasks are unavailable.</p> : upcoming && upcomingTask && lifecycle === 'active' ? <div className="my-care-next-content"><strong>{upcomingTask.title}</strong><span>{taskDayTitle(upcoming, today)} · {formatTime(upcoming.scheduled_at, timezone)}</span><span>{taskTypeLabel(upcomingTask.task_type)}</span>{upcomingTask.task_type === 'appointment' && upcomingTask.appointment?.id && <Link className="my-care-inline-link" to={`/appointments/${upcomingTask.appointment.id}`}>View appointment</Link>}</div> : <p className="my-care-muted">No upcoming care tasks</p>}</section>
      <section className="my-care-section" aria-labelledby="my-care-goals-title"><div className="my-care-section-heading"><div><span className="eyebrow">Care objectives</span><h2 id="my-care-goals-title">Goals</h2></div></div>
        {goals.length ? <ul className="my-care-goals">{goals.map(goal => <li key={goal.id}><strong>{goal.title}</strong>{goal.description && <p>{goal.description}</p>}{goal.target_text && <p>{goal.target_text}</p>}</li>)}</ul> : <div className="my-care-state my-care-small-state"><p>No care goals have been added to this plan yet.</p></div>}
      </section>
      <section className="my-care-info card"><h2>Plan information</h2><dl><div><dt>Status</dt><dd>{statusLabel(lifecycle)}</dd></div><div><dt>Plan version</dt><dd>{version.version_no ? `Version ${version.version_no}` : 'Not available'}</dd></div><div><dt>Last updated</dt><dd>{formatDate(plan.updated_at || version.created_at, timezone)}</dd></div></dl>
        {lifecycle === 'paused' && <p className="my-care-plan-notice"><strong>Care plan paused.</strong> The existing plan information is shown for reference.</p>}
        {lifecycle === 'completed' && <p className="my-care-plan-notice"><strong>Care plan completed.</strong> This plan is shown as history.</p>}
        {lifecycle === 'discontinued' && <p className="my-care-plan-notice"><strong>Care plan discontinued.</strong> Follow-up actions are not available here.</p>}
      </section>
    </>}
  </main>
}

function PlanSelector({ plans, selectedId, onChange, compact = false }) {
  return <label className={`my-care-plan-selector${compact ? ' is-compact' : ''}`}>
    <span>{compact ? 'Choose a plan' : 'Your plans'}</span>
    <select aria-label="Choose a care plan" value={selectedId} onChange={event => onChange(event.target.value)}>
      {!selectedId && <option value="">Select a care plan</option>}
      {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.current_version?.title || 'Care plan'} · {statusLabel(plan.status)} · {formatDate(plan.starts_at, plan.timezone)}</option>)}
    </select>
  </label>
}
