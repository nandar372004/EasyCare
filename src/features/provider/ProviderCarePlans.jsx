import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { carePlanService } from '../../services/carePlanService.js'
import { providerWorkspaceService } from '../../services/providerWorkspaceService.js'
import { useAuth } from '../auth/AuthContext.jsx'

const STATUSES = ['draft', 'active', 'paused', 'completed', 'discontinued', 'cancelled']
const TASK_TYPES = ['medication', 'vital_check', 'appointment', 'follow_up', 'activity', 'instruction', 'custom']
const VITAL_TYPES = ['blood_pressure', 'heart_rate', 'spo2', 'temperature', 'glucose', 'weight']
const RECURRENCES = ['one_time', 'daily', 'selected_weekdays', 'multiple_daily_slots', 'source_schedule']
const STEPS = ['Patient', 'Plan Details', 'Goals', 'Tasks', 'Review', 'Activate']
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Yangon' })
function localDateTimeToIso(value, timeZone) {
  const [date, time] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let instant = desired
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const part = key => Number(parts.find(item => item.type === key)?.value)
    const represented = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'))
    instant += desired - represented
  }
  return new Date(instant).toISOString()
}
const times = value => value.split(',').map(item => item.trim()).filter(Boolean)
const errorText = error => /linked clinical source|source selector/i.test(error?.message ?? '')
  ? error.message
  : /changed while|update is in progress/i.test(error?.message ?? '')
    ? error.message
    : /42501|authorized|access|related|provider eligibility|patient relationship/i.test(error?.message ?? '')
      ? error.message
      : /22023|invalid|version|draft|transition|current state/i.test(error?.message ?? '')
        ? error.message
        : 'The Care Plan could not be saved. Check your connection and retry.'

function useDoctor() { return useAuth().provider?.type === 'doctor' }

export function ProviderCarePlansPlaceholder() {
  const { provider } = useAuth()
  const doctor = provider?.type === 'doctor'
  const [plans, setPlans] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setStatus('loading'); setError('')
    try { const rows = await carePlanService.listProviderPlans(); setPlans(rows ?? []); setStatus('ready') }
    catch (caught) { setError(errorText(caught)); setStatus('error') }
  }, [])
  useEffect(() => { setPlans([]); if (doctor) void reload(); else setStatus('ineligible') }, [doctor, provider?.id, reload])
  if (!doctor) return <section><h1>Care Plans</h1><div className="card"><p>Care Plan authoring is available to eligible doctors only.</p></div></section>
  const groups = STATUSES.filter(statusName => statusName !== 'cancelled')
  return <section className="provider-care-plans">
    <div className="provider-page-heading"><div><span className="eyebrow">Clinical Workspace</span><h1>Care Plans</h1></div><Link className="button button--primary" to="/provider/care-plans/new">Create Care Plan</Link></div>
    {status === 'loading' && <p role="status">Loading your Care Plans…</p>}
    {status === 'error' && <div className="error-message" role="alert">{error}<button type="button" onClick={() => void reload()}>Retry</button></div>}
    {status === 'ready' && !plans.length && <div className="card"><h2>No Care Plans</h2><p>Plans for your authorized patients will appear here.</p></div>}
    {status === 'ready' && groups.map(group => {
      const items = plans.filter(plan => plan.status === group)
      if (!items.length) return null
      return <section className="provider-plan-group" key={group}><h2>{group[0].toUpperCase() + group.slice(1)}</h2><div className="provider-plan-list">{items.map(plan => <Link className="card provider-plan-card" key={plan.plan_id} to={`/provider/care-plans/${plan.plan_id}`}><div><span className={`status-badge status-${plan.status}`}>{plan.status}</span><h3>{plan.title ?? 'Untitled draft'}</h3></div><p>{plan.patient_name}</p><dl><div><dt>Version</dt><dd>{plan.version_no ?? 'Draft'}</dd></div><div><dt>Start</dt><dd>{new Date(plan.starts_at).toLocaleDateString()}</dd></div><div><dt>Target</dt><dd>{plan.target_end_at ? new Date(plan.target_end_at).toLocaleDateString() : 'Not set'}</dd></div></dl><small>Updated {new Date(plan.updated_at).toLocaleString()}</small></Link>)}</div></section>
    })}
  </section>
}

