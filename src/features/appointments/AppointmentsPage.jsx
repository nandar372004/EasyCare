import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, History, House, MessageSquare, Phone, RefreshCw, Star, Video, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { presentationRepository } from '../../services/repositories/index.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { BookingConflictError, canJoinWaitingRoom, createIdempotencyKey, isFutureEligibleAppointment } from '../../services/bookingService.js'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { useAuth } from '../auth/AuthContext.jsx'

const TYPE_LABELS = { video: 'Video consultation', voice: 'Voice call', chat: 'Chat', home_visit: 'Home visit' }
const TYPE_ICONS = { video: Video, voice: Phone, chat: MessageSquare, home_visit: House }
const EVENT_LABELS = { appointment_created: 'Appointment booked', appointment_rescheduled: 'Appointment rescheduled', appointment_cancelled: 'Appointment cancelled', status_changed: 'Status updated' }

export function AppointmentsPage() {
  return <AppointmentsUiBoundary><AppointmentsPageContent /></AppointmentsUiBoundary>
}

function AppointmentsPageContent() {
  const { t, locale } = useLocalization()
  const { patient } = useAuth()
  const { id } = useParams()
  const [appointments, setAppointments] = useState([])
  const [appointment, setAppointment] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    if (!patient?.id) { setLoadError('Please sign in again.'); setLoading(false); return }
    try {
      const [appointmentData, doctorRows] = await Promise.all([id ? presentationRepository.getAppointment(id, { patientId: patient.id }) : presentationRepository.listAppointments({ patientId: patient.id }), presentationRepository.listDoctors()])
      if (id) setAppointment(appointmentData); else setAppointments(appointmentData)
      setDoctors(doctorRows)
    } catch { setLoadError('Unable to load appointments.') }
    finally { setLoading(false) }
  }, [id, patient?.id])
  useEffect(() => { void load() }, [load])
  const doctorFor = (item) => item?.doctor ?? doctors.find((doctor) => doctor.id === item?.doctorId)
  const filtered = useMemo(() => appointments.filter((item) => filter === 'all' || (filter === 'upcoming' ? ['pending', 'confirmed', 'checked_in', 'in_progress'].includes(item.status) : item.status === filter)).sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt)), [appointments, filter])
  const featuredAppointment = filtered.filter(isFutureEligibleAppointment).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0] ?? filtered[0]
  const otherAppointments = featuredAppointment ? filtered.filter((item) => item.id !== featuredAppointment.id) : []
  if (loading) return <section><h1>{id ? 'Appointment Details' : 'Appointments'}</h1><p role="status">Loading appointments…</p></section>
  if (loadError) return <section className="card empty-state"><h1>Unable to load appointments</h1><p role="alert">{loadError}</p><button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button></section>
  if (id) return appointment ? <AppointmentDetails initialAppointment={appointment} doctor={doctorFor(appointment)} onCanonicalChange={setAppointment} /> : <section className="card empty-state"><h1>{t('appointment.notFound')}</h1><p>{t('appointment.noAccess')}</p><Link className="button button--secondary" to="/appointments">{t('appointment.title')}</Link></section>
  return <section className="appointments-page"><header className="appointments-heading"><div><h1>{t('appointment.title')}</h1><p>{t('appointment.manage')}</p></div></header>
    <div className="appointment-filters" role="tablist" aria-label="Appointment filters">{['all', 'upcoming', 'completed', 'cancelled'].map((item) => <button type="button" role="tab" aria-selected={filter === item} className={`appointment-filter-tab${filter === item ? ' active' : ''}`} key={item} onClick={() => setFilter(item)}>{item === 'all' ? 'All Appointments' : t(`status.${item}`)}</button>)}</div>
    {featuredAppointment && <FeaturedAppointmentCard appointment={featuredAppointment} doctor={doctorFor(featuredAppointment)} photoIndex={doctors.findIndex((doctor) => doctor.id === featuredAppointment.doctorId)} locale={locale} />}
    {!!otherAppointments.length && <section className="other-appointments" aria-labelledby="other-appointments-title"><h2 id="other-appointments-title">Other Appointments</h2><div className="appointment-list">{otherAppointments.map((item) => <AppointmentCard appointment={item} doctor={doctorFor(item)} photoIndex={doctors.findIndex((doctor) => doctor.id === item.doctorId)} locale={locale} key={item.id} />)}</div></section>}
    {!filtered.length && <div className="card empty-state"><CalendarDays aria-hidden="true" /><h2>{t('appointment.noAppointments')}</h2><p>Book a doctor to get started.</p><Link className="button button--primary" to="/doctors">{t('appointment.findDoctor')}</Link></div>}
  </section>
}

