import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronLeft, House, MapPin, Phone, Search, Star, Stethoscope, Video } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { presentationRepository } from '../../services/repositories/index.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { BookingConflictError, createIdempotencyKey, createBookingCode, isSlotCompatible, PAYMENT_NOTICE, validateBooking } from '../../services/bookingService.js'
import { useAuth } from '../auth/AuthContext.jsx'

const TYPE_LABELS = { video: 'Video', voice: 'Voice', chat: 'Chat', home_visit: 'Home visit' }
const TYPE_ICONS = { video: Video, voice: Phone, home_visit: House }

export function DoctorsPage() {
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
        if (active) setLoadError('Unable to load doctors right now. Check the Supabase connection or try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadDiscovery()
    return () => { active = false }
  }, [])
  const specialties = useMemo(() => ['All', ...new Set(doctors.map((doctor) => doctor.specialty))], [doctors])
  const visible = doctors.filter((doctor) => (specialty === 'All' || doctor.specialty === specialty) && `${doctor.displayName} ${doctor.specialty}`.toLowerCase().includes(query.toLowerCase()))
  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId)
  const hospitalFor = (doctor) => hospitals.find((hospital) => hospital.id === doctor.hospitalId)?.name ?? doctor.hospitalName ?? 'Independent provider'
  const availableFor = (doctor) => slots.filter((slot) => slot.doctorId === doctor.id && slot.status === 'available' && new Date(slot.startsAt) > new Date()).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))

  if (loading) return <section><h1>Doctors</h1><p role="status">Loading doctors…</p></section>
  if (loadError) return <section className="card empty-state"><h1>Doctors unavailable</h1><p role="alert">{loadError}</p><button className="button button--secondary" type="button" onClick={() => window.location.reload()}>Try again</button></section>
  if (doctorId && !selectedDoctor) return <section className="card empty-state"><h1>Doctor not found</h1><Link className="button button--secondary" to="/doctors">Back to Doctors</Link></section>
  if (selectedDoctor) return <DoctorDetails doctor={selectedDoctor} photoIndex={doctors.findIndex((item) => item.id === selectedDoctor.id)} hospital={hospitalFor(selectedDoctor)} slots={availableFor(selectedDoctor)} startBooking={searchParams.get('book') === '1'} onBooked={() => navigate('/appointments')} />

  return <section className="discovery-page">
    <header className="page-heading"><div><span className="eyebrow">Find care</span><h1>Doctors</h1><p>Search and book with verified presentation providers.</p></div></header>
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
    {!visible.length && <div className="card empty-state"><Search aria-hidden="true" /><h2>No doctors match</h2><p>Try a different name or specialty.</p></div>}
  </section>
}

function DoctorDetails({ doctor, photoIndex, hospital, slots: initialSlots, startBooking, onBooked }) {
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
  return <section className="doctor-detail-page"><Link className="back-link" to="/doctors"><ChevronLeft aria-hidden="true" /> Back to Doctors</Link>
    <article className="profile-card card"><div className="doctor-avatar doctor-avatar--large doctor-photo" role="img" aria-label={`Portrait of ${doctor.displayName}`} style={{ '--photo-x': `${(photoIndex % 5) * 25}%`, '--photo-y': photoIndex >= 5 ? '100%' : '0%' }} /><div><span className="eyebrow">Verified provider</span><h1>{doctor.displayName}</h1><p className="profile-specialty">{doctor.specialty} · <Star aria-hidden="true" /> {doctor.rating ?? 'New'}</p><p>{doctor.qualification}</p></div><button type="button" className="button button--primary" onClick={() => setBooking(true)}>Book appointment</button></article>
    {booking && <div ref={bookingPanelRef} tabIndex="-1" className="booking-panel-anchor"><BookingForm doctor={doctor} slots={slots} onConflictRefresh={async () => { const fresh = (await presentationRepository.listAvailabilitySlots({ doctorId: doctor.id })).filter((slot) => slot.status === 'available' && new Date(slot.startsAt) > new Date()); setSlots(fresh); return fresh }} onCancel={() => setBooking(false)} onBooked={onBooked} /></div>}
    <div className="profile-grid"><article className="card info-card"><h2>Profile details</h2><dl><div><dt>Hospital</dt><dd>{hospital}</dd></div><div><dt>Qualification</dt><dd>{doctor.qualification}</dd></div><div><dt>Experience</dt><dd>{doctor.experienceYears ?? '—'} years</dd></div>{doctor.contactEmail && <div><dt>Test email</dt><dd>{doctor.contactEmail}</dd></div>}<div><dt>Fee</dt><dd>{formatMmk(doctor.consultationFeeMmk)}</dd></div></dl></article><article className="card info-card"><h2>Consultation types</h2><div className="type-badges">{doctor.consultationTypes.map((type) => <span key={type}>{TYPE_LABELS[type]}</span>)}</div><h2>Next available</h2><p>{slots[0] ? formatPresentationDateTime(slots[0].startsAt) : 'No future times available.'}</p></article></div>
  </section>
}

