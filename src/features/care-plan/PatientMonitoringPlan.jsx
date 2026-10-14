import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, ChevronDown, Clock3, Pencil, Plus, Trash2 } from 'lucide-react'
import { patientMonitoringService, isScheduledOn } from '../../services/patientMonitoringService.js'
import './patientMonitoringPlan.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_CHOICES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => ({ label, value: (index + 1) % 7 }))
const dateLabel = value => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : ''
const clockLabel = value => {
  const [hour, minute] = String(value || '').slice(0, 5).split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return ''
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
const newDraft = (today, plan = null) => ({
  id: plan?.id || null, title: plan?.title || '', relatedContext: plan?.relatedContext || '', notes: plan?.notes || '',
  recurrenceType: plan?.recurrenceType || 'daily', daysOfWeek: plan?.daysOfWeek || [],
  measurementType: plan?.measurementType || '', measurementUnit: plan?.measurementUnit || '',
  startDate: plan?.startDate || today, endDate: plan?.endDate || '', times: plan?.times?.map(item => item.timeOfDay.slice(0, 5)) || [],
})
const weekdaySummary = plan => plan.recurrenceType === 'daily' ? 'Every day'
  : plan.recurrenceType === 'once' ? `One-time · ${dateLabel(plan.startDate)}`
    : (plan.daysOfWeek || []).slice().sort((a,b) => WEEKDAYS.indexOf(WEEKDAYS[a]) - WEEKDAYS.indexOf(WEEKDAYS[b])).map(day => WEEKDAYS[day]).join(' · ')

function RoutineForm({ initial, today, saving, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => newDraft(today, initial))
  const [error, setError] = useState('')
  const titleInput = useRef(null)
  useEffect(() => { titleInput.current?.focus() }, [])
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const toggleDay = day => set('daysOfWeek', draft.daysOfWeek.includes(day) ? draft.daysOfWeek.filter(item => item !== day) : [...draft.daysOfWeek, day])
  const selectMeasurement = type => setDraft(current => ({ ...current, measurementType: type, measurementUnit: type === 'blood_pressure' ? 'mmHg' : type === 'heart_rate' ? 'bpm' : type === 'weight' ? 'kg' : type === 'blood_glucose' ? 'mg/dL' : type === 'temperature' ? '°C' : '' }))
  const updateTime = (index, value) => set('times', draft.times.map((time, position) => position === index ? value : time))
  const submit = async event => {
    event.preventDefault()
    setError('')
    try { await onSave({ ...draft, daysOfWeek: draft.recurrenceType === 'selected_days' ? draft.daysOfWeek : [], times: draft.times.filter(Boolean) }) }
    catch { setError('Could not save this routine. Check the schedule and try again.') }
  }
  return <form className="monitoring-routine-form" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
    <label>Routine name *<input ref={titleInput} required maxLength={200} value={draft.title} onChange={event => set('title', event.target.value)} placeholder="Measure blood pressure" /></label>
    <label>Related condition or context <input maxLength={200} value={draft.relatedContext} onChange={event => set('relatedContext', event.target.value)} placeholder="Optional" /></label>
    <label>Measurement<select value={draft.measurementType} onChange={event => selectMeasurement(event.target.value)}><option value="">No measurement required</option><option value="blood_pressure">Blood pressure</option><option value="weight">Weight</option><option value="blood_glucose">Blood sugar</option><option value="heart_rate">Heart rate</option><option value="temperature">Temperature</option><option value="custom">Custom measurement</option></select></label>
    {draft.measurementType && <div className="monitoring-measurement-definition"><label>Unit{draft.measurementType === 'custom' ? ' *' : ''}{draft.measurementType === 'weight' || draft.measurementType === 'blood_glucose' || draft.measurementType === 'temperature' ? <select required value={draft.measurementUnit} onChange={event => set('measurementUnit', event.target.value)}>{(draft.measurementType === 'weight' ? ['kg','lb'] : draft.measurementType === 'blood_glucose' ? ['mg/dL','mmol/L'] : ['°C','°F']).map(unit => <option key={unit}>{unit}</option>)}</select> : draft.measurementType === 'custom' ? <input required maxLength={40} value={draft.measurementUnit} onChange={event => set('measurementUnit', event.target.value)} placeholder="e.g. cm" /> : <input value={draft.measurementUnit} readOnly />}</label></div>}
    <label>Schedule type<select value={draft.recurrenceType} onChange={event => set('recurrenceType', event.target.value)}><option value="daily">Every day</option><option value="selected_days">Selected days</option><option value="once">One-time</option></select></label>
    {draft.recurrenceType === 'selected_days' && <fieldset className="monitoring-days"><legend>Choose days</legend>{WEEKDAY_CHOICES.map(day => <label key={day.value}><input type="checkbox" checked={draft.daysOfWeek.includes(day.value)} onChange={() => toggleDay(day.value)} />{day.label}</label>)}</fieldset>}
    <fieldset className="monitoring-times"><legend>Times <span>(optional)</span></legend>{draft.times.map((time, index) => <div className="monitoring-time-input" key={index}><label className="sr-only" htmlFor={`monitoring-time-${index}`}>Time {index + 1}</label><input id={`monitoring-time-${index}`} type="time" value={time} onChange={event => updateTime(index, event.target.value)} /><button type="button" aria-label={`Remove time ${index + 1}`} onClick={() => set('times', draft.times.filter((_, position) => position !== index))}>Remove</button></div>)}{draft.times.length < 12 && <button className="monitoring-inline-button" type="button" onClick={() => set('times', [...draft.times, ''])}><Plus aria-hidden="true" /> Add a time</button>}</fieldset>
    <div className="monitoring-date-fields"><label>{draft.recurrenceType === 'once' ? 'Date *' : 'Start date *'}<input type="date" required value={draft.startDate} onChange={event => set('startDate', event.target.value)} /></label>{draft.recurrenceType !== 'once' && <label>End date <input type="date" min={draft.startDate} value={draft.endDate} onChange={event => set('endDate', event.target.value)} /></label>}</div>
    <label>Notes <textarea maxLength={1000} rows={2} value={draft.notes} onChange={event => set('notes', event.target.value)} placeholder="Optional" /></label>
    {error && <p role="alert" className="monitoring-error">{error}</p>}
    <div className="monitoring-form-actions"><button type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add routine'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}

function Occurrence({ plan, today, occurrenceKey, label, checkIn, onCheckIn, onMeasurement, savingKey }) {
  const [value, setValue] = useState(checkIn?.measurementValue || '')
  const [unit, setUnit] = useState(checkIn?.measurementUnit || '')
  const [systolic, setSystolic] = useState(checkIn?.systolicValue ?? '')
  const [diastolic, setDiastolic] = useState(checkIn?.diastolicValue ?? '')
  const [notes, setNotes] = useState(checkIn?.notes || '')
  const [error, setError] = useState(false)
  const key = `${plan.id}:${occurrenceKey}`
  const isDone = checkIn?.status === 'done'
  const save = async done => {
    setError(false)
    try { await onCheckIn({ planId: plan.id, localDate: today, occurrenceKey, isDone: done, measurementValue: value, measurementUnit: unit, notes }) }
    catch { setError(true) }
  }
  const saveMeasurement = async () => {
    setError(false)
    try { await onMeasurement({ planId: plan.id, localDate: today, occurrenceKey, measurementType: plan.measurementType,
      measurementValue: plan.measurementType === 'blood_pressure' ? null : value,
      systolicValue: plan.measurementType === 'blood_pressure' ? systolic : null,
      diastolicValue: plan.measurementType === 'blood_pressure' ? diastolic : null,
      measurementUnit: plan.measurementUnit, notes }) }
    catch { setError(true) }
  }
  const measured = Boolean(plan.measurementType)
  const isBp = plan.measurementType === 'blood_pressure'
  return <div className={`monitoring-occurrence${isDone ? ' is-done' : ''}`}>
    <label className="monitoring-occurrence-toggle">{!measured && <input type="checkbox" checked={isDone} disabled={savingKey === key} onChange={event => void save(event.target.checked)} />}<span>{label}</span>{isDone && <span className="monitoring-done-label"><Check aria-hidden="true" /> Done</span>}</label>
    {measured && <div className="monitoring-measurement-entry">{isBp ? <><label>Systolic <input type="number" min="0.01" step="any" value={systolic} onChange={event => setSystolic(event.target.value)} placeholder="125" /></label><span className="monitoring-bp-separator">/</span><label>Diastolic <input type="number" min="0.01" step="any" value={diastolic} onChange={event => setDiastolic(event.target.value)} placeholder="80" /></label></> : <label>Value <input type="number" min="0.01" step="any" value={value} onChange={event => setValue(event.target.value)} placeholder="Enter value" /></label>}<span className="monitoring-measurement-unit">{plan.measurementUnit}</span><button type="button" disabled={savingKey === key} onClick={() => void saveMeasurement()}>{savingKey === key ? 'Saving…' : isDone ? 'Save correction' : 'Save & Mark Done'}</button></div>}
    {!measured && <div className="monitoring-measurement"><label>Value <input maxLength={100} value={value} onChange={event => setValue(event.target.value)} placeholder="Optional" /></label><label>Unit <input maxLength={40} value={unit} onChange={event => setUnit(event.target.value)} placeholder="Optional" /></label><button type="button" disabled={savingKey === key} onClick={() => void save(isDone)}>{savingKey === key ? 'Saving…' : 'Save value'}</button></div>}
    {isDone && measured && <button type="button" className="monitoring-reopen" disabled={savingKey === key} onClick={() => void save(false)}>Reopen</button>}
    {error && <span role="alert" className="monitoring-error">Could not save this check-in.</span>}
  </div>
}

function Routine({ plan, today, checkIns, onEdit, onDeactivate, onCheckIn, onMeasurement, savingKey, savingPlanId }) {
  const todaysChecks = checkIns.filter(row => row.monitoringPlanId === plan.id && row.localDate === today)
  const pastChecks = checkIns.filter(row => row.monitoringPlanId === plan.id && row.localDate < today)
  const scheduled = isScheduledOn(plan, today)
  const occurrences = plan.times?.length ? plan.times.map(item => ({ key: item.id, label: clockLabel(item.timeOfDay) })) : [{ key: 'any', label: 'Any time today' }]
  return <article className={`monitoring-routine${plan.isActive ? '' : ' is-inactive'}`}>
    <div className="monitoring-routine-heading"><div><h3>{plan.title}</h3>{plan.relatedContext && <p className="monitoring-context">Related to: {plan.relatedContext}</p>}<p className="monitoring-schedule"><CalendarClock aria-hidden="true" />{weekdaySummary(plan)} <span>·</span><Clock3 aria-hidden="true" />{plan.times?.length ? plan.times.map(item => clockLabel(item.timeOfDay)).join(' · ') : 'Any time today'}</p></div>
      {plan.isActive && <div className="monitoring-routine-actions"><button type="button" aria-label={`Edit ${plan.title}`} onClick={() => onEdit(plan)}><Pencil aria-hidden="true" /><span>Edit</span></button><button type="button" aria-label={`Deactivate ${plan.title}`} disabled={savingPlanId === plan.id} onClick={() => void onDeactivate(plan)}><Trash2 aria-hidden="true" /><span>Pause</span></button></div>}
      {!plan.isActive && <span className="monitoring-paused">Paused</span>}
    </div>
    {plan.notes && <p className="monitoring-notes">{plan.notes}</p>}
    {plan.isActive && <section className="monitoring-today-list" aria-label={`${plan.title} occurrence`}><h4>{today === new Date().toISOString().slice(0,10) ? 'Today' : 'Scheduled occurrence'} · {dateLabel(today)}</h4>{scheduled ? occurrences.map(occurrence => <Occurrence key={`${today}:${occurrence.key}`} plan={plan} today={today} occurrenceKey={occurrence.key} label={occurrence.label} checkIn={todaysChecks.find(row => row.occurrenceKey === occurrence.key)} onCheckIn={onCheckIn} onMeasurement={onMeasurement} savingKey={savingKey} />) : <p className="monitoring-not-scheduled">Not scheduled on this date.</p>}</section>}
    {pastChecks.length + todaysChecks.length > 0 && <details className="monitoring-history"><summary>View History <span>({pastChecks.length + todaysChecks.length})</span><ChevronDown aria-hidden="true" /></summary><ul>{[...pastChecks, ...todaysChecks].sort((a,b) => b.localDate.localeCompare(a.localDate) || String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt))).map(row => <li key={row.id}><span>{dateLabel(row.localDate)} · {row.occurrenceLabel || (row.occurrenceKey === 'any' ? 'Any time' : clockLabel(plan.times?.find(time => time.id === row.occurrenceKey)?.timeOfDay) || 'Scheduled time')}</span><span>{row.status === 'done' ? 'Done' : 'Reopened'}{row.systolicValue != null ? ` · ${row.systolicValue} / ${row.diastolicValue} ${row.measurementUnit || plan.measurementUnit || ''}` : row.measurementValue ? ` · ${row.measurementValue}${row.measurementUnit ? ` ${row.measurementUnit}` : ''}` : ''}{row.completedAt && <time dateTime={row.completedAt}> · {new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(row.completedAt))}</time>}</span></li>)}</ul></details>}
  </article>
}