function FeaturedAppointmentCard({ appointment, doctor, photoIndex, locale }) {
  const { t } = useLocalization()
  const Icon = TYPE_ICONS[appointment.consultationType] ?? CalendarDays
  const date = appointmentDateParts(appointment.scheduledAt, locale)
  const joinable = canJoinWaitingRoom(appointment)
  const eligible = isFutureEligibleAppointment(appointment)
  const allowLifecycle = presentationRepository.mode !== 'supabase'
  return <article className="featured-appointment card">
    <div className="featured-identity">
      <AppointmentDateBlock date={date} />
      <span className="doctor-avatar doctor-photo appointment-doctor-photo" role="img" aria-label={`Portrait of ${doctor?.displayName ?? 'doctor'}`} style={{ '--photo-x': `${(Math.max(photoIndex, 0) % 5) * 25}%`, '--photo-y': photoIndex >= 5 ? '100%' : '0%' }} />
      <div>
        <h2>{doctor?.displayName ?? 'Doctor'}</h2>
        <p>{doctor?.specialty ?? 'Healthcare provider'}</p>
        {doctor?.rating && <span className="appointment-rating"><Star aria-hidden="true" /> {doctor.rating}</span>}
      </div>
    </div>
    <div className="featured-facts">
      <div><dt>Date</dt><dd>{date.longDate}</dd></div>
      <div><dt>Time</dt><dd>{date.time}</dd></div>
      <div><dt>Mode</dt><dd><Icon aria-hidden="true" />{TYPE_LABELS[appointment.consultationType] ?? 'Consultation'}</dd></div>
      <div><dt>Status</dt><dd><AppointmentStatus status={appointment.status} label={t(`status.${appointment.status}`)} /></dd></div>
    </div>
    <div className="featured-actions">
      {joinable && <Link className="button button--primary" to={`/consultations/${appointment.id}`}>Join Waiting Room</Link>}
      <Link className="button button--secondary" to={`/appointments/${appointment.id}`}>View Details</Link>
      {allowLifecycle && eligible && <button className="button button--secondary" type="button" onClick={() => window.location.href = `/appointments/${appointment.id}`}>Reschedule</button>}
      {allowLifecycle && eligible && <button className="button button--danger" type="button" onClick={() => window.location.href = `/appointments/${appointment.id}`}>Cancel Appointment</button>}
    </div>
  </article>
}

function AppointmentCard({ appointment, doctor, photoIndex, locale }) {
  const { t } = useLocalization()
  const Icon = TYPE_ICONS[appointment.consultationType] ?? CalendarDays
  const date = appointmentDateParts(appointment.scheduledAt, locale)
  const eligible = isFutureEligibleAppointment(appointment)
  return <article className="appointment-card card">
    <AppointmentDateBlock date={date} compact />
    <span className="doctor-avatar doctor-photo appointment-doctor-photo" role="img" aria-label={`Portrait of ${doctor?.displayName ?? 'doctor'}`} style={{ '--photo-x': `${(Math.max(photoIndex, 0) % 5) * 25}%`, '--photo-y': photoIndex >= 5 ? '100%' : '0%' }} />
    <div className="appointment-main">
      <h2>{doctor?.displayName ?? 'Doctor'}</h2>
      <span>{doctor?.specialty ?? 'Healthcare provider'}</span>
    </div>
    <dl className="compact-facts">
      <div><dt>Date</dt><dd>{date.longDate}</dd></div>
      <div><dt>Time</dt><dd>{date.time}</dd></div>
      <div><dt>Mode</dt><dd><Icon aria-hidden="true" />{TYPE_LABELS[appointment.consultationType] ?? 'Consultation'}</dd></div>
      <div><dt>Status</dt><dd><AppointmentStatus status={appointment.status} label={t(`status.${appointment.status}`)} /></dd></div>
    </dl>
    <div className="appointment-actions">
      <Link className="button button--secondary" to={`/appointments/${appointment.id}`}>{t('action.viewDetails')}</Link>
      {eligible && <button className="button button--ghost" type="button" aria-label="More actions" onClick={(e) => { e.preventDefault(); window.location.href = `/appointments/${appointment.id}` }}>⋯</button>}
    </div>
  </article>
}