function BookingForm({ doctor, slots, onConflictRefresh, onCancel, onBooked }) {
  const { patient, status: authStatus } = useAuth()
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
  const chosenSlot = slots.find((slot) => slot.id === slotId)
  const changeType = (nextType) => { setType(nextType); if (!isSlotCompatible(chosenSlot, nextType)) setSlotId(''); setError('') }
  const submit = async (event) => {
    event.preventDefault(); if (submitting) return
    setError(''); setSubmitting(true)
    try {
      validateBooking({ doctor, patientId: patient?.id, slot: chosenSlot, consultationType: type, paymentMethod, symptoms })
      const appointment = await presentationRepository.createAppointment({ bookingCode: createBookingCode(), idempotencyKey: idempotencyKey.current, patientId: patient.id, doctorId: doctor.id, slotId, startsAt: chosenSlot.startsAt, endsAt: chosenSlot.endsAt, consultationType: type, symptoms, paymentMethod, feeMmk: doctor.consultationFeeMmk })
      setConfirmation(appointment)
    } catch (cause) {
      if (cause instanceof BookingConflictError || cause?.code === 'SLOT_CONFLICT') { await onConflictRefresh(); setSlotId('') }
      setError(cause.message)
    } finally { setSubmitting(false) }
  }
  if (confirmation) return <section className="booking-panel card confirmation" role="status"><CalendarClock aria-hidden="true" /><span className="eyebrow">Booking confirmed</span><h2>Your appointment is booked</h2><p>Booking code</p><strong className="booking-code">{confirmation.bookingCode}</strong><p>{formatPresentationDateTime(confirmation.scheduledAt)} · {TYPE_LABELS[confirmation.consultationType]}</p><button className="button button--primary" type="button" onClick={onBooked}>View appointments</button></section>
  return <section className="booking-panel card" aria-labelledby="booking-title"><div className="booking-heading"><div><span className="eyebrow">Secure your time</span><h2 id="booking-title">Book with {doctor.displayName}</h2></div><button className="button button--secondary" type="button" onClick={onCancel}>Close</button></div>
    <form className="booking-form" onSubmit={submit}>
      <fieldset><legend>1. Consultation type</legend><div className="type-options">{doctor.consultationTypes.map((item) => { const Icon = TYPE_ICONS[item]; return <button key={item} className={type === item ? 'active' : ''} type="button" onClick={() => changeType(item)}><Icon aria-hidden="true" /><strong>{TYPE_LABELS[item]}</strong><small>{item === 'home_visit' ? 'Doctor visits your registered address' : 'Remote consultation'}</small></button> })}</div></fieldset>
      {type === 'home_visit' && <div className="home-visit-note"><House aria-hidden="true" /><span>Home visits use a longer visit window and the registered patient address. Waiting-room links and remote device checks do not apply.</span></div>}
      <div className="booking-grid"><label>Patient<div className="form-control" role="status" aria-live="polite">{patientLoading ? 'Loading patient…' : patient?.full_name ?? 'Unable to load your patient account.'}</div></label><label>Available date and time<select aria-label="Available date and time" className="form-control" value={slotId} onChange={(event) => { setSlotId(event.target.value); setError('') }}><option value="">Choose an available time</option>{typeSlots.map((slot) => <option value={slot.id} key={slot.id}>{formatPresentationDateTime(slot.startsAt)}</option>)}</select></label></div>
      {patientUnavailable && <div className="error-message" role="alert">Unable to load your patient account.</div>}
      {!typeSlots.length && <p className="slot-warning">No future {TYPE_LABELS[type].toLowerCase()} times are currently available. Choose another consultation type.</p>}
      <label>Reason for Visit/Symptoms <span className="muted">(optional)</span><textarea className="form-control" rows="3" maxLength="2000" value={symptoms} onChange={(event) => setSymptoms(event.target.value)} placeholder="Briefly describe what you would like to discuss" /></label>
      <label>Simulated payment method<select className="form-control" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="presentation_card">Demo card</option><option value="presentation_wallet">Demo wallet</option><option value="not_required">No payment required (demo)</option></select></label>
      <div className="payment-notice"><strong>{PAYMENT_NOTICE}</strong></div>
      <div className="fee-summary"><span>Consultation fee</span><strong>{formatMmk(doctor.consultationFeeMmk)}</strong><span>Demo processing fee</span><strong>0 MMK</strong><span className="fee-total">Total</span><strong className="fee-total">{formatMmk(doctor.consultationFeeMmk)}</strong></div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <button className="button button--primary booking-submit" type="submit" disabled={submitting || !slotId || !patient?.id}>{submitting ? 'Confirming…' : 'Confirm booking'}</button>
    </form>
  </section>
}