export function PatientMonitoringPlan({ state, today, onRefresh }) {
  const plans = state.data?.plans || []
  const checkIns = state.data?.checkIns || []
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [savingPlanId, setSavingPlanId] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [selectedDate, setSelectedDate] = useState(today)
  const activePlans = useMemo(() => plans.filter(plan => plan.isActive).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt))), [plans])
  const inactivePlans = useMemo(() => plans.filter(plan => !plan.isActive), [plans])
  const refresh = async () => { await onRefresh() }
  const savePlan = async plan => {
    setSaving(true); setError('')
    try { await patientMonitoringService.saveMyPlan(plan); setAdding(false); setEditing(null); await refresh() }
    catch (failure) { throw failure }
    finally { setSaving(false) }
  }
  const deactivate = async plan => {
    setSavingPlanId(plan.id); setError('')
    try { await patientMonitoringService.deactivateMyPlan(plan.id); await refresh() }
    catch { setError('Could not pause this routine. Try again.') }
    finally { setSavingPlanId('') }
  }
  const saveCheckIn = async input => {
    const key = `${input.planId}:${input.occurrenceKey}`
    setSavingKey(key)
    try { await patientMonitoringService.recordMyCheckIn(input); await refresh() }
    finally { setSavingKey('') }
  }
  const saveMeasurement = async input => {
    const key = `${input.planId}:${input.occurrenceKey}`
    setSavingKey(key)
    try { await patientMonitoringService.recordMyMeasurement(input); await refresh() }
    finally { setSavingKey('') }
  }
  const startAdd = () => { setEditing(null); setAdding(true); setError('') }
  const cancelForm = () => { setAdding(false); setEditing(null) }
  const dateText = dateLabel(today)
  return <div className="patient-monitoring-plan">
    <label className="monitoring-today-heading">Monitoring date <input type="date" value={selectedDate} max={today} onChange={event => setSelectedDate(event.target.value)} /><span>{selectedDate === today ? `Today · ${dateText}` : dateLabel(selectedDate)}</span></label>
    {activePlans.length === 0 && inactivePlans.length === 0 && !adding && !editing && <div className="monitoring-empty"><p>No monitoring routines yet.</p><button type="button" onClick={startAdd}>+ Add your first routine</button></div>}
    {activePlans.length > 0 && <div className="monitoring-routine-list">{activePlans.filter(plan => isScheduledOn(plan, selectedDate)).map(plan => <Routine key={plan.id} plan={plan} today={selectedDate} checkIns={checkIns} onEdit={plan => { setAdding(false); setEditing(plan) }} onDeactivate={deactivate} onCheckIn={saveCheckIn} onMeasurement={saveMeasurement} savingKey={savingKey} savingPlanId={savingPlanId} />)}</div>}
    {activePlans.length > 0 && activePlans.every(plan => !isScheduledOn(plan, selectedDate)) && <p className="monitoring-no-today">No routines scheduled on this date.</p>}
    {(activePlans.length > 0 || inactivePlans.length > 0) && <details className="monitoring-all-routines" open={showAll} onToggle={event => setShowAll(event.currentTarget.open)}><summary>View all monitoring <ChevronDown aria-hidden="true" /></summary><div className="monitoring-routine-list">{activePlans.filter(plan => !isScheduledOn(plan, selectedDate)).map(plan => <Routine key={plan.id} plan={plan} today={selectedDate} checkIns={checkIns} onEdit={plan => { setAdding(false); setEditing(plan) }} onDeactivate={deactivate} onCheckIn={saveCheckIn} onMeasurement={saveMeasurement} savingKey={savingKey} savingPlanId={savingPlanId} />)}{inactivePlans.map(plan => <Routine key={plan.id} plan={plan} today={selectedDate} checkIns={checkIns} onEdit={() => {}} onDeactivate={() => {}} onCheckIn={saveCheckIn} onMeasurement={saveMeasurement} savingKey={savingKey} savingPlanId={savingPlanId} />)}</div></details>}
    {(adding || editing) && <RoutineForm initial={editing} today={today} saving={saving} onCancel={cancelForm} onSave={savePlan} />}
    {!adding && !editing && (activePlans.length > 0 || inactivePlans.length > 0) && <button className="monitoring-add" type="button" onClick={startAdd}><Plus aria-hidden="true" /> Add monitoring routine</button>}
    {error && <p className="monitoring-error" role="alert">{error}</p>}
  </div>
}

export const monitoringDateLabel = dateLabel
export const monitoringClockLabel = clockLabel