function AppointmentDateBlock({ date, compact = false }) {
  return <time className={`appointment-date-block${compact ? ' compact' : ''}`} dateTime={date.iso}><span>{date.month}</span><strong>{date.day}</strong><small>{date.weekday}</small></time>
}

function AppointmentStatus({ status, label }) {
  return <span className={`status-badge status-${status}`}><CheckCircle2 aria-hidden="true" />{label}</span>
}

function appointmentDateParts(value, locale) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { iso: '', month: '—', day: '—', weekday: '', longDate: 'Date unavailable', time: 'Time unavailable' }
  const options = { timeZone: 'Asia/Yangon' }
  return { iso: date.toISOString(), month: new Intl.DateTimeFormat(locale, { ...options, month: 'short' }).format(date), day: new Intl.DateTimeFormat(locale, { ...options, day: '2-digit' }).format(date), weekday: new Intl.DateTimeFormat(locale, { ...options, weekday: 'short' }).format(date), longDate: new Intl.DateTimeFormat(locale, { ...options, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).format(date), time: new Intl.DateTimeFormat(locale, { ...options, hour: '2-digit', minute: '2-digit' }).format(date) }
}

class AppointmentsUiBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Appointments UI rendering failed.', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section className="card empty-state" role="alert"><AlertTriangle aria-hidden="true" /><h1>Appointments could not be displayed</h1><p>One or more appointment records could not be shown. Please reload and try again.</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />Reload appointments</button></section>
  }
}

function AppointmentDetails({ initialAppointment, doctor, onCanonicalChange }) {
  const { patient } = useAuth()
  const [appointment, setAppointment] = useState(initialAppointment)
  const [events, setEvents] = useState([])
  const [mode, setMode] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const refresh = useCallback(async () => {
    const current = await presentationRepository.getAppointment(appointment.id, { patientId: patient?.id })
    const history = presentationRepository.mode === 'supabase' ? [] : await presentationRepository.listAppointmentEvents(appointment.id)
    if (current) { setAppointment(current); onCanonicalChange(current) }
    setEvents(history)
  }, [appointment.id, onCanonicalChange, patient?.id])
  useEffect(() => { void refresh() }, [refresh])
  const remote = appointment.consultationType !== 'home_visit'
  const eligible = isFutureEligibleAppointment(appointment)
  const joinable = canJoinWaitingRoom(appointment)
  const allowLifecycle = presentationRepository.mode !== 'supabase'
  return <section className="appointment-details"><Link className="back-link" to="/appointments">← Back to appointments</Link>
    {feedback && <div className={`lifecycle-feedback ${feedback.type}`} role="status"><CheckCircle2 aria-hidden="true" /><span>{feedback.message}</span><button type="button" aria-label="Dismiss status" onClick={() => setFeedback(null)}>×</button></div>}
    <article className="card appointment-detail-hero"><div><span className={`status-badge status-${appointment.status}`}>{appointment.status.replace('_', ' ')}</span><h1>{doctor?.displayName ?? 'Doctor appointment'}</h1><p>{doctor?.specialty} · {TYPE_LABELS[appointment.consultationType]}</p><strong className="booking-code">{appointment.bookingCode}</strong></div><div className="appointment-detail-actions">{joinable && <Link className="button button--primary" to={`/consultations/${appointment.id}`}>Join waiting room</Link>}{allowLifecycle && <button className="button button--secondary" type="button" disabled={!eligible || mode !== null} onClick={() => setMode('reschedule')}>Reschedule</button>}{allowLifecycle && <button className="button button--danger" type="button" disabled={!eligible || mode !== null} onClick={() => setMode('cancel')}>Cancel appointment</button>}</div></article>
    {!eligible && <div className="eligibility-note"><AlertTriangle aria-hidden="true" /><span>{['completed', 'cancelled'].includes(appointment.status) ? `${appointment.status[0].toUpperCase() + appointment.status.slice(1)} appointments cannot be rescheduled, cancelled, or joined.` : 'Only future pending or confirmed appointments can be changed.'}</span></div>}
    {mode === 'reschedule' && <ReschedulePanel appointment={appointment} onClose={() => setMode(null)} onChanged={async () => { setMode(null); await refresh(); setFeedback({ type: 'success', message: 'Appointment rescheduled successfully. Your dashboard and appointment details now show the new time.' }) }} />}
    {mode === 'cancel' && <CancelPanel appointment={appointment} onClose={() => setMode(null)} onChanged={async () => { setMode(null); await refresh(); setFeedback({ type: 'success', message: 'Appointment cancelled. The appointment time has been released safely.' }) }} />}
    <div className="profile-grid"><article className="card info-card"><h2>Appointment details</h2><dl><div><dt>Date and time</dt><dd>{formatPresentationDateTime(appointment.scheduledAt)}</dd></div><div><dt>Consultation</dt><dd>{TYPE_LABELS[appointment.consultationType]}</dd></div><div><dt>Fee</dt><dd>{formatMmk(appointment.feeMmk)}</dd></div><div><dt>Reason for Visit/Symptoms</dt><dd>{appointment.symptoms || 'Not provided'}</dd></div>{appointment.cancellationReason && <div><dt>Cancellation reason</dt><dd>{appointment.cancellationReason}</dd></div>}</dl></article><article className="card info-card"><h2>{remote ? 'Remote consultation' : 'Home visit'}</h2><p>{remote ? (joinable ? 'Use the waiting-room button when you are ready. Access is unavailable after completion or cancellation.' : 'Waiting-room access is unavailable for this appointment status.') : 'The provider visits the registered patient address. Home visits do not use an online waiting room.'}</p></article></div>
    <EventHistory events={events} />
  </section>
}

