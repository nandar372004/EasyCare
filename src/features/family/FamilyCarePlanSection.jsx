import { useState } from 'react'
import { Link } from 'react-router-dom'

const dateLabel = (value, timezone = 'Asia/Yangon') => {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: timezone }).format(date)
}
const localDay = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = key => parts.find(part => part.type === key)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const formatTime = (value, timezone) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: timezone || 'Asia/Yangon' }).format(date)
}
const dayNumber = plan => {
  const start = plan.starts_at ? new Date(plan.starts_at) : null
  if (!start || Number.isNaN(start.getTime())) return null
  const timezone = plan.timezone || 'Asia/Yangon'
  const day = value => localDay(value, timezone)
  const parse = value => Date.parse(`${value}T00:00:00Z`)
  const today = day(new Date())
  const first = day(start)
  const currentIndex = parse(today)
  const startIndex = parse(first)
  if (!Number.isFinite(currentIndex) || !Number.isFinite(startIndex) || currentIndex < startIndex) return null
  const number = Math.floor((currentIndex - startIndex) / 86400000) + 1
  if (!plan.target_end_at) return `Day ${number}`
  const end = new Date(plan.target_end_at)
  if (Number.isNaN(end.getTime())) return `Day ${number}`
  const total = Math.floor((parse(day(end)) - startIndex) / 86400000) + 1
  return total > 0 ? `Day ${number} of ${total}` : `Day ${number}`
}
const typeLabel = type => ({ medication: 'Medication', vital_check: 'Vital check', appointment: 'Appointment', follow_up: 'Follow-up', activity: 'Activity', instruction: 'Instruction', custom: 'Care task' })[type] || 'Care task'
const taskState = row => row.completed ? 'Completed' : row.status === 'cancelled' ? 'Cancelled' : new Date(row.scheduled_at) <= new Date() ? 'Incomplete' : 'Upcoming'

function ReadOnlyTask({ occurrence, task }) {
  if (!task) return null
  const reading = occurrence.source?.reading
  const vitalValue = reading && [reading.systolic_bp, reading.diastolic_bp].every(value => value != null)
    ? `${reading.systolic_bp}/${reading.diastolic_bp} mmHg`
    : reading?.heart_rate != null ? `${reading.heart_rate} bpm`
      : reading?.spo2 != null ? `${reading.spo2}%`
        : reading?.temperature_c != null ? `${reading.temperature_c} °C`
          : reading?.glucose_mg_dl != null ? `${reading.glucose_mg_dl} mg/dL`
            : reading?.weight_kg != null ? `${reading.weight_kg} kg` : null
  return <li className="family-care-task">
    <div><strong>{task.title || typeLabel(task.task_type)}</strong><span>{typeLabel(task.task_type)} · {formatTime(occurrence.scheduled_at, occurrence.timezone)}</span></div>
    <span className={`status-badge status-${occurrence.completed ? 'completed' : occurrence.status || 'pending'}`}>{taskState(occurrence)}</span>
    {task.instructions && <p>{task.instructions}</p>}
    {task.task_type === 'medication' && task.medication && <p>{[task.medication.medication_name, task.medication.dose].filter(Boolean).join(' · ')}</p>}
    {task.task_type === 'vital_check' && vitalValue && <p>Recorded value: {vitalValue}</p>}
    {task.task_type === 'appointment' && task.appointment && <p>{task.appointment.status ? `Appointment ${task.appointment.status}` : 'Appointment detail shared'}</p>}
    {task.task_type === 'follow_up' && task.follow_up?.instructions && <p>{task.follow_up.instructions}</p>}
  </li>
}

