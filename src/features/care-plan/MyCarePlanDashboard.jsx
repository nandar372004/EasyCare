import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Activity, CalendarDays, ChevronRight, Pill, Salad, Target, Trash2 } from 'lucide-react'
import { getDashboardAppointmentProvider, getUpcomingAppointments, recordMedicationEventStatus, recordPatientMedicationCheckIn } from '../../services/patientDashboardService.js'

import { buildCarePlanMedicationRows, medicationDoseTime, medicationCheckinOccurrences } from '../../services/carePlanMedicationService.js'
import { useCarePlanMedications } from './useCarePlanMedications.js'

import { patientHealthGoalService, sortPatientHealthGoals } from '../../services/patientHealthGoalService.js'
import { patientMonitoringService } from '../../services/patientMonitoringService.js'
import { patientLifestylePlanService } from '../../services/patientLifestylePlanService.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { PatientMonitoringPlan } from './PatientMonitoringPlan.jsx'
import { PatientLifestylePlans } from './PatientLifestylePlans.jsx'
import './medicationCheckins.css'
import './patientHealthGoals.css'
import './patientMonitoringPlan.css'
import './myCarePlanNoUnderlines.css'

const dateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(/^\d{4}-\d\d-\d\d$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)) : null
const timeLabel = value => value ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Yangon' }).format(new Date(value)) : null
const patientLocalDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = name => parts.find(item => item.type === name)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
async function loadAppointments(patientId) {
  const rows = await getUpcomingAppointments(patientId)
  return Promise.all(rows.map(async row => ({ ...row, provider: row.providerId ? await getDashboardAppointmentProvider(row.providerId).catch(() => null) : null })))
}
async function loadPatientHealthGoals() { return patientHealthGoalService.listMyGoals() }
async function loadMonitoring() {
  const [plans, checkIns] = await Promise.all([patientMonitoringService.listMyPlans(), patientMonitoringService.listMyCheckIns()])
  return { plans, checkIns }
}
async function loadLifestylePlans() { return patientLifestylePlanService.listMyPlans() }
function useCardData(patientId, key, loader) {
  const [state, setState] = useState({ status: 'loading', data: null })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setState({ status: patientId ? 'loading' : 'error', data: null })
    if (patientId) Promise.resolve().then(() => loader(patientId)).then(data => { if (active) setState({ status: 'ready', data }) }).catch(() => { if (active) setState({ status: 'error', data: null }) })
    return () => { active = false }
  }, [patientId, key, retry])
  return { ...state, retry: () => setRetry(value => value + 1), updateData: updater => setState(current => ({ ...current, data: updater(current.data) })) }
}
function Card({ title, icon: Icon, category, state, children, action, errorMessage = "Couldn't load this information." }) {
  return <section className={`card care-dashboard-card care-dashboard-card--${category}`} aria-labelledby={`care-${title.toLowerCase().replaceAll(' ', '-')}`}>
    <header className="care-dashboard-card-heading"><span className="care-dashboard-icon"><Icon aria-hidden="true" /></span><div><h2 id={`care-${title.toLowerCase().replaceAll(' ', '-')}`}>{title}</h2></div>{action}</header>
    {state?.status === 'loading' ? <div className="care-dashboard-skeleton" role="status" aria-label={`Loading ${title}`}><span /><span /></div> : state?.status === 'error' ? <div className="care-dashboard-error" role="alert"><span>{errorMessage}</span><button type="button" onClick={state.retry}>Retry</button></div> : children}
  </section>
}
function PatientHealthGoals({ goals, onCreate, onCompletionChange, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const addButtonRef = useRef(null)
  const restoreAddFocus = useRef(false)

  useEffect(() => {
    if (!adding && restoreAddFocus.current) {
      restoreAddFocus.current = false
      addButtonRef.current?.focus()
    }
  }, [adding])
  const cancel = () => { restoreAddFocus.current = true; setAdding(false); setDraft(''); setError('') }
  const submit = async event => {
    event.preventDefault()
    if (!draft.trim()) { setError('Enter a goal.'); inputRef.current?.focus(); return }
    setSaving(true); setError('')
    try { await onCreate(draft.trim()); cancel() }
    catch { setError('Could not save this goal. Try again.') }
    finally { setSaving(false) }
  }
  const changeCompletion = async (goal, isCompleted) => {
    setBusyId(goal.id); setError('')
    try { await onCompletionChange(goal, isCompleted) }
    catch { setError('Could not update this goal. Try again.') }
    finally { setBusyId('') }
  }
  const deleteGoal = async goal => {
    setBusyId(goal.id); setError('')
    try { await onDelete(goal) }
    catch { setError('Could not delete this goal. Try again.') }
    finally { setBusyId('') }
  }

  return <div className="patient-health-goals">
    {goals.length ? <div className="patient-health-goal-list" aria-label="Your health goals">
      {goals.map(goal => <div className={`patient-health-goal${goal.isCompleted ? ' is-completed' : ''}`} key={goal.id}>
        <label className="patient-health-goal-check">
          <input type="checkbox" checked={Boolean(goal.isCompleted)} disabled={busyId === goal.id} onChange={event => void changeCompletion(goal, event.target.checked)} />
          <span>{goal.title}</span>
        </label>
        <button type="button" className="patient-health-goal-delete" aria-label={`Delete goal: ${goal.title}`} disabled={busyId === goal.id} onClick={() => void deleteGoal(goal)}><Trash2 aria-hidden="true" /></button>
      </div>)}
    </div> : !adding && <p className="patient-health-goal-empty">No health goals yet.</p>}
    {adding ? <form className="patient-health-goal-add-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="new-patient-health-goal">New health goal</label>
      <input ref={inputRef} id="new-patient-health-goal" type="text" value={draft} maxLength={200} autoFocus placeholder="Write a health goal" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }} />
      <button type="submit" className="patient-health-goal-save" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" className="patient-health-goal-cancel" onClick={cancel}>Cancel</button>
    </form> : <button ref={addButtonRef} type="button" className="patient-health-goal-add" onClick={() => { setAdding(true); setError('') }}>{goals.length ? '+ Add goal' : '+ Add your first goal'}</button>}
    {error && <p className="patient-health-goal-error" role="alert">{error}</p>}
  </div>
}
const activateOnSpace = event => { if (event.key === ' ') { event.preventDefault(); event.currentTarget.click() } }
function AppointmentRow({ appointment }) {
  const date = appointment.scheduledStart ? new Date(appointment.scheduledStart) : null
  const month = date && !Number.isNaN(+date) ? new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'Asia/Yangon' }).format(date).toUpperCase() : '—'
  const day = date && !Number.isNaN(+date) ? new Intl.DateTimeFormat('en', { day: '2-digit', timeZone: 'Asia/Yangon' }).format(date) : '—'
  return <Link className="care-dashboard-appointment" to={`/appointments/${appointment.id}`} onKeyDown={activateOnSpace}>
    <span className="care-dashboard-date"><small>{month}</small><strong>{day}</strong></span>
    <span className="care-dashboard-appointment-copy"><strong>{appointment.provider?.displayName || 'Provider not listed'}</strong><small>{appointment.provider?.specialty || appointment.appointmentType || 'Specialty not recorded'}</small><small>{appointment.consultationChannel || 'Mode not recorded'}{timeLabel(appointment.scheduledStart) ? ` · ${timeLabel(appointment.scheduledStart)}` : ''}</small><span className={`care-dashboard-status care-dashboard-status--${appointment.status}`}>{appointment.status}</span></span>
    <ChevronRight aria-hidden="true" />
  </Link>
}
function MedicationDoseRow({ medication, schedule, event, status, onDone, saving, error }) {
  const timezone = schedule?.timezone || 'Asia/Yangon'
  const eventTime = medicationDoseTime({ schedule, event })
  const takenTime = event?.confirmedAt && Number.isFinite(Date.parse(event.confirmedAt))
    ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(event.confirmedAt)) : null
  const eventIsDue = event?.scheduledAt && Number.isFinite(Date.parse(event.scheduledAt)) && Date.parse(event.scheduledAt) <= Date.now()
  const canMarkTaken = event && ['pending', 'missed'].includes(event.status) && eventIsDue
  const details = [medication.frequency, medication.instructions].filter(Boolean)
  return <div className="care-dose-card">
    <Link className="care-dose-main" to="/medications" state={{ medicationId: medication.id }}>
      <span className="care-dashboard-row-icon"><Pill aria-hidden="true" /></span>
      <span className="care-dose-copy"><strong>{medication.name}{medication.dosage ? ` · ${medication.dosage}` : ''}</strong>{eventTime && <small>Time: {eventTime}</small>}{details.map((detail, index) => <small key={`${index}-${detail}`}>{detail}</small>)}</span>
      <span className={`care-dose-status care-dose-status--${status ? status.toLowerCase().replaceAll(' ', '-') : medication.status || 'active'}`}>{status ? (status === 'Taken' ? `✓ Taken${takenTime ? ` at ${takenTime}` : ''}` : status) : medication.status === 'active' ? 'Active' : medication.status || 'Status unavailable'}</span>
      <ChevronRight aria-hidden="true" />
    </Link>
    {canMarkTaken && <button className="care-dose-done" type="button" disabled={saving} onClick={() => onDone(event)}>{saving ? 'Saving…' : 'Done'}</button>}
    {error && <span className="care-dose-error" role="alert">Couldn't mark this dose as taken. Try again.</span>}
  </div>
}
function MedicationCheckinRow({ medication, today, checkIns, checkInsAvailable, savingKey, errorKey, onCheckIn }) {
  const { count, prn, entries, occurrences } = medicationCheckinOccurrences(medication, checkIns)
  const rowKey = index => `${medication.id}:${index ?? 'prn'}`
  return <div className="care-dose-card care-medication-checkin-card">
    <Link className="care-dose-main" to="/medications" state={{ medicationId: medication.id }}>
      <span className="care-dashboard-row-icon"><Pill aria-hidden="true" /></span>
      <span className="care-dose-copy"><strong>{medication.name}{medication.dosage ? ` · ${medication.dosage}` : ''}</strong>{medication.frequency && <small>{medication.frequency}</small>}{medication.instructions && <small>{medication.instructions}</small>}</span>
      <span className={`care-dose-status care-dose-status--${medication.status || 'active'}`}>{medication.status === 'active' ? 'Active' : medication.status || 'Status unavailable'}</span>
      <ChevronRight aria-hidden="true" />
    </Link>
    <div className="care-medication-checkins">
      <span className="care-medication-today">Today · {dateLabel(today)}</span>
      {!checkInsAvailable ? <span className="care-medication-checkin-unavailable">Tracking unavailable</span> : count === null && !prn ? <span className="care-medication-checkin-unavailable">No daily occurrence rule</span> : occurrences.map(({ index, completed }) => {
        const key = rowKey(index)

        return <div className="care-medication-occurrence" key={key}>
          <span>{prn ? 'As needed' : count === 1 ? 'Today' : `Dose ${index}`}</span>
          {completed && <span className="care-medication-checkin-done">{prn ? `✓ Taken today${entries.length > 1 ? ` · ${entries.length} reports` : ''}` : `✓ Done · ${dateLabel(entries.find(row => row.occurrenceIndex === index)?.localDate || today)}`}</span>}
          {(!completed || prn) && <button type="button" className="care-dose-done" disabled={savingKey === key} onClick={() => onCheckIn(medication, index)}>{savingKey === key ? 'Saving…' : prn ? 'Mark as Taken' : 'Done'}</button>}
        </div>
      })}
      {errorKey === medication.id && <span className="care-dose-error" role="alert">Couldn't save this check-in. Try again.</span>}
    </div>
  </div>
}

export function MyCarePlanDashboard() {
  const auth = useAuth()
  const location = useLocation()
  const patientId = auth.patient?.id
  useEffect(() => {
    if (location.hash !== '#care-my-medications' || !patientId) return
    const heading = document.getElementById('care-my-medications')
    if (heading) { heading.tabIndex = -1; heading.scrollIntoView?.(); heading.focus({ preventScroll: true }) }
  }, [location.hash, patientId])
  const [today, setToday] = useState(() => patientLocalDate())
  useEffect(() => {
    const timer = setInterval(() => setToday(patientLocalDate()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const medicationState = useCarePlanMedications(auth, today)
  const appointmentState = useCardData(patientId, 'appointments', loadAppointments)
  const monitoringState = useCardData(patientId, `monitoring-${today}`, loadMonitoring)
  const lifestylePlanState = useCardData(patientId, 'patient-lifestyle-plans', loadLifestylePlans)
  const healthGoalsState = useCardData(patientId, 'patient-health-goals', loadPatientHealthGoals)
  const [savingDoseId, setSavingDoseId] = useState('')
  const savingDoseRef = useRef('')
  const [doseErrorId, setDoseErrorId] = useState('')
  const [savingCheckinKey, setSavingCheckinKey] = useState('')
  const savingCheckinRef = useRef('')
  const [checkinErrorId, setCheckinErrorId] = useState('')
  if (auth.status === 'loading') return <main className="my-care-page" aria-busy="true"><h1>My Care Plan</h1><p role="status">Loading your care plan…</p></main>
  if (!patientId) return <main className="my-care-page"><h1>My Care Plan</h1><p role="alert">Sign in with a patient account to view your care information.</p></main>
  const meds = medicationState.data?.medications || []
  const checkIns = medicationState.data?.checkIns || []
  const checkInsAvailable = Boolean(medicationState.data?.checkInsAvailable)
  const markDoseTaken = async event => {
    if (!event?.id || event.status === 'taken' || savingDoseRef.current) return
    savingDoseRef.current = event.id; setSavingDoseId(event.id); setDoseErrorId('')
    try {
      const result = await recordMedicationEventStatus(event.id, 'taken')
      const updated = Array.isArray(result) ? result[0] : result
      if (updated?.status !== 'taken') throw new Error('Medication status was not confirmed.')
      medicationState.updateData(current => ({ ...current, medications: current.medications.map(medication => ({ ...medication, todaySchedules: (medication.todaySchedules || []).map(row => ({ ...row, events: row.events.map(item => item.id === event.id ? { ...item, status: 'taken', confirmedAt: updated.confirmed_at || updated.confirmedAt || null } : item) })) })) }))
    } catch { setDoseErrorId(event.id) }
    finally { savingDoseRef.current = ''; setSavingDoseId('') }
  }
  const markCheckinTaken = async (medication, occurrenceIndex) => {
    const key = `${medication.id}:${occurrenceIndex ?? 'prn'}`
    if (!medication.id || savingCheckinRef.current) return
    savingCheckinRef.current = key; setSavingCheckinKey(key); setCheckinErrorId('')
    try {
      const requestId = globalThis.crypto?.randomUUID?.()
      if (!requestId) throw new Error('Secure request identifiers are unavailable.')
      const saved = await recordPatientMedicationCheckIn({ medicationId: medication.id, occurrenceIndex, requestId })
      if (!saved?.id || saved.status !== 'taken') throw new Error('Medication check-in was not confirmed.')
      medicationState.updateData(current => ({ ...current, checkIns: [...(current.checkIns || []).filter(row => row.id !== saved.id), saved], checkInsAvailable: true }))
    } catch { setCheckinErrorId(medication.id) }
    finally { savingCheckinRef.current = ''; setSavingCheckinKey('') }
  }
  const doseRows = buildCarePlanMedicationRows(medicationState.data)
  const appointments = appointmentState.data || []
  const lifestylePlans = lifestylePlanState.data || []
  const goals = sortPatientHealthGoals(healthGoalsState.data || [])
  const addPersonalGoal = async title => {
    const goal = await patientHealthGoalService.createMyGoal(title)
    healthGoalsState.updateData(current => sortPatientHealthGoals([...(current || []), goal]))
  }
  const setPersonalGoalCompletion = async (goal, isCompleted) => {
    const updated = await patientHealthGoalService.setGoalCompletion(goal.id, isCompleted)
    healthGoalsState.updateData(current => sortPatientHealthGoals((current || []).map(item => item.id === goal.id ? updated : item)))
  }
  const removePersonalGoal = async goal => {
    await patientHealthGoalService.deleteMyGoal(goal.id)
    healthGoalsState.updateData(current => (current || []).filter(item => item.id !== goal.id))
  }
  const createLifestylePlan = async input => {
    const saved = await patientLifestylePlanService.saveMyPlan(input)
    lifestylePlanState.updateData(current => [...(current || []), { ...saved, resources: [] }])
  }
  const editLifestylePlan = async input => {
    const saved = await patientLifestylePlanService.saveMyPlan(input)
    lifestylePlanState.updateData(current => (current || []).map(plan => plan.id === saved.id ? { ...plan, ...saved } : plan))
  }
  const deactivateLifestylePlan = async plan => {
    await patientLifestylePlanService.deactivateMyPlan(plan.id)
    lifestylePlanState.updateData(current => (current || []).filter(item => item.id !== plan.id))
  }
  const saveLifestyleResource = async (plan, resource) => {
    const saved = await patientLifestylePlanService.saveMyResource(plan.id, resource)
    lifestylePlanState.updateData(current => (current || []).map(item => item.id === plan.id
      ? { ...item, resources: resource.id ? item.resources.map(row => row.id === saved.id ? saved : row) : [...item.resources, saved] }
      : item))
  }
  const deleteLifestyleResource = async (plan, resource) => {
    await patientLifestylePlanService.deleteMyResource(plan.id, resource.id)
    lifestylePlanState.updateData(current => (current || []).map(item => item.id === plan.id
      ? { ...item, resources: item.resources.filter(row => row.id !== resource.id) }
      : item))
  }
  const refreshMonitoring = async () => {
    const refreshed = await loadMonitoring()
    monitoringState.updateData(() => refreshed)
  }
  return <main className="my-care-page care-dashboard">
    <header className="my-care-header"><div><span className="eyebrow">Your health, connected</span><h1>My Care Plan</h1><p>Your health information and care guidance in one place.</p></div></header>
    <div className="care-dashboard-columns">
      <div className="care-dashboard-column care-dashboard-column--left">
      <Card title="My Health Goals" icon={Target} category="goals" state={healthGoalsState} errorMessage="Couldn't load health goals.">
        <PatientHealthGoals goals={goals} onCreate={addPersonalGoal} onCompletionChange={setPersonalGoalCompletion} onDelete={removePersonalGoal} />
      </Card>

      <Card title="My Medications" icon={Pill} category="medications" state={medicationState} errorMessage="Couldn't load medications." action={<Link className="care-dashboard-text-link" to="/medications">View All Medications</Link>}>
        {meds.length ? <><div className="care-medication-date"><span>Today</span><strong>{dateLabel(today)}</strong></div><div className="care-dose-list">{doseRows.map((row, index) => {
          if (row.schedule) return <MedicationDoseRow key={`${row.medication.id}-${row.schedule.id}-${row.event?.id || index}`} {...row} saving={savingDoseId === row.event?.id} error={doseErrorId === row.event?.id} onDone={markDoseTaken} />
          const eligibleForDailyCheckin = row.eligibleForDailyCheckin
          return eligibleForDailyCheckin
            ? <MedicationCheckinRow key={row.medication.id} medication={row.medication} today={today} checkIns={checkIns} checkInsAvailable={checkInsAvailable} savingKey={savingCheckinKey} errorKey={checkinErrorId} onCheckIn={markCheckinTaken} />
            : <MedicationDoseRow key={`${row.medication.id}-frequency-${index}`} {...row} saving={false} error={false} onDone={markDoseTaken} />
        })}</div></> : <div className="care-dashboard-empty"><p>No active medications recorded.</p><Link className="care-dashboard-text-link" to="/medications">View Medications</Link></div>}
      </Card>
      </div>
      <div className="care-dashboard-column care-dashboard-column--right">
      <Card title="My Lifestyle Plan" icon={Salad} category="lifestyle" state={lifestylePlanState} errorMessage="Couldn't load your lifestyle plans.">
        <PatientLifestylePlans plans={lifestylePlans} onCreatePlan={createLifestylePlan} onEditPlan={editLifestylePlan} onDeactivatePlan={deactivateLifestylePlan} onSaveResource={saveLifestyleResource} onDeleteResource={deleteLifestyleResource} />
      </Card>
      <Card title="My Monitoring Plan" icon={Activity} category="monitoring" state={monitoringState}>
        <PatientMonitoringPlan state={monitoringState} today={today} onRefresh={refreshMonitoring} />
      </Card>
      <Card title="My Upcoming Appointments" icon={CalendarDays} category="appointments" state={appointmentState} action={<Link className="care-dashboard-text-link" to="/appointments">View All Appointments</Link>}>
        {appointments.length ? <div className="care-dashboard-rows">{appointments.map(item => <AppointmentRow key={item.id} appointment={item} />)}</div> : <div className="care-dashboard-empty"><p>No upcoming appointments</p><Link className="care-dashboard-text-link" to="/doctors">Book Appointment</Link></div>}
      </Card>
      </div>
    </div>
  </main>
}
