const array = value => Array.isArray(value) ? value : []
const dateInZone = (value = new Date(), timeZone = 'Asia/Yangon') => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value instanceof Date ? value : new Date(value))
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const dateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Date unavailable'
const categoryLabels = { nutrition: 'Nutrition', exercise: 'Exercise', sleep: 'Sleep', posture: 'Posture', stress: 'Stress', general_wellness: 'General wellness', other: 'Other' }
const measurementLabels = { blood_pressure: 'Blood pressure', weight: 'Weight', blood_glucose: 'Blood sugar', heart_rate: 'Heart rate', temperature: 'Temperature', custom: 'Measurement' }
const isPrn = frequency => /\b(as needed|prn)\b/i.test(String(frequency || ''))
const dailyCount = frequency => {
  const value = String(frequency || '').toLowerCase()
  if (/\b(twice daily|2 times daily|2x daily)\b/.test(value)) return 2
  if (/\b(three times daily|3 times daily|3x daily)\b/.test(value)) return 3
  if (/\b(once daily|once a day|daily)\b/.test(value)) return 1
  return null
}
const scheduleApplies = (schedule, date) => (!schedule.valid_from || schedule.valid_from <= date) && (!schedule.valid_until || schedule.valid_until >= date)
function scheduled(plan, date) {
  if (!plan.is_active || date < plan.start_date || (plan.end_date && date > plan.end_date)) return false
  if (plan.recurrence_type === 'once') return date === plan.start_date
  if (plan.recurrence_type === 'daily') return true
  return plan.recurrence_type === 'selected_days' && array(plan.days_of_week).includes(new Date(`${date}T12:00:00Z`).getUTCDay())
}
const occurrencesFor = (plan, date) => !scheduled(plan, date) ? []
  : array(plan.times).length ? array(plan.times).filter(time => scheduleApplies(time, date)).map(time => time.id)
    : ['any']