export function FamilyCarePlanReadOnlyDetail({ item }) {
  const plan = item.plan || {}
  const version = (item.versions || []).find(value => value.id === plan.current_version_id) || (item.versions || []).at(-1)
  const tasks = item.tasks || []
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const today = localDay(new Date(), plan.timezone)
  const occurrences = (item.occurrences || []).filter(row => row.local_due_date === today && row.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || String(a.id).localeCompare(String(b.id)))
  const progress = item.progress?.today
  const next = (item.occurrences || []).filter(row => row.required && row.status === 'pending' && Date.parse(row.scheduled_at) > Date.now())
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || String(a.id).localeCompare(String(b.id)))[0]
  const nextTask = next && taskById.get(next.task_id)
  if (!plan.id || !version) return <p role="alert">Care Plan details are unavailable right now.</p>
  return <div className="family-care-plan-detail">
    {dayNumber(plan) && <p>{dayNumber(plan)}</p>}
    {version.instructions && <p>{version.instructions}</p>}
    <section aria-label="Today's Care Tasks">
      <h4>Today's Care Tasks</h4>
      {progress?.state === 'no_tasks_due' ? <p>No care tasks due today</p> : progress?.state === 'tasks_due' ? <>
        <p>{progress.completed} of {progress.total} care tasks completed</p>
        <progress aria-label="Today's care tasks completed" max={progress.total} value={progress.completed} />
      </> : <p>Today's progress is unavailable.</p>}
      {occurrences.length > 0 && <ul className="patient-health-list">{occurrences.map(row => <ReadOnlyTask key={row.id} occurrence={row} task={taskById.get(row.task_id)} />)}</ul>}
    </section>
    {next && nextTask && <section><h4>Next care task</h4><p><strong>{nextTask.title}</strong> · {formatTime(next.scheduled_at, next.timezone)}</p></section>}
    {(item.goals || []).length > 0 && <section><h4>Goals</h4><ul>{item.goals.map(goal => <li key={goal.id}><strong>{goal.title}</strong>{goal.description && <p>{goal.description}</p>}{goal.target_text && <p>{goal.target_text}</p>}</li>)}</ul></section>}
    <dl><div><dt>Status</dt><dd>{plan.status}</dd></div><div><dt>Plan dates</dt><dd>{dateLabel(plan.starts_at, plan.timezone)}{plan.target_end_at ? ` – ${dateLabel(plan.target_end_at, plan.timezone)}` : ''}</dd></div><div><dt>Plan version</dt><dd>{version.version_no ? `Version ${version.version_no}` : 'Not available'}</dd></div><div><dt>Last updated</dt><dd>{dateLabel(plan.updated_at, plan.timezone)}</dd></div></dl>
  </div>
}

export function FamilyCarePlanSection({ section, person, isSelf }) {
  const [openPlans, setOpenPlans] = useState({})
  if (isSelf) return <article className="card patient-health-section family-health-section" aria-label="Care Plan"><div className="section-title"><h2>Care Plan</h2></div><p>Your own clinical care plan is available in My Care Plan.</p><Link className="button button--secondary" to="/my-care-plan">Open My Care Plan</Link></article>
  const status = section?.status || 'loading'
  return <article className="card patient-health-section family-health-section family-care-plan-section" aria-label="Care Plan">
    <div className="section-title"><h2>Care Plan</h2></div>
    {status === 'loading' && <p role="status">Loading Care Plan...</p>}
    {status === 'not_authorized' && <><h3>Care Plan access not shared</h3><p>This family member has not shared Care Plan access with you.</p></>}
    {['expired', 'revoked', 'inactive'].includes(status) && <p role="status">Care Plan access is no longer available.</p>}
    {status === 'error' && <p className="dashboard-compact-state" role="alert">Temporarily unavailable. Refresh to try again.</p>}
    {status === 'ready' && !section.data?.length && <><h3>No active care plan</h3><p>No active clinical care plan is currently available for this family member.</p></>}
    {status === 'ready' && section.data?.map(item => {
      const plan = item.plan || {}
      const version = (item.versions || []).find(value => value.id === plan.current_version_id) || (item.versions || []).at(-1)
      const progress = item.progress?.today
      const next = (item.occurrences || []).filter(row => row.required && row.status === 'pending' && Date.parse(row.scheduled_at) > Date.now())
        .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0]
      const nextTask = next && (item.tasks || []).find(task => task.id === next.task_id)
      const expanded = Boolean(openPlans[plan.id])
      return <section className="family-care-plan-summary" key={plan.id}>
        <h3>{version?.title || 'Care Plan'}</h3><span className="status-badge status-active">Active</span>
        {progress?.state === 'tasks_due' ? <p><strong>Today's Care Tasks</strong> · {progress.completed} of {progress.total} completed</p>
          : progress?.state === 'no_tasks_due' ? <p>No care tasks due today</p> : <p>Today's progress is unavailable.</p>}
        {nextTask && <p><strong>Next:</strong> {nextTask.title} · {formatTime(next.scheduled_at, next.timezone)}</p>}
        <button className="button button--secondary" type="button" aria-expanded={expanded} onClick={() => setOpenPlans(current => ({ ...current, [plan.id]: !current[plan.id] }))}>{expanded ? 'Hide Care Plan' : 'View Care Plan'}</button>
        {expanded && <FamilyCarePlanReadOnlyDetail item={item} />}
      </section>
    })}
  </article>
}