export function ProviderCarePlanDetailPage() {
  const providerIdentity = useAuth().provider?.id
  const { planId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState(location.state?.mutationError ?? '')
  const [working, setWorking] = useState(false)
  const [reason, setReason] = useState('')
  const [versionForm, setVersionForm] = useState(false)
  const [draftMeta, setDraftMeta] = useState({ title: '', summary: '', instructions: '', changeReason: '' })
  const reload = useCallback(async (options = {}) => {
    setState('loading')
    if (!options.preserveError) setError('')
    try { const result = await carePlanService.getProviderPlan(planId); if (!result) throw new Error('not found'); setData(result); setState('ready') }
    catch (caught) { setError(errorText(caught)); setState('error') }
  }, [planId, providerIdentity])
  useEffect(() => { void reload({ preserveError: Boolean(location.state?.mutationError) }) }, [reload, location.state?.mutationError])
  if (state === 'loading') return <p role="status">Loading Care Plan…</p>
  if (state === 'error') return <section><h1>Care Plan unavailable</h1><p role="alert">{error}</p><Link to="/provider/care-plans">Back to Care Plans</Link></section>
  const plan = data.plan
  const draftVersion = data.versions?.find(version => version.status === 'draft')
  const current = data.versions?.find(version => version.id === plan.current_version_id)
  const displayedVersion = draftVersion ?? current
  const editable = ['draft', 'active', 'paused'].includes(plan.status)
  const mutate = async (action, intent, actionReason) => {
    setWorking(true); setError('')
    try { await action(plan.id, intent, actionReason); await reload() }
    catch (caught) { const message = errorText(caught); await reload(); setError(message) }
    finally { setWorking(false) }
  }
  const beginVersion = async event => {
    event.preventDefault(); setWorking(true); setError('')
    try { await carePlanService.createVersion({ planId: plan.id, ...draftMeta }); await reload(); setVersionForm(false) }
    catch (caught) { setError(errorText(caught)) }
    finally { setWorking(false) }
  }
  const transitions = plan.status === 'draft' ? ['activate', 'cancel'] : plan.status === 'active' ? ['pause', 'complete', 'discontinue'] : plan.status === 'paused' ? ['resume', 'complete', 'discontinue'] : []
  return <section className="provider-plan-detail">
    <Link to="/provider/care-plans">← Care Plans</Link>{location.state?.activated && <div className="success-message" role="status">Care Plan activated. It is available through the patient’s existing My Care Plan view.</div>}<div className="provider-page-heading"><div><span className={`status-badge status-${plan.status}`}>{plan.status}</span><h1>{displayedVersion?.title ?? 'Care Plan'}</h1><p>{data.patient?.full_name ?? 'Authorized patient'}</p></div></div>
    {error && <div className="error-message" role="alert">{error}</div>}
    <article className="card"><h2>Plan information</h2><p>{displayedVersion?.summary}</p><p>{displayedVersion?.instructions}</p><dl className="provider-plan-facts"><div><dt>Starts</dt><dd>{new Date(plan.starts_at).toLocaleString()} ({plan.timezone})</dd></div><div><dt>Target end</dt><dd>{plan.target_end_at ? new Date(plan.target_end_at).toLocaleDateString() : 'Not set'}</dd></div><div><dt>Current version</dt><dd>{current ? `Version ${current.version_no}` : 'Not published'}{draftVersion ? ` · Draft version ${draftVersion.version_no} is being authored` : ''}</dd></div></dl></article>
    {!!data.goals?.length && <article className="card"><h2>Goals</h2><ol>{data.goals.filter(goal => goal.version_id === displayedVersion?.id).map(goal => <li key={goal.id}><strong>{goal.title}</strong>{goal.description && <p>{goal.description}</p>}{goal.target_text && <p>Target: {goal.target_text}</p>}</li>)}</ol></article>}
    {!!data.tasks?.length && <article className="card"><h2>Tasks</h2><ul>{data.tasks.filter(task => task.version_id === displayedVersion?.id).map(task => <li key={task.id}><strong>{task.title}</strong><span> · {task.task_type} · {task.recurrence}</span>{task.instructions && <p>{task.instructions}</p>}</li>)}</ul></article>}
    {editable && <div className="provider-actions card"><h2>Care Plan actions</h2>{plan.status !== 'draft' && <button className="button button--secondary" type="button" onClick={() => { setDraftMeta({ title: current?.title ?? '', summary: current?.summary ?? '', instructions: current?.instructions ?? '', changeReason: '' }); setVersionForm(true) }}>Create New Version</button>}
      {versionForm && <form className="provider-inline-form" onSubmit={beginVersion}><label>Version title<input className="form-control" required value={draftMeta.title} onChange={e => setDraftMeta({ ...draftMeta, title: e.target.value })}/></label><label>Summary<textarea className="form-control" value={draftMeta.summary} onChange={e => setDraftMeta({ ...draftMeta, summary: e.target.value })}/></label><label>Instructions<textarea className="form-control" value={draftMeta.instructions} onChange={e => setDraftMeta({ ...draftMeta, instructions: e.target.value })}/></label><label>Change reason<input className="form-control" required value={draftMeta.changeReason} onChange={e => setDraftMeta({ ...draftMeta, changeReason: e.target.value })}/></label><button className="button button--primary" disabled={working}>Start Draft Version</button></form>}
      {editable && draftVersion && <Link className="button button--secondary" to={`/provider/care-plans/${plan.id}/edit`}>Continue Draft Version</Link>}
      <label>Reason (optional)<input className="form-control" value={reason} onChange={e => setReason(e.target.value)}/></label>
      <div className="provider-lifecycle-actions">{transitions.map(intent => <button key={intent} className="button button--secondary" disabled={working} type="button" onClick={() => { if (intent === 'activate') navigate(`/provider/care-plans/${plan.id}/activate`); else void mutate(carePlanService.transition, intent, reason) }}>{intent[0].toUpperCase() + intent.slice(1)}</button>)}</div>
      {draftVersion && <Link className="button button--secondary" to={`/provider/care-plans/${plan.id}/edit`}>Review Draft Version</Link>}
      {plan.status === 'draft' && <button className="button button--primary" type="button" disabled={working || (!draftVersion && !current)} onClick={() => navigate(`/provider/care-plans/${plan.id}/activate`)}>Review and Activate</button>}
    </div>}
    {data.versions?.length > 1 && <article className="card"><h2>Version history</h2><ol>{data.versions.map(version => <li key={version.id}>Version {version.version_no}: {version.title} ({version.status}){version.change_reason ? ` — ${version.change_reason}` : ''}</li>)}</ol></article>}
  </section>
}

export function ProviderCarePlanWizardPage() {
  const providerIdentity = useAuth().provider?.id
  const navigate = useNavigate()
  const location = useLocation()
  const { planId } = useParams()
  const [step, setStep] = useState(0)
  const [patients, setPatients] = useState([])
  const [patientId, setPatientId] = useState('')
  const [details, setDetails] = useState({ title: '', summary: '', instructions: '', startsAt: `${localDate()}T09:00`, targetEndAt: '', timezone: 'Asia/Yangon' })
  const [goals, setGoals] = useState([])
  const [goalDraft, setGoalDraft] = useState({ title: '', description: '', target: '' })
  const [tasks, setTasks] = useState([])
  const [taskDraft, setTaskDraft] = useState({ type: 'instruction', title: '', instructions: '', recurrence: 'one_time', startsOn: localDate(), endsOn: '', weekdays: [], times: '09:00', vitalType: 'blood_pressure', manualAcknowledgement: true, required: true, medicationId: '', medicationScheduleId: '', appointmentId: '', followUpId: '' })
  const [sources, setSources] = useState({ medication: [], appointment: [], follow_up: [] })
  const [sourceOwners, setSourceOwners] = useState({})
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [existingPlan, setExistingPlan] = useState(null)
  const [activationOnly, setActivationOnly] = useState(false)
  const [savedGoalIds, setSavedGoalIds] = useState({})
  useEffect(() => {
    let alive = true
    setPatients([]); setPatientId(''); setDetails({ title: '', summary: '', instructions: '', startsAt: `${localDate()}T09:00`, targetEndAt: '', timezone: 'Asia/Yangon' }); setGoals([]); setGoalDraft({ title: '', description: '', target: '' }); setTasks([]); setTaskDraft({ type: 'instruction', title: '', instructions: '', recurrence: 'one_time', startsOn: localDate(), endsOn: '', weekdays: [], times: '09:00', vitalType: 'blood_pressure', manualAcknowledgement: true, required: true, medicationId: '', medicationScheduleId: '', appointmentId: '', followUpId: '' }); setSources({ medication: [], appointment: [], follow_up: [] }); setSourceOwners({}); setSavedGoalIds({}); setExistingPlan(null); setActivationOnly(false); setConfirmed(false); setStep(0); setStatus('loading'); setError('')
    Promise.all([providerWorkspaceService.listPatients(), planId ? carePlanService.getProviderPlan(planId) : Promise.resolve(null)])
      .then(([rows, planData]) => {
        if (!alive) return
        setPatients(rows)
        if (planId) {
          if (!planData) throw new Error('Plan unavailable')
          const editableVersion = planData.versions?.find(version => version.status === 'draft')
          const currentVersion = planData.versions?.find(version => version.id === planData.plan.current_version_id)
          const canRetryActivation = location.pathname.endsWith('/activate') && planData.plan.status === 'draft' && !editableVersion && currentVersion
          if (!editableVersion && !canRetryActivation) throw new Error('No editable draft version exists.')
          if (planData.plan.status === 'completed' || planData.plan.status === 'discontinued' || planData.plan.status === 'cancelled') throw new Error('This plan is terminal and cannot accept a new version.')
          setActivationOnly(Boolean(canRetryActivation))
          setExistingPlan(planData)
          setStep(location.pathname.endsWith('/activate') ? 4 : 2)
          setPatientId(planData.plan.patient_id)
          const versionToShow = editableVersion ?? currentVersion
          setDetails({ title: versionToShow.title, summary: versionToShow.summary ?? '', instructions: versionToShow.instructions ?? '', startsAt: new Date(planData.plan.starts_at).toISOString().slice(0,16), targetEndAt: planData.plan.target_end_at?.slice(0,10) ?? '', timezone: planData.plan.timezone })
          setGoals((planData.goals ?? []).filter(goal => goal.version_id === versionToShow.id).map(goal => ({ key: goal.id, title: goal.title, description: goal.description ?? '', target: goal.target_text ?? '', saved: true })))
          setTasks((planData.tasks ?? []).filter(task => task.version_id === versionToShow.id).map(task => ({ ...task, key: task.id, type: task.task_type, recurrence: task.recurrence, startsOn: task.starts_on, endsOn: task.ends_on ?? '', weekdays: task.weekdays ?? [], localTimes: task.local_times ?? ['09:00'], times: (task.local_times ?? ['09:00']).join(', '), vitalType: task.vital_type, manualAcknowledgement: task.manual_acknowledgement, medicationId: task.medication_id, medicationScheduleId: task.medication_schedule_id, appointmentId: task.appointment_id, followUpId: task.follow_up_id, saved: true })))
        }
        setStatus('ready')
      }).catch(caught => { if (alive) { setStatus('error'); setError(errorText(caught)) } })
    return () => { alive = false }
  }, [planId, location.pathname, providerIdentity])
  const selected = patients.find(patient => patient.id === patientId)
  const sourceType = taskDraft.type === 'medication' ? 'medication' : taskDraft.type
  useEffect(() => {
    if (!selected || !['medication', 'appointment', 'follow_up'].includes(sourceType)) return
    let alive = true
    const ownerId = selected.id
    setSourceOwners(current => ({ ...current, [sourceType]: ownerId }))
    setSources(current => ({ ...current, [sourceType]: [] }))
    setTaskDraft(current => ({ ...current, medicationId: '', medicationScheduleId: '', appointmentId: '', followUpId: '' }))
    setError('')
    carePlanService.listProviderSources(ownerId, sourceType).then(data => { if (alive) setSources(current => ({ ...current, [sourceType]: Array.isArray(data) ? data : [] })) }).catch(() => { if (alive) setError('Unable to load same-patient source records. Check current access and retry.') })
    return () => { alive = false }
  }, [selected?.id, sourceType])
  const visibleSources = sourceOwners[sourceType] === selected?.id ? sources[sourceType] ?? [] : []
  const schedule = useMemo(() => (sourceOwners.medication === selected?.id ? sources.medication : []).find(item => item.schedule_id === taskDraft.medicationScheduleId), [sources.medication, sourceOwners.medication, selected?.id, taskDraft.medicationScheduleId])

  function addGoal(event) { event.preventDefault(); if (!goalDraft.title.trim()) return; setGoals(current => [...current, { ...goalDraft, key: crypto.randomUUID() }]); setGoalDraft({ title: '', description: '', target: '' }) }
  function addTask(event) {
    event.preventDefault()
    const task = { ...taskDraft, weekdays: taskDraft.weekdays, localTimes: times(taskDraft.times), timezone: schedule?.timezone || details.timezone }
    if (!task.title.trim()) return
    if (task.type === 'medication' && (!task.medicationId || !task.medicationScheduleId)) { setError('Select an existing medication and schedule.'); return }
    if (task.type === 'appointment' && !task.appointmentId) { setError('Select an existing appointment.'); return }
    if (task.type === 'follow_up' && !task.followUpId) { setError('Select an existing follow-up.'); return }
    if (!['activity', 'instruction', 'custom'].includes(task.type)) task.manualAcknowledgement = false
    if (task.recurrence === 'source_schedule' && task.type !== 'medication') { setError('Medication source schedule recurrence is only valid for medication tasks.'); return }
    if (['appointment', 'follow_up'].includes(task.type)) task.recurrence = 'one_time'
    if (task.recurrence === 'selected_weekdays' && !task.weekdays.length) { setError('Choose at least one weekday.'); return }
    if (task.endsOn && task.endsOn < task.startsOn) { setError('Task end date must be on or after its start date.'); return }
    if (task.recurrence === 'multiple_daily_slots' && (task.localTimes.length < 2 || task.localTimes.length > 8 || task.localTimes.some(value => !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)))) { setError('Enter 2–8 valid local times in 24-hour HH:MM format.'); return }
    if (task.recurrence !== 'multiple_daily_slots' && task.localTimes.some(value => !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) { setError('Enter a valid local time in 24-hour HH:MM format.'); return }
    setTasks(current => [...current, { ...task, key: crypto.randomUUID(), goalIndex: taskDraft.goalIndex ?? '', saved: false }])
    setError(''); setTaskDraft(current => ({ ...current, title: '', instructions: '', medicationId: '', medicationScheduleId: '', appointmentId: '', followUpId: '' }))
  }

  async function saveAndActivate() {
    if (!confirmed) { setError('Confirm activation to continue.'); return }
    if (activationOnly && planId && existingPlan) {
      setWorking(true); setError('')
      try {
        await carePlanService.transition(planId, 'activate')
        navigate(`/provider/care-plans/${planId}`, { replace: true, state: { activated: true } })
      } catch (caught) { setError(errorText(caught)) }
      finally { setWorking(false) }
      return
    }
    if (!selected || !details.title.trim() || goals.length === 0 || tasks.length === 0) { setError('A patient, plan title, at least one goal, and at least one task are required.'); return }
    setWorking(true); setError('')
    let targetPlanId = planId
    try {
      if (!targetPlanId) targetPlanId = await carePlanService.createDraft({ patientId: selected.id, title: details.title.trim(), summary: details.summary, instructions: details.instructions, timezone: details.timezone, startsAt: localDateTimeToIso(details.startsAt, details.timezone), targetEndAt: details.targetEndAt ? localDateTimeToIso(`${details.targetEndAt}T23:59`, details.timezone) : null })
      const goalIds = { ...savedGoalIds }
      for (let index = 0; index < goals.length; index += 1) if (!goals[index].saved) {
        goalIds[goals[index].key] = await carePlanService.addGoal({ planId: targetPlanId, title: goals[index].title.trim(), description: goals[index].description || null, target: goals[index].target || null, sortOrder: index })
        setGoals(current => current.map((goal, goalIndex) => goalIndex === index ? { ...goal, saved: true } : goal))
      }
      setSavedGoalIds(goalIds)
      for (const task of tasks) if (!task.saved) {
        await carePlanService.addTask({ planId: targetPlanId, type: task.type, title: task.title.trim(), instructions: task.instructions || null, required: task.required, manualAcknowledgement: task.manualAcknowledgement, recurrence: task.recurrence, startsOn: task.startsOn, endsOn: task.endsOn || null, weekdays: task.recurrence === 'selected_weekdays' ? task.weekdays : null, localTimes: task.recurrence === 'source_schedule' ? ['09:00'] : task.localTimes, timezone: task.timezone, vitalType: task.type === 'vital_check' ? task.vitalType : null, medicationId: task.type === 'medication' ? task.medicationId : null, medicationScheduleId: task.type === 'medication' ? task.medicationScheduleId : null, appointmentId: task.type === 'appointment' ? task.appointmentId : null, followUpId: task.type === 'follow_up' ? task.followUpId : null, goalId: task.goalKey ? goalIds[task.goalKey] : null })
        setTasks(current => current.map(item => item.key === task.key ? { ...item, saved: true } : item))
      }
      if (planId) {
        await carePlanService.approveProviderVersion(targetPlanId)
        if (existingPlan.plan.status === 'draft') await carePlanService.transition(targetPlanId, 'activate')
      } else {
        await carePlanService.approveVersion(targetPlanId)
        await carePlanService.transition(targetPlanId, 'activate')
      }
      navigate(`/provider/care-plans/${targetPlanId}`, { replace: true, state: { activated: !planId } })
    } catch (caught) {
      const message = errorText(caught)
      if (targetPlanId && !planId) navigate(`/provider/care-plans/${targetPlanId}`, { replace: true, state: { mutationError: `${message} A draft may have been partially saved; review it before continuing.` } })
      else setError(message)
    } finally { setWorking(false) }
  }

  if (!useDoctor()) return <section><h1>Care Plan authoring unavailable</h1><p>Only eligible doctors can author Clinical Care Plans.</p></section>
  if (status === 'loading') return <p role="status">Loading authorized patients…</p>
  if (status === 'error') return <div className="error-message" role="alert">{error}</div>
  if (step === 5) return <section className="provider-care-wizard"><Link to="/provider/care-plans">← Care Plans</Link><h1>Confirm {planId && existingPlan?.plan.status !== 'draft' ? 'version publication' : 'activation'}</h1><article className="card"><h2>{details.title}</h2><p>Patient: {selected?.displayName}</p><p>Starting {details.startsAt.replace('T', ' ')} ({details.timezone})</p><p>{activationOnly ? 'The version is already published. This action retries activation of the draft plan.' : planId && existingPlan?.plan.status !== 'draft' ? 'Publishing preserves the previous version. The existing plan remains in its current lifecycle state.' : 'Activating publishes this version and begins bounded occurrence generation.'}</p><label className="provider-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> I reviewed this plan and confirm {planId && existingPlan?.plan.status !== 'draft' ? 'publishing this version' : 'activating it'}.</label></article>{error && <div role="alert" className="error-message">{error}</div>}<button className="button button--primary" type="button" disabled={!confirmed || working} onClick={() => void saveAndActivate()}>{working ? 'Saving…' : planId && existingPlan?.plan.status !== 'draft' ? 'Confirm and Publish Version' : 'Confirm and Activate'}</button></section>

  return <section className="provider-care-wizard"><Link to="/provider/care-plans">← Care Plans</Link><div className="provider-page-heading"><div><span className="eyebrow">Clinician-authored</span><h1>Create Clinical Care Plan</h1></div></div><ol className="provider-wizard-steps">{STEPS.slice(0, 5).map((label, index) => <li className={index === step ? 'current' : index < step ? 'done' : ''} key={label}>{index + 1}. {label}</li>)}</ol>
    {error && <div role="alert" className="error-message">{error}<button type="button" onClick={() => setError('')}>Dismiss</button></div>}
    {step === 0 && <article className="card"><h2>Choose a patient</h2><p>Only patients with an existing clinical relationship are listed.</p>{patients.length ? <div className="provider-patient-list">{patients.map(patient => <button type="button" className={`card provider-patient-card ${patientId === patient.id ? 'selected' : ''}`} key={patient.id} onClick={() => setPatientId(patient.id)} aria-pressed={patientId === patient.id}><strong>{patient.displayName}</strong><small>{patient.relationshipContext === 'appointment' ? 'Appointment relationship' : 'Care assignment'}</small></button>)}</div> : <p>No current patients are available to this account.</p>}</article>}
    {step === 1 && <article className="card provider-form-grid"><h2>Plan details</h2>{planId && <p>This version’s details were set when the draft version was created. The available RPCs allow goal and task additions but do not allow editing saved draft metadata.</p>}<label>Plan title<input className="form-control" readOnly={Boolean(planId)} maxLength="160" value={details.title} onChange={e => setDetails({ ...details, title: e.target.value })}/></label><label>Summary<textarea className="form-control" readOnly={Boolean(planId)} value={details.summary} onChange={e => setDetails({ ...details, summary: e.target.value })}/></label><label>Plan instructions<textarea className="form-control" readOnly={Boolean(planId)} value={details.instructions} onChange={e => setDetails({ ...details, instructions: e.target.value })}/></label><label>Start date and time<input className="form-control" readOnly={Boolean(planId)} type="datetime-local" value={details.startsAt} onChange={e => setDetails({ ...details, startsAt: e.target.value })}/></label><label>Target end date (optional)<input className="form-control" readOnly={Boolean(planId)} type="date" value={details.targetEndAt} onChange={e => setDetails({ ...details, targetEndAt: e.target.value })}/></label><label>Timezone<select className="form-control" disabled={Boolean(planId)} value={details.timezone} onChange={e => setDetails({ ...details, timezone: e.target.value })}><option>Asia/Yangon</option><option>UTC</option></select></label></article>}
    {step === 2 && <article className="card"><h2>Author goals</h2><form className="provider-inline-form" onSubmit={addGoal}><label>Goal title<input className="form-control" required value={goalDraft.title} onChange={e => setGoalDraft({ ...goalDraft, title: e.target.value })}/></label><label>Description<textarea className="form-control" value={goalDraft.description} onChange={e => setGoalDraft({ ...goalDraft, description: e.target.value })}/></label><label>Target text (optional)<input className="form-control" value={goalDraft.target} onChange={e => setGoalDraft({ ...goalDraft, target: e.target.value })}/></label><button className="button button--secondary">Add goal</button></form><ul>{goals.map((goal, index) => <li key={goal.key}>{index + 1}. {goal.title} {!goal.saved && <button type="button" onClick={() => setGoals(goals.filter(item => item.key !== goal.key))}>Remove</button>}{goal.saved && <small> Saved in this draft</small>}</li>)}</ul></article>}
    {step === 3 && <article className="card"><h2>Author tasks</h2><form className="provider-form-grid" onSubmit={addTask}>
      <label>Task type<select className="form-control" value={taskDraft.type} onChange={e => setTaskDraft({ ...taskDraft, type: e.target.value, manualAcknowledgement: ['activity','instruction','custom'].includes(e.target.value) })}>{TASK_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Task title<input className="form-control" required value={taskDraft.title} onChange={e => setTaskDraft({ ...taskDraft, title: e.target.value })}/></label><label>Instructions<textarea className="form-control" value={taskDraft.instructions} onChange={e => setTaskDraft({ ...taskDraft, instructions: e.target.value })}/></label>
      {taskDraft.type === 'medication' && <><label>Existing medication and schedule<select className="form-control" value={taskDraft.medicationScheduleId} onChange={e => { const item = visibleSources.find(row => row.schedule_id === e.target.value); setTaskDraft({ ...taskDraft, medicationScheduleId: e.target.value, medicationId: item?.medication_id ?? '' }) }}><option value="">Select medication schedule</option>{visibleSources.map(item => <option key={item.schedule_id} value={item.schedule_id}>{item.name}{item.dose ? ` · ${item.dose}` : ''} · {item.time_of_day} {item.timezone}</option>)}</select></label><label>Recurrence<select className="form-control" value={taskDraft.recurrence} onChange={e => setTaskDraft({ ...taskDraft, recurrence: e.target.value })}>{RECURRENCES.filter(value => value !== 'source_schedule' || taskDraft.type === 'medication').map(value => <option key={value}>{value}</option>)}</select></label></>}
      {taskDraft.type === 'vital_check' && <label>Vital type<select className="form-control" value={taskDraft.vitalType} onChange={e => setTaskDraft({ ...taskDraft, vitalType: e.target.value })}>{VITAL_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>}
      {taskDraft.type === 'appointment' && <><label>Existing appointment<select className="form-control" value={taskDraft.appointmentId} onChange={e => setTaskDraft({ ...taskDraft, appointmentId: e.target.value })}><option value="">Select appointment</option>{visibleSources.map(item => <option key={item.id} value={item.id}>{item.appointment_type} · {new Date(item.scheduled_start).toLocaleString()} · {item.status}</option>)}</select></label><p>Appointment tasks occur at the appointment time.</p></>}
      {taskDraft.type === 'follow_up' && <><label>Existing follow-up<select className="form-control" value={taskDraft.followUpId} onChange={e => setTaskDraft({ ...taskDraft, followUpId: e.target.value })}><option value="">Select follow-up</option>{visibleSources.map(item => <option key={item.id} value={item.id}>{item.follow_up_type} · {new Date(item.due_at).toLocaleString()}</option>)}</select></label><p>Follow-up tasks occur at the recorded due time.</p></>}
      {!['appointment','follow_up'].includes(taskDraft.type) && taskDraft.recurrence !== 'source_schedule' && <>{taskDraft.type !== 'medication' && <label>Recurrence<select className="form-control" value={taskDraft.recurrence} onChange={e => setTaskDraft({ ...taskDraft, recurrence: e.target.value })}>{RECURRENCES.filter(value => value !== 'source_schedule').map(value => <option key={value}>{value}</option>)}</select></label>}<label>Start date<input type="date" className="form-control" value={taskDraft.startsOn} onChange={e => setTaskDraft({ ...taskDraft, startsOn: e.target.value })}/></label><label>End date (optional)<input type="date" className="form-control" value={taskDraft.endsOn} onChange={e => setTaskDraft({ ...taskDraft, endsOn: e.target.value })}/></label>{taskDraft.recurrence === 'selected_weekdays' && <fieldset><legend>Weekdays</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index) => <label key={day}><input type="checkbox" checked={taskDraft.weekdays.includes(index)} onChange={e => setTaskDraft({ ...taskDraft, weekdays: e.target.checked ? [...taskDraft.weekdays,index] : taskDraft.weekdays.filter(item => item !== index) })}/>{day}</label>)}</fieldset>}{taskDraft.recurrence === 'multiple_daily_slots' && <label>Local times (comma separated, max 8)<input className="form-control" value={taskDraft.times} onChange={e => setTaskDraft({ ...taskDraft, times: e.target.value })}/></label>}</>}
      {['activity','instruction','custom'].includes(taskDraft.type) && <label><input type="checkbox" checked={taskDraft.manualAcknowledgement} onChange={e => setTaskDraft({ ...taskDraft, manualAcknowledgement: e.target.checked })}/> Allow manual acknowledgement</label>}
      <label><input type="checkbox" checked={taskDraft.required} onChange={e => setTaskDraft({ ...taskDraft, required: e.target.checked })}/> Required task</label><button className="button button--secondary">Add task</button></form>
      <ul className="provider-authored-list">{tasks.map(task => <li key={task.key}><strong>{task.title}</strong><span> · {task.type} · {task.recurrence}</span>{!task.saved ? <button type="button" onClick={() => setTasks(tasks.filter(item => item.key !== task.key))}>Remove</button> : <small> Saved in this draft</small>}</li>)}</ul><p>Occurrence generation is bounded to the existing 30-day horizon.</p></article>}
    {step === 4 && <div className="provider-review"><h2>Review Care Plan</h2><article className="card"><h3>Patient</h3><p>{selected?.displayName}</p><h3>Plan</h3><p>{details.title}</p><p>{details.summary}</p><p>{details.instructions}</p><p>{details.startsAt.replace('T',' ')} ({details.timezone}) · Target {details.targetEndAt || 'not set'}</p><h3>Goals</h3><ol>{goals.map(goal => <li key={goal.key}><strong>{goal.title}</strong> {goal.description} {goal.target}</li>)}</ol><h3>Tasks and schedules</h3><ul>{tasks.map(task => <li key={task.key}><strong>{task.title}</strong> · {task.type} · {task.recurrence}{task.type === 'medication' && ` · ${(sourceOwners.medication === selected?.id ? sources.medication : []).find(item => item.schedule_id === task.medicationScheduleId)?.name ?? 'Medication source'}`}<p>{task.instructions}</p><small>{task.localTimes?.join(', ')} · {task.timezone}</small></li>)}</ul></article><p>Activation publishes this version and starts validated, bounded occurrence generation. No patient notification is sent by this workflow.</p></div>}
    <div className="provider-wizard-actions"><button className="button button--secondary" type="button" disabled={step===0} onClick={() => setStep(value => Math.max(0,value-1))}>Back</button>{step < 4 && <button className="button button--primary" type="button" disabled={step===0 && !patientId} onClick={() => { if (step===1 && (!details.title.trim() || !details.startsAt)) { setError('Enter a plan title and start date.'); return } if (step===1 && details.targetEndAt && details.targetEndAt < details.startsAt.slice(0,10)) { setError('Target end date must be on or after the plan start date.'); return } if (step===2 && !goals.length) { setError('Add at least one goal.'); return } if (step===3 && !tasks.length) { setError('Add at least one task.'); return } setError(''); setStep(value => value+1) }}>Continue</button>}{step===4 && <button className="button button--primary" type="button" onClick={() => { setConfirmed(false); setStep(5) }}>Continue to Activation</button>}</div>
  </section>
}