function ReschedulePanel({ appointment, onClose, onChanged }) {
  const [slots, setSlots] = useState([])
  const [slotId, setSlotId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mutationKey = useRef(createIdempotencyKey())
  const loadSlots = useCallback(async () => { const rows = await presentationRepository.listAvailabilitySlots({ doctorId: appointment.doctorId }); setSlots(rows.filter((slot) => slot.id !== appointment.slotId && slot.status === 'available' && slot.consultationType === appointment.consultationType && new Date(slot.startsAt) > new Date()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))) }, [appointment])
  useEffect(() => { void loadSlots() }, [loadSlots])
  const submit = async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await presentationRepository.rescheduleAppointment({ appointmentId: appointment.id, slotId, mutationKey: mutationKey.current }); await onChanged() } catch (cause) { if (cause instanceof BookingConflictError || cause?.code === 'SLOT_CONFLICT') { setSlotId(''); await loadSlots() } setError(cause.message) } finally { setBusy(false) } }
  return <section className="card lifecycle-panel"><div className="booking-heading"><div><span className="eyebrow">Choose another time</span><h2>Reschedule appointment</h2></div><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Close</button></div><form onSubmit={submit}><label>Available date and time<select className="form-control" aria-label="New available date and time" value={slotId} onChange={(event) => { setSlotId(event.target.value); setError('') }}><option value="">Choose an available time</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>{formatPresentationDateTime(slot.startsAt)}</option>)}</select></label>{!slots.length && <p className="slot-warning">No replacement times are currently available for this doctor and consultation type.</p>}{error && <div className="error-message" role="alert">{error}</div>}<button className="button button--primary" disabled={busy || !slotId} type="submit"><RefreshCw aria-hidden="true" />{busy ? 'Rescheduling…' : 'Confirm new time'}</button></form></section>
}

function CancelPanel({ appointment, onClose, onChanged }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mutationKey = useRef(createIdempotencyKey())
  const submit = async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await presentationRepository.cancelAppointment({ appointmentId: appointment.id, reason, mutationKey: mutationKey.current }); await onChanged() } catch (cause) { setError(cause.message) } finally { setBusy(false) } }
  return <section className="card lifecycle-panel cancel-panel"><XCircle aria-hidden="true" /><h2>Cancel this appointment?</h2><p>This releases the appointment time for another patient. This action cannot be undone in this phase.</p><form onSubmit={submit}><label>Reason <span className="muted">(optional)</span><textarea className="form-control" maxLength="500" rows="2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are you cancelling?" /></label>{error && <div className="error-message" role="alert">{error}</div>}<div className="confirmation-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Keep appointment</button><button className="button button--danger" type="submit" disabled={busy}>{busy ? 'Cancelling…' : 'Yes, cancel appointment'}</button></div></form></section>
}

function EventHistory({ events }) {
  return <article className="card event-history"><h2><History aria-hidden="true" /> Appointment history</h2>{events.length ? <ol>{events.map((event) => <li key={event.id}><span className="event-dot" /><div><strong>{EVENT_LABELS[event.eventType] ?? event.eventType.replaceAll('_', ' ')}</strong><p>{formatPresentationDateTime(event.createdAt)}{event.fromStatus && event.fromStatus !== event.toStatus ? ` · ${event.fromStatus} → ${event.toStatus}` : ''}</p></div></li>)}</ol> : <p>No history entries are available.</p>}</article>
}
