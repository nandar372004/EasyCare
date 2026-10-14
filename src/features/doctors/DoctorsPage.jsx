import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronLeft, House, MapPin, Phone, Search, Star, Stethoscope, Video } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { presentationRepository } from '../../services/repositories/index.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { BookingConflictError, createIdempotencyKey, createBookingCode, isSlotCompatible, PAYMENT_NOTICE, validateBooking } from '../../services/bookingService.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { bookingReason, composeBookingReason, useOneTapCare } from '../care/OneTapCare.jsx'
import '../appointments/appointmentRefinements.css'

const TYPE_LABELS = { video: 'Video', voice: 'Voice', chat: 'Chat', home_visit: 'Home visit' }
const TYPE_ICONS = { video: Video, voice: Phone, home_visit: House }

export function DoctorsPage() {
  const auth = useAuth()
  const care = useOneTapCare()
  const { doctorId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [doctors, setDoctors] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [slots, setSlots] = useState([])
  const [query, setQuery] = useState('')
  const [specialty, setSpecialty] = useState('All')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadVersion, setLoadVersion] = useState(0)

  useEffect(() => {
    let active = true
    async function loadDiscovery() {
      setLoading(true); setLoadError('')
      try {
        let [doctorRows, slotRows] = await Promise.all([presentationRepository.listDoctors(), presentationRepository.listAvailabilitySlots()])
        if (!active) return
        setDoctors(doctorRows); setSlots(slotRows)
        // Fixture doctors use the fixture hospital collection. Real doctors
        // carry a safe directory label mapped from providers.service_area.
        if (doctorRows.some((doctor) => doctor.isSynthetic)) {
          try { const hospitalRows = await presentationRepository.listHospitals(); if (active) setHospitals(hospitalRows) } catch { if (active) setHospitals([]) }
        }
      } catch {
        if (active) setLoadError('Unable to load providers right now. Please try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadDiscovery()
    return () => { active = false }
  }, [loadVersion])
  const specialties = useMemo(() => ['All', ...new Set(doctors.map((doctor) => doctor.specialty))], [doctors])
  const visible = doctors.filter((doctor) => (specialty === 'All' || doctor.specialty === specialty) && `${doctor.displayName} ${doctor.specialty}`.toLowerCase().includes(query.toLowerCase()))
  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId)
  const hospitalFor = (doctor) => hospitals.find((hospital) => hospital.id === doctor.hospitalId)?.name ?? doctor.hospitalName ?? 'Independent provider'
  const availableFor = (doctor) => slots.filter((slot) => slot.doctorId === doctor.id && slot.status === 'available' && new Date(slot.startsAt) > new Date()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))

  if (loading) return <section><h1>Book Care</h1><p role="status">Loading providers…</p></section>
  if (loadError) return <section className="card empty-state"><h1>Providers unavailable</h1><p role="alert">{loadError}</p><button className="button button--secondary" type="button" onClick={() => setLoadVersion(value => value + 1)}>Try again</button></section>
  if (doctorId && !selectedDoctor) return <section className="card empty-state"><h1>Doctor not found</h1><Link className="button button--secondary" to="/doctors">Back to Book Care</Link></section>
  if (selectedDoctor) return <DoctorDetails key={`${auth.user?.id}:${auth.patient?.id}:${selectedDoctor.id}`} doctor={selectedDoctor} photoIndex={doctors.findIndex((item) => item.id === selectedDoctor.id)} hospital={hospitalFor(selectedDoctor)} slots={availableFor(selectedDoctor)} startBooking={searchParams.get('book') === '1'} onBooked={() => navigate('/appointments')} />

  return <section className="discovery-page">
    {care.draft && <p>Care for: Self · {care.draft.intent} <Link to="/dashboard" onClick={care.clear}>Cancel care request</Link></p>}
    <header className="page-heading"><div><span className="eyebrow">Find care</span><h1>Book Care</h1><p>Choose a verified provider and available appointment time.</p></div></header>
    <div className="doctor-tools card"><label className="search-control"><Search aria-hidden="true" /><span className="sr-only">Search by name or specialty</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or specialty…" /></label></div>
    <div className="filter-row" aria-label="Specialty filters">{specialties.map((item) => <button className={`filter-chip${specialty === item ? ' active' : ''}`} type="button" key={item} onClick={() => setSpecialty(item)}>{item === 'All' ? 'All Specialties' : item}</button>)}</div>
    <div className="doctor-list">{visible.map((doctor) => {
      const next = availableFor(doctor)[0]
      const photoIndex = doctors.findIndex((item) => item.id === doctor.id)
      const description = `${doctor.specialty} specialist with ${doctor.experienceYears ?? 'extensive'} years of clinical experience.`
      return <article className="doctor-card card" key={doctor.id}>
        <div className="doctor-card-head">
          <div className="doctor-avatar doctor-photo" role="img" aria-label={`Portrait of ${doctor.displayName}`} style={{ '--photo-x': `${(photoIndex % 5) * 25}%`, '--photo-y': photoIndex >= 5 ? '100%' : '0%' }} />
          <div className="doctor-summary"><Link to={`/doctors/${doctor.id}`}><h2>{doctor.displayName}</h2></Link><strong>{doctor.specialty}</strong><span><MapPin aria-hidden="true" /> {hospitalFor(doctor)}</span></div>
          <span className="doctor-rating"><Star aria-hidden="true" /> {doctor.rating ?? 'New'}</span>
        </div>
        <p className="doctor-description">{description}</p>
        <div className="doctor-experience"><strong>{doctor.experienceYears ?? '—'}</strong><span>Years experience</span></div>
        <div className="doctor-card-footer"><strong className="doctor-fee">{formatMmk(doctor.consultationFeeMmk)}</strong><div className="doctor-card-actions"><Link className="doctor-profile-button" to={`/doctors/${doctor.id}`}>View Profile</Link><Link className="doctor-book-button" aria-disabled={!next} to={next ? `/doctors/${doctor.id}?book=1` : `/doctors/${doctor.id}`}>{next ? 'Book' : 'Profile'}</Link></div></div>
      </article>
    })}</div>
    {!visible.length && <div className="card empty-state"><Search aria-hidden="true" /><h2>{doctors.length ? 'No providers match' : 'No providers available'}</h2><p>{doctors.length ? 'Try a different name or specialty.' : 'No eligible providers are available to book right now. Please check back later.'}</p></div>}
  </section>
}

function DoctorDetails({ doctor, photoIndex, hospital, slots: initialSlots, startBooking, onBooked }) {
  const { draft } = useOneTapCare()
  const [booking, setBooking] = useState(startBooking)
  const [slots, setSlots] = useState(initialSlots)
  const bookingPanelRef = useRef(null)
  useEffect(() => {
    if (!booking) return undefined
    const frame = requestAnimationFrame(() => {
      bookingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      bookingPanelRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [booking])
  return <section className="doctor-detail-page"><Link className="back-link" to="/doctors"><ChevronLeft aria-hidden="true" /> Back to Book Care</Link>
    <article className="profile-card card"><div className="doctor-avatar doctor-avatar--large doctor-photo" role="img" aria-label={`Portrait of ${doctor.displayName}`} style={{ '--photo-x': `${(photoIndex % 5) * 25}%`, '--photo-y': photoIndex >= 5 ? '100%' : '0%' }} /><div><span className="eyebrow">Verified provider</span><h1>{doctor.displayName}</h1><p className="profile-specialty">{doctor.specialty} · <Star aria-hidden="true" /> {doctor.rating ?? 'New'}</p><p>{doctor.qualification}</p></div><button type="button" className="button button--primary" disabled={!slots.length} aria-describedby={!slots.length ? 'no-provider-slots' : undefined} onClick={() => setBooking(true)}>Book appointment</button></article>
    {!slots.length && <p id="no-provider-slots" role="status">No available appointment times</p>}
    {draft && <aside className="card care-context-summary" aria-label="Your care request"><strong>Care for: Self · {draft.intent}</strong>{draft.note && <p>Patient note: {draft.note}</p>}</aside>}
    {booking && slots.length > 0 && <div ref={bookingPanelRef} tabIndex="-1" className="booking-panel-anchor"><BookingForm doctor={doctor} slots={slots} onConflictRefresh={async () => { const fresh = (await presentationRepository.listAvailabilitySlots({ doctorId: doctor.id })).filter((slot) => slot.status === 'available' && new Date(slot.startsAt) > new Date()); setSlots(fresh); return fresh }} onCancel={() => setBooking(false)} onBooked={onBooked} /></div>}
    <div className="profile-grid"><article className="card info-card"><h2>Profile details</h2><dl><div><dt>Hospital</dt><dd>{hospital}</dd></div><div><dt>Qualification</dt><dd>{doctor.qualification}</dd></div><div><dt>Experience</dt><dd>{doctor.experienceYears ?? '—'} years</dd></div>{doctor.contactEmail && <div><dt>Test email</dt><dd>{doctor.contactEmail}</dd></div>}<div><dt>Fee</dt><dd>{formatMmk(doctor.consultationFeeMmk)}</dd></div></dl></article><article className="card info-card"><h2>Consultation types</h2><div className="type-badges">{doctor.consultationTypes.map((type) => <span key={type}>{TYPE_LABELS[type]}</span>)}</div><h2>Next available</h2><p>{slots[0] ? formatPresentationDateTime(slots[0].startsAt) : 'No future times available.'}</p></article></div>
  </section>
}

export function BookingForm({ doctor, slots, onConflictRefresh, onCancel, onBooked }) {
  const { patient, status: authStatus } = useAuth()
  const { draft, clear } = useOneTapCare()
  const [review, setReview] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [bookedIntent, setBookedIntent] = useState(null)
  const requestCode = useRef(createBookingCode())
  const submittingRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const [type, setType] = useState(doctor.consultationTypes[0])
  const [slotId, setSlotId] = useState('')
  const [symptoms, setSymptoms] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('presentation_card')
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKey = useRef(createIdempotencyKey())
  const patientLoading = authStatus === 'loading'
  const patientUnavailable = !patientLoading && !patient?.id
  const typeSlots = slots.filter((slot) => isSlotCompatible(slot, type))
  const composed = composeBookingReason(draft, symptoms)
  const chosenSlot = slots.find((slot) => slot.id === slotId)
  const changeType = (nextType) => { setType(nextType); if (!isSlotCompatible(chosenSlot, nextType)) setSlotId(''); setError('') }
  const submit = async (event) => {
    event.preventDefault(); if (submittingRef.current || uncertain) return
    submittingRef.current = true
    setError(''); setSubmitting(true)
    let attempted = false
    try {
      const reason = bookingReason(draft, symptoms)
      validateBooking({ doctor, patientId: patient?.id, slot: chosenSlot, consultationType: type, paymentMethod, symptoms: reason })
      if (!review) { setReview(true); return }
      attempted = true
      const appointment = await presentationRepository.createAppointment({ bookingCode: requestCode.current, idempotencyKey: idempotencyKey.current, patientId: patient.id, doctorId: doctor.id, slotId, startsAt: chosenSlot.startsAt, endsAt: chosenSlot.endsAt, consultationType: type, symptoms: reason, paymentMethod, feeMmk: doctor.consultationFeeMmk })
      if (!alive.current) return
      setBookedIntent(draft?.intent)
      setConfirmation(appointment)
      clear()
    } catch (cause) {
      if (!alive.current) return
      if (cause instanceof BookingConflictError || cause?.code === 'SLOT_CONFLICT') { setReview(false); setSlotId(''); try { await onConflictRefresh() } catch {} }
      else if (attempted) {
        setUncertain(true)
        try {
          const rows = await presentationRepository.listAppointments({ patientId: patient.id })
          const found = rows.find(row => row.patientId === patient.id && row.bookingCode === requestCode.current)
          if (!alive.current) return
          if (found) { setBookedIntent(draft?.intent); setConfirmation(found); clear(); return }
        } catch {}
        if (!alive.current) return
        setError('We could not verify whether your booking was received. Check My Appointments before trying again.'); return
      }
      if (alive.current) setError(cause.message)
    } finally { submittingRef.current = false; if (alive.current) setSubmitting(false) }
  }
  if (confirmation) return <section className="booking-panel card confirmation" role="status"><CalendarClock aria-hidden="true" /><h2>{confirmation.status === 'confirmed' ? 'Appointment confirmed' : 'Booking request received'}</h2><p>Status: {confirmation.status?.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase())}</p><p>Booking code</p><strong className="booking-code">{confirmation.bookingCode}</strong><p>{confirmation.doctor?.displayName || doctor.displayName} · {confirmation.doctor?.specialty || doctor.specialty} · {formatPresentationDateTime(confirmation.scheduledAt)} · {TYPE_LABELS[confirmation.consultationType]}</p><p>Price: {formatMmk(confirmation.feeMmk)}</p>{bookedIntent && <p>Care request: {bookedIntent}</p>}<button className="button button--primary" type="button" onClick={onBooked}>View My Appointments</button><Link className="button button--secondary" to="/dashboard">Return to Dashboard</Link></section>
  if (review) return <section className="booking-panel card" style={{ overflowWrap: 'anywhere', minWidth: 0 }}><h2>Review your booking request</h2><p>Patient: Self · {patient?.full_name}</p><p>Doctor: {doctor.displayName}</p><p>{TYPE_LABELS[type]} · {formatPresentationDateTime(chosenSlot.startsAt)}</p><p>Care intent: {draft?.intent || 'Not selected'}</p>{draft?.note && <p>Patient note: {draft.note}</p>}{symptoms.trim() && <p>Additional booking reason: {symptoms.trim()}</p>}<p>Estimated fee: {formatMmk(doctor.consultationFeeMmk)} · The final appointment price is set when your booking is received.</p><p>{PAYMENT_NOTICE}</p>{error && <p role="alert">{error}</p>}{uncertain ? <Link to="/appointments">Check My Appointments</Link> : <><button className="button button--secondary" disabled={submitting} onClick={() => setReview(false)}>Back</button><button className="button button--primary" disabled={submitting} onClick={submit}>{submitting ? 'Submitting…' : 'Confirm booking'}</button></>}</section>
  return <section className="booking-panel card" style={{ overflowWrap: 'anywhere', minWidth: 0 }} aria-labelledby="booking-title"><div className="booking-heading"><div><span className="eyebrow">Secure your time</span><h2 id="booking-title">Book with {doctor.displayName}</h2></div><button className="button button--secondary" type="button" onClick={() => { clear(); onCancel() }}>Close</button></div>
    <form className="booking-form" onSubmit={submit}>
      <fieldset><legend>1. Consultation type</legend><div className="type-options">{doctor.consultationTypes.map((item) => { const Icon = TYPE_ICONS[item]; return <button key={item} className={type === item ? 'active' : ''} type="button" aria-pressed={type === item} onClick={() => changeType(item)}><Icon aria-hidden="true" /><strong>{TYPE_LABELS[item]}</strong><small>{item === 'home_visit' ? 'Doctor visits your registered address' : 'Remote consultation'}</small></button> })}</div></fieldset>
      {type === 'home_visit' && <div className="home-visit-note"><House aria-hidden="true" /><span>Home visits use a longer visit window and the registered patient address. Waiting-room links and remote device checks do not apply.</span></div>}
      <div className="booking-grid"><label>Patient<div className="form-control" role="status" aria-live="polite">{patientLoading ? 'Loading patient…' : patient?.full_name ?? 'Unable to load your patient account.'}</div></label><label>Available date and time<select aria-label="Available date and time" className="form-control" value={slotId} onChange={(event) => { setSlotId(event.target.value); setError('') }}><option value="">Choose an available time</option>{typeSlots.map((slot) => <option value={slot.id} key={slot.id}>{formatPresentationDateTime(slot.startsAt)}</option>)}</select></label></div>
      {patientUnavailable && <div className="error-message" role="alert">Unable to load your patient account.</div>}
      {!typeSlots.length && <p className="slot-warning">No future {TYPE_LABELS[type].toLowerCase()} times are currently available. Choose another consultation type.</p>}
      <label>Reason for Visit/Symptoms <span className="muted">(optional)</span><textarea className="form-control" rows="3" maxLength="2000" value={symptoms} onChange={(event) => setSymptoms(event.target.value)} placeholder="Briefly describe what you would like to discuss" /></label>
      <label>Simulated payment method<select className="form-control" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="presentation_card">Demo card</option><option value="presentation_wallet">Demo wallet</option><option value="not_required">No payment required (demo)</option></select></label>
      <div className="payment-notice"><strong>{PAYMENT_NOTICE}</strong></div>
      <div className="fee-summary"><span>Current provider fee (estimate)</span><strong>{formatMmk(doctor.consultationFeeMmk)}</strong><span>Demo processing fee</span><strong>0 MMK</strong><span className="fee-total">Estimated total</span><strong className="fee-total">{formatMmk(doctor.consultationFeeMmk)}</strong></div>
      <p aria-live="polite">Care request and booking reason: {composed.length} / 2,000 characters. All text is preserved; shorten it if over the limit.</p>{!composed.valid && <p role="alert">Please shorten your additional reason or care note before reviewing.</p>}
      {error && <div className="error-message" role="alert">{error}</div>}
      <button className="button button--primary booking-submit" type="submit" disabled={submitting || !slotId || !patient?.id || !composed.valid}>{submitting ? 'Preparing…' : 'Review booking'}</button>
    </form>
  </section>
}