function monitoringProgress(data) {
  const today = data?.as_of_date || dateInZone()
  const plans = array(data?.monitoring_plans).filter(plan => plan.is_active)
  const checkIns = array(data?.monitoring_check_ins)
  let totalToday = 0; let doneToday = 0; let totalWeek = 0; let doneWeek = 0
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(`${today}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - offset)
    const dateText = date.toISOString().slice(0, 10)
    for (const plan of plans) {
      const occurrences = occurrencesFor(plan, dateText)
      const checks = checkIns.filter(row => row.monitoring_plan_id === plan.id && row.local_date === dateText && row.status === 'done')
      const doneKeys = new Set(checks.map(row => row.occurrence_key))
      totalWeek += occurrences.length
      doneWeek += occurrences.filter(key => doneKeys.has(key)).length
      if (offset === 0) { totalToday += occurrences.length; doneToday += occurrences.filter(key => doneKeys.has(key)).length }
    }
  }
  return { today, plans, totalToday, doneToday, totalWeek, doneWeek }
}
function medicationProgress(data) {
  let total = 0; let done = 0; let prnTaken = 0
  for (const medication of array(data?.medications)) {
    const checkIns = array(medication.today_check_ins)
    if (isPrn(medication.frequency)) {
      if (checkIns.some(row => row.is_prn)) prnTaken += 1
      continue
    }
    const schedules = array(medication.medication_schedules)
    if (schedules.length) {
      for (const schedule of schedules) {
        const timezone = schedule.timezone || 'Asia/Yangon'
        const todayForSchedule = dateInZone(new Date(), timezone)
        const weekday = new Date(`${todayForSchedule}T12:00:00Z`).getUTCDay()
        if (!scheduleApplies(schedule, todayForSchedule) || (schedule.days_of_week && !schedule.days_of_week.includes(weekday))) continue
        total += 1
        if (array(schedule.events).some(event => event.status === 'taken')) done += 1
      }
    } else {
      const count = dailyCount(medication.frequency)
      if (!count || medication.source === 'patient_reported') continue
      total += count
      const completed = new Set(checkIns.filter(row => !row.is_prn && row.status === 'taken').map(row => row.occurrence_index))
      done += Array.from({ length: count }, (_, index) => index + 1).filter(index => completed.has(index)).length
    }
  }
  return { total, done, prnTaken }
}
export function familyPatientCarePlanHasData(data) {
  return ['health_goals', 'medications', 'monitoring_plans', 'lifestyle_plans', 'appointments']
    .some(key => array(data?.[key]).length > 0)
}

function ReadOnlyMedicationList({ data }) {
  const rows = array(data?.medications)
  if (!data?.access?.medications) return <p>Medication details and check-in progress are not shared.</p>
  if (!rows.length) return <p>No active medications are shared.</p>
  return <ul className="family-patient-care-list">{rows.map(medication => {
    const schedules = array(medication.medication_schedules)
    const checks = array(medication.today_check_ins)
    const prn = isPrn(medication.frequency)
    const count = dailyCount(medication.frequency)
    const completed = new Set(checks.filter(row => !row.is_prn && row.status === 'taken').map(row => row.occurrence_index)).size
    return <li key={`${medication.source}-${medication.id}`}>
      <strong>{medication.medication_name}</strong>
      {[medication.dose, medication.frequency].filter(Boolean).length > 0 && <span>{[medication.dose, medication.frequency].filter(Boolean).join(' · ')}</span>}
      {medication.instructions && <span>{medication.instructions}</span>}
      {schedules.map(schedule => <span key={schedule.id}>Scheduled {String(schedule.time_of_day).slice(0, 5)} · {schedule.timezone || 'Asia/Yangon'}</span>)}
      {prn ? <small>{checks.some(row => row.is_prn) ? 'As-needed dose recorded today' : 'As-needed medication · no dose recorded today'}</small>
        : count && !schedules.length ? <small>{completed} of {count} doses completed today</small>
          : schedules.length ? <small>{schedules.filter(schedule => array(schedule.events).some(event => event.status === 'taken')).length} of {schedules.length} scheduled doses completed today</small>
            : <small>Today’s dose completion is unavailable.</small>}
    </li>
  })}</ul>
}

function ReadOnlyMonitoring({ data }) {
  const { today, plans, totalToday, doneToday, totalWeek, doneWeek } = monitoringProgress(data)
  const latest = new Map(array(data?.monitoring_latest).map(row => [row.monitoring_plan_id, row]))
  if (!plans.length) return <p>No monitoring routines are shared.</p>
  return <>
    {totalToday > 0 && <p>{doneToday} of {totalToday} monitoring checks completed today</p>}
    {totalWeek > 0 && <p>This week: {doneWeek} of {totalWeek} scheduled checks completed</p>}
    <ul className="family-patient-care-list">{plans.map(plan => {
      const last = latest.get(plan.id)
      const times = array(plan.times).map(time => String(time.time_of_day).slice(0, 5))
      const schedule = plan.recurrence_type === 'daily' ? 'Daily' : plan.recurrence_type === 'once' ? `Once · ${plan.start_date}` : plan.recurrence_type === 'selected_days' ? array(plan.days_of_week).map(day => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ') : 'Schedule unavailable'
      const value = last?.systolic_value != null ? `${last.systolic_value}/${last.diastolic_value} ${last.measurement_unit || plan.measurement_unit || ''}`
        : last?.measurement_value != null ? `${last.measurement_value} ${last.measurement_unit || plan.measurement_unit || ''}` : null
      return <li key={plan.id}><strong>{plan.title}</strong>
        <span>{[measurementLabels[plan.measurement_type] || 'Routine', plan.related_context].filter(Boolean).join(' · ')}</span>
        <span>{schedule}{times.length ? ` · ${times.join(', ')}` : ''}</span>
        {data?.access?.records && value && <small>Latest: {value} · {dateLabel(last.local_date)}</small>}
        {!data?.access?.records && <small>Measurement values are not shared.</small>}
        {today && scheduled(plan, today) && <small>Scheduled today</small>}
      </li>
    })}</ul>
  </>
}

function ReadOnlyLifestyle({ data }) {
  const rows = array(data?.lifestyle_plans)
  if (!rows.length) return <p>No active lifestyle plans are shared.</p>
  return <ul className="family-patient-care-list">{rows.map(plan => <li key={plan.id}>
    <strong>{plan.title}</strong>
    {plan.category && <span>{categoryLabels[plan.category] || plan.category}</span>}
    {plan.description && <p>{plan.description}</p>}
    {array(plan.resources).map(resource => {
      let safeUrl = false
      try { const url = new URL(resource.url); safeUrl = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { /* Ignore invalid legacy links. */ }
      return safeUrl ? <a key={resource.id} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title || resource.url}</a> : null
    })}
  </li>)}</ul>
}

function ReadOnlyAppointments({ data }) {
  if (!data?.access?.appointments) return <p>Upcoming appointments are not shared.</p>
  const appointments = array(data.appointments)
  if (!appointments.length) return <p>No upcoming appointments are shared.</p>
  return <ul className="family-patient-care-list">{appointments.map(appointment => <li key={appointment.id}>
    <strong>{appointment.appointment_type || 'Appointment'}</strong>
    <span>{new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Yangon' }).format(new Date(appointment.scheduled_start))}</span>
    <span>{appointment.consultation_channel || 'Mode not recorded'} · {appointment.status}</span>
  </li>)}</ul>
}

export function FamilyPatientCarePlanReadOnlyDetail({ data }) {
  const medications = medicationProgress(data)
  const monitoring = monitoringProgress(data)
  return <div className="family-patient-care-detail">
    <section><h4>My Medications</h4><ReadOnlyMedicationList data={data} />
      {data?.access?.medications && medications.total > 0 && <p>{medications.done} of {medications.total} tracked doses completed today{medications.prnTaken ? ` · ${medications.prnTaken} as-needed medication${medications.prnTaken === 1 ? '' : 's'} recorded` : ''}</p>}</section>
    <section><h4>My Monitoring Plan</h4><ReadOnlyMonitoring data={data} /></section>
    <section><h4>My Health Goals</h4>{array(data?.health_goals).length ? <ul className="family-patient-care-list">{array(data.health_goals).map(goal => <li key={goal.id}><strong>{goal.title}</strong><span>{goal.is_completed ? 'Completed' : 'Active'}</span></li>)}</ul> : <p>No health goals are shared.</p>}</section>
    <section><h4>My Lifestyle Plan</h4><ReadOnlyLifestyle data={data} /></section>
    <section><h4>Upcoming Appointments</h4><ReadOnlyAppointments data={data} /></section>
    {(monitoring.totalToday > 0 || monitoring.totalWeek > 0) && <p className="family-patient-care-progress" aria-label="Monitoring progress">Monitoring progress is read-only.</p>}
  </div>
}

export function FamilyPatientCarePlanSummary({ data }) {
  const meds = array(data?.medications)
  const activeMedications = meds.filter(row => row.status === 'active')
  const medProgress = medicationProgress(data)
  const monitor = monitoringProgress(data)
  const activeGoals = array(data?.health_goals).filter(goal => !goal.is_completed).length
  const completedGoals = array(data?.health_goals).filter(goal => goal.is_completed).length
  const lifestyle = array(data?.lifestyle_plans)
  const appointments = array(data?.appointments)
  return <div className="family-patient-care-summary">
    {data?.access?.medications && <p><strong>Medications</strong><span>{activeMedications.length} active{medProgress.total > 0 ? ` · ${medProgress.done} of ${medProgress.total} completed today` : ''}{medProgress.prnTaken ? ` · ${medProgress.prnTaken} as-needed recorded` : ''}</span></p>}
    <p><strong>Monitoring</strong><span>{monitor.plans.filter(plan => scheduled(plan, monitor.today)).length} routine{monitor.plans.filter(plan => scheduled(plan, monitor.today)).length === 1 ? '' : 's'} due today{monitor.totalToday ? ` · ${monitor.doneToday} of ${monitor.totalToday} checks done` : ''}</span></p>
    <p><strong>Health Goals</strong><span>{activeGoals} active{completedGoals ? ` · ${completedGoals} completed` : ''}</span></p>
    <p><strong>Lifestyle</strong><span>{lifestyle.length} active plan{lifestyle.length === 1 ? '' : 's'}</span></p>
    {data?.access?.appointments && <p><strong>Upcoming Appointments</strong><span>{appointments.length} shared</span></p>}
    {(!data?.access?.medications || !data?.access?.appointments) && <small>Some details need separate Medication or Appointment sharing.</small>}
  </div>
}
