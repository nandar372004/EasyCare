import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Camera, CheckCircle2, Clock3, Headphones, MessageSquare, Mic, Phone, ShieldCheck, Users, Video, Wifi } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { presentationRepository } from '../../services/repositories/index.js'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { CONSULTATION_DEMO_NOTICE, getConsultationEligibility, getCountdown, getDeterministicQueue, SYNTHETIC_CONSULTATION_SUMMARIES } from './consultationDemo.js'

const MODE_LABELS = { video: 'Video consultation', voice: 'Voice consultation', chat: 'Chat consultation' }
const MODE_ICONS = { video: Video, voice: Phone, chat: MessageSquare }
const readiness = [
  { label: 'Camera', detail: 'Demo ready — no camera accessed', icon: Camera },
  { label: 'Microphone', detail: 'Demo ready — no microphone accessed', icon: Mic },
  { label: 'Speaker', detail: 'Demo ready — no audio played', icon: Headphones },
  { label: 'Network', detail: 'Browser connection available', icon: Wifi },
]

export function WaitingRoomGate() {
  const { id } = useParams()
  const [appointment, setAppointment] = useState(undefined)
  const [doctor, setDoctor] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [stage, setStage] = useState('ready')

  useEffect(() => {
    let active = true
    async function load() {
      const item = await presentationRepository.getAppointment(id)
      if (!active) return
      setAppointment(item)
      if (item) setDoctor(await presentationRepository.getDoctor(item.doctorId))
    }
    void load()
    return () => { active = false }
  }, [id])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const eligibility = getConsultationEligibility(appointment, now)
  const countdown = getCountdown(appointment?.scheduledAt ?? now, now)
  const queue = useMemo(() => getDeterministicQueue(id), [id])
  const ModeIcon = MODE_ICONS[appointment?.consultationType] ?? Video

  if (appointment === undefined) return <section><h1>Consultation Waiting Room</h1><p role="status">Checking appointment access…</p></section>
  if (!eligibility.eligible) return <section className="card waiting-denied"><ShieldCheck aria-hidden="true" /><span className="eyebrow">Access checked</span><h1>Waiting room unavailable</h1><p>{eligibility.reason}</p><div className="demo-warning"><strong>{CONSULTATION_DEMO_NOTICE}</strong><span>No camera, microphone, recording, or live connection was started.</span></div><Link className="button button--secondary" to={appointment ? `/appointments/${appointment.id}` : '/appointments'}>Back to appointments</Link></section>

  return <section className="consultation-page">
    <div className="consultation-demo-notice" role="note"><ShieldCheck aria-hidden="true" /><strong>{CONSULTATION_DEMO_NOTICE}</strong></div>
    <header className="page-heading"><div><span className="eyebrow">Eligible appointment</span><h1>Consultation Waiting Room</h1><p>Review your appointment and demo readiness before entering the simulated queue.</p></div><Link className="button button--secondary" to={`/appointments/${appointment.id}`}>Appointment details</Link></header>

    <div className="waiting-layout">
      <div className="waiting-main">
        <article className="card upcoming-consultation"><div className="consultation-date"><CalendarDays aria-hidden="true" /><strong>{formatPresentationDateTime(appointment.scheduledAt)}</strong></div><div className="consultation-doctor"><span className="doctor-avatar doctor-photo" aria-hidden="true" /><div><h2>{doctor?.displayName ?? 'Verified doctor'}</h2><p>{doctor?.specialty ?? 'Healthcare provider'}</p><span><ModeIcon aria-hidden="true" /> {MODE_LABELS[appointment.consultationType]}</span></div></div><span className={`status-badge status-${appointment.status}`}>{appointment.status}</span></article>

        <article className="card countdown-card"><div><span className="eyebrow">Starts in</span><h2>Appointment countdown</h2></div><div className="countdown" aria-label={`${countdown.days} days ${countdown.hours} hours ${countdown.minutes} minutes ${countdown.seconds} seconds`}><TimeUnit value={countdown.days} label="Days" /><TimeUnit value={countdown.hours} label="Hours" /><TimeUnit value={countdown.minutes} label="Minutes" /><TimeUnit value={countdown.seconds} label="Seconds" /></div></article>

        <article className="card readiness-card"><div><span className="eyebrow">Presentation indicators</span><h2>Device readiness</h2><p>These indicators are simulated. The app does not request device permissions or record anything.</p></div><div className="readiness-grid">{readiness.map(({ label, detail, icon: Icon }) => <div className="readiness-item" key={label}><span><Icon aria-hidden="true" /></span><div><strong>{label}</strong><small>{detail}</small></div><CheckCircle2 aria-label="Demo ready" /></div>)}</div></article>
      </div>

      <aside className="card queue-card" aria-label="Waiting room status"><Users aria-hidden="true" /><span className="eyebrow">Waiting room status</span>{stage === 'ready' && <><h2>Ready to enter?</h2><p>Join the deterministic presentation queue when you are ready.</p><button className="button button--primary" type="button" onClick={() => setStage('waiting')}>Join Waiting Room</button></>}{stage === 'waiting' && <><h2>You are in the demo queue</h2><span className="queue-number">{queue.queueNumber}</span><p>Queue number</p><div className="estimated-wait"><Clock3 aria-hidden="true" /><span>Estimated wait time</span><strong>~ {queue.estimatedWaitMinutes} min</strong></div><button className="button button--primary" type="button" onClick={() => setStage('consultation')}>Join Consultation</button><small>A clinician has not joined. Start only when you want to trigger the simulation.</small></>}{stage === 'consultation' && <><Video aria-hidden="true" /><h2>Simulated consultation started</h2><p>You triggered this demo state. No clinician, media stream, or production video service is connected.</p><span className="status-badge status-confirmed">Demo active</span></>}</aside>
    </div>

    <article className="card recent-consultations"><div><span className="eyebrow">Synthetic data</span><h2>Recent consultation summaries</h2></div><div className="recent-list">{SYNTHETIC_CONSULTATION_SUMMARIES.map((summary) => <div className="recent-row" key={summary.id}><div className="recent-date"><CalendarDays aria-hidden="true" /><span>{formatPresentationDateTime(summary.date)}</span></div><div><strong>{summary.doctorName}</strong><small>{summary.specialty} · {summary.mode}</small></div><span>{summary.outcome}</span><span className="status-badge status-completed">{summary.status}</span></div>)}</div></article>
  </section>
}

function TimeUnit({ value, label }) {
  return <span><strong>{String(value).padStart(2, '0')}</strong><small>{label}</small></span>
}
