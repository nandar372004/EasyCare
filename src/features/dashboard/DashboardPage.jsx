import { useEffect, useState } from 'react'
import { Bot, CalendarDays, CalendarClock, CheckCircle2, HeartPulse, Pill, ShieldCheck, Stethoscope, Video } from 'lucide-react'
import { Link } from 'react-router-dom'
import { presentationRepository } from '../../services/repositories/index.js'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { healthOverview } from '../health/healthPresentationData.js'

export function DashboardPage() {
  const auth = useAuth()
  const [nextAppointment, setNextAppointment] = useState(null)
  const [doctor, setDoctor] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [careEvents, setCareEvents] = useState([])
  const [dashboardStatus, setDashboardStatus] = useState('loading')
  const [medications, setMedications] = useState([])
  const [medicationStatus, setMedicationStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    setDashboardStatus('loading')
    Promise.all([
      presentationRepository.listAppointments(),
      presentationRepository.listDoctors(),
    ])
      .then(async ([appointments, doctors]) => {
        if (cancelled) return
        const next = appointments
          .filter((item) => ['pending', 'confirmed', 'checked_in', 'in_progress'].includes(item.status) && new Date(item.scheduledAt) > new Date())
          .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0]
        setNextAppointment(next ?? null)
        setDoctor(doctors.find((item) => item.id === next?.doctorId) ?? null)
        setSuggestions(doctors.slice(0, 3))

        const events = next ? await presentationRepository.listAppointmentEvents(next.id) : []
        setCareEvents(events.slice(0, 4))
        setDashboardStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setDashboardStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!auth.patient?.id) { setMedicationStatus(auth.status === 'loading' ? 'loading' : 'error'); return undefined }
    setMedicationStatus('loading')
    presentationRepository.listMedications(auth.patient.id)
      .then((rows) => { if (!cancelled) { setMedications(rows); setMedicationStatus('ready') } })
      .catch(() => { if (!cancelled) { setMedications([]); setMedicationStatus('error') } })
    return () => { cancelled = true }
  }, [auth.patient?.id, auth.status])

  const greetingName = auth.patient?.full_name ?? 'EasyCare Patient'
  const appointmentDate = nextAppointment ? new Date(nextAppointment.scheduledAt) : null
  const appointmentMonth = appointmentDate?.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Yangon' })
  const appointmentDay = appointmentDate?.toLocaleDateString('en-US', { day: '2-digit', timeZone: 'Asia/Yangon' })
  const appointmentWeekday = appointmentDate?.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Yangon' })
  const activeMedications = medications.filter((item) => item.status === 'active').slice(0, 3)

  return (
    <div className="dashboard-page phase11-dashboard">
      <h1 className="sr-only">Welcome to MediBridge AI</h1>
      {dashboardStatus === 'loading' && (
        <div className="dashboard-state" role="status">
          <span className="loading-spinner" aria-hidden="true" />Loading your dashboard…
        </div>
      )}

      {/* Patient Hero + Health Overview */}
      <section className="dashboard-hero-section">
        <div className="card dashboard-hero">
          <div className="dashboard-hero-copy">
            <span className="eyebrow">Your care, connected</span>
            <h1>Welcome back, {greetingName} <span aria-hidden="true">👋</span></h1>
            <p>Your care, connected.</p>
            <p className="dashboard-hero-supporting">Stay on top of appointments, medications, health information, and everyday care.</p>
            <div className="dashboard-hero-actions">
              <Link className="button button--primary" to="/doctors">
                <CalendarDays aria-hidden="true" /> Book Care
              </Link>
              <Link className="button button--secondary" to="/health-guardian">
                <Bot aria-hidden="true" /> AI Health Guidance
              </Link>
            </div>
          </div>
          <div className="dashboard-hero-visual" aria-hidden="true">
            <img className="hero-doctor" src="/dashboard-doctors.png" alt="" />
          </div>
        </div>
        <article className="card dashboard-health-status">
          <h2>Health Overview</h2>
          <div className="health-status-grid">
            <div>
              <span className="health-status-label">Blood Type</span>
              <span className="health-status-value">{healthOverview.bloodType}</span>
            </div>
            <div>
              <span className="health-status-label">Allergies</span>
              <span className="health-status-value">{healthOverview.allergies[0]}</span>
            </div>
            <div>
              <span className="health-status-label">Conditions</span>
              <span className="health-status-value">{healthOverview.conditions[0]}</span>
            </div>
            <div>
              <span className="health-status-label">Last Check-up</span>
              <span className="health-status-value">{healthOverview.lastCheckup ? new Date(healthOverview.lastCheckup).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Yangon' }) : 'Not recorded'}</span>
            </div>
          </div>
          <Link className="text-link" to="/health-records">View Health Records</Link>
        </article>
      </section>

      {/* Quick Care Actions */}
      <section className="dashboard-quick-actions" aria-label="Quick care actions">
        <Link className="card quick-action-card" to="/doctors">
          <span><Stethoscope aria-hidden="true" /></span>
          <div>
            <strong>Doctor Consultation</strong>
            <small>Find and consult with a doctor</small>
          </div>
        </Link>
        <Link className="card quick-action-card" to="/appointments">
          <span><CalendarClock aria-hidden="true" /></span>
          <div>
            <strong>Appointments</strong>
            <small>View and manage your appointments</small>
          </div>
        </Link>
        <Link className="card quick-action-card" to="/care-plan">
          <span><ShieldCheck aria-hidden="true" /></span>
          <div>
            <strong>Care Plan</strong>
            <small>Manage your healthcare plan</small>
          </div>
        </Link>
        <Link className="card quick-action-card" to="/health-guardian">
          <span><Bot aria-hidden="true" /></span>
          <div>
            <strong>AI Health Guidance</strong>
            <small>Get AI-assisted health guidance</small>
          </div>
        </Link>
      </section>

      {/* Main Care Row */}
      <section className="dashboard-main-grid">
        {/* Upcoming Appointment */}
        <article className="card dashboard-appointment">
          <div className="section-title">
            <h2>Upcoming Appointment</h2>
            <Link to="/appointments">View All</Link>
          </div>
          {nextAppointment ? (
            <>
              <div className="dashboard-appointment-body">
                <time className="dashboard-date-tile" dateTime={nextAppointment.scheduledAt}>
                  <span>{appointmentMonth}</span>
                  <strong>{appointmentDay}</strong>
                  <small>{appointmentWeekday}</small>
                </time>
                <span className="doctor-avatar doctor-photo dashboard-doctor-photo" aria-hidden="true" />
                <div className="dashboard-appointment-details">
                  <strong>{doctor?.displayName ?? 'Verified doctor'}</strong>
                  <span>{doctor?.specialty ?? 'Healthcare provider'}</span>
                  <span>
                    <Video aria-hidden="true" />
                    {formatPresentationDateTime(nextAppointment.scheduledAt)} · {nextAppointment.consultationType}
                  </span>
                </div>
                <span className={`status-badge status-${nextAppointment.status}`}>{nextAppointment.status}</span>
              </div>
              <Link className="button button--primary" to={`/appointments/${nextAppointment.id}`}>View Appointment</Link>
            </>
          ) : (
            <div className="dashboard-empty">
              <p>No upcoming appointment.</p>
              <Link className="text-link" to="/doctors">Find a doctor</Link>
            </div>
          )}
        </article>

        {/* Care Updates */}
        <article className="card dashboard-care-updates">
          <div className="section-title">
            <h2>Care Updates</h2>
          </div>
          {careEvents.length > 0 ? (
            <ul className="care-updates-list">
              {careEvents.map((event) => (
                <li key={event.id} className="care-update-item">
                  <span className="care-update-icon"><CheckCircle2 aria-hidden="true" /></span>
                  <div>
                    <strong>{formatEventType(event.eventType)}</strong>
                    <small>{new Date(event.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yangon' })}</small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-empty">
              <p>No recent care updates.</p>
            </div>
          )}
        </article>
      </section>

      {/* Medications + Care Coordinator + Care Plan + Health Summary */}
      <section className="dashboard-secondary-grid">
        {/* Medication Today */}
        <article className="card dashboard-medications">
          <div className="section-title">
            <h2>Medication Today</h2>
            <Link to="/medications">View All</Link>
          </div>
          {medicationStatus === 'loading' ? <p role="status">Loading medications…</p> : activeMedications.length > 0 ? (
            <ul className="medication-list">
              {activeMedications.map((item) => (
                <li key={item.id} className="medication-item">
                  <Pill aria-hidden="true" />
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.dosage}{item.frequency ? ` · ${item.frequency}` : ''}</small>
                  </div>
                  <span className="status-badge status-active">Active</span>
                </li>
              ))}
            </ul>
          ) : medicationStatus === 'error' ? <div className="dashboard-empty"><p>Unable to load medications.</p></div> : (
            <div className="dashboard-empty">
              <p>No active medications.</p>
            </div>
          )}
        </article>

        {/* Care Coordinator */}
        <article className="card dashboard-coordinator">
          <div className="section-title">
            <h2>Care Coordinator</h2>
          </div>
          <div className="dashboard-empty">
            <p>No care coordinator is currently assigned.</p>
            <small>Your assigned EasyCare coordinator will appear here when this service becomes available.</small>
          </div>
        </article>

        {/* Care Plan */}
        <article className="card dashboard-care-plan">
          <div className="section-title">
            <h2>Care Plan</h2>
          </div>
          <div className="dashboard-empty">
            <p>No active care plan.</p>
            <Link className="text-link" to="/care-plan">Explore Care Plans</Link>
          </div>
        </article>

        {/* Quick Health Summary */}
        <article className="card dashboard-health-summary">
          <div className="section-title">
            <h2>Quick Health Summary</h2>
            <Link to="/health-records">View Health Records</Link>
          </div>
          <ul className="summary-list">
            <li>
              <HeartPulse aria-hidden="true" />
              <div>
                <strong>Blood Type</strong>
                <span>{healthOverview.bloodType}</span>
              </div>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>Allergies</strong>
                <span>{healthOverview.allergies[0]}</span>
              </div>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              <div>
                <strong>Conditions</strong>
                <span>{healthOverview.conditions[0]}</span>
              </div>
            </li>
          </ul>
        </article>
      </section>

      {/* Recommended Care Providers */}
      <section className="dashboard-providers">
        <div className="section-title">
          <div>
            <h2>Recommended Care Providers</h2>
            <p>Trusted healthcare professionals for your care needs.</p>
          </div>
          <Link to="/doctors">View All</Link>
        </div>
        <div className="providers-list">
          {suggestions.map((item) => (
            <Link className="card provider-card" to={`/doctors/${item.id}`} key={item.id}>
              <span className="doctor-avatar"><Stethoscope aria-hidden="true" /></span>
              <div>
                <strong>{item.displayName}</strong>
                <small>{item.specialty}</small>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function formatEventType(eventType) {
  switch (eventType) {
    case 'appointment_created':
      return 'Appointment created'
    case 'appointment_rescheduled':
      return 'Appointment rescheduled'
    case 'appointment_cancelled':
      return 'Appointment cancelled'
    case 'status_changed':
      return 'Status updated'
    default:
      return eventType
  }
}
