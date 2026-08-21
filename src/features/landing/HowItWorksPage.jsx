import { Link } from 'react-router-dom'
import {
  ArrowRight, Bell, CalendarCheck, Check, ClipboardList, Headphones, HeartHandshake,
  HeartPulse, Home, ShieldCheck, Smartphone, UsersRound,
} from 'lucide-react'
import { LandingNavbar } from './LandingNavbar.jsx'

const journey = [
  [ClipboardList, 'Tell Us What You Need', "Share your loved one's condition, symptoms or care needs.", 'green', 'family'],
  [UsersRound, 'We Review & Match', 'Our Care Coordinator reviews and matches you with the most suitable healthcare professional.', 'green', 'coordinator'],
  [CalendarCheck, 'Confirm & Schedule', 'Choose a convenient time for home visit or online consultation and confirm your booking.', 'blue', 'schedule'],
  [Home, 'Receive Care', 'Receive quality care at home or online from our verified doctor, nurse or caregiver.', 'violet', 'care'],
  [Smartphone, 'Stay Updated', 'Get real-time updates, visit summaries, and care plans. We are always here to support you.', 'navy', 'updated'],
]

const nextSteps = [
  [UsersRound, 'Care Plan', 'We create a personalized care plan for your loved one.'],
  [Headphones, 'Ongoing Support', 'Your Care Coordinator helps with scheduling, follow-ups and any questions.'],
  [HeartPulse, 'Health Tracking', 'Monitor health, medications and progress through your Family Health Dashboard.'],
  [Bell, 'Alerts & Reminders', 'Get reminders for medications, appointments and important updates.'],
  [ShieldCheck, 'Peace of Mind', 'Trusted care, transparent updates, and family peace of mind—always.'],
]

function JourneyVisual({ type }) {
  if (type === 'coordinator') return <img src="/easycare-care-coordinator.png" alt="Care coordinator reviewing a family's needs" />
  if (type === 'care') return <img src="/easycare-home-care-hero.png" alt="A nurse providing care at home" />
  if (type === 'family') return <img src="/dashboard-doctors.png" alt="A family discussing their care needs" />
  if (type === 'schedule') return <div className="ec-journey-placeholder"><CalendarCheck /><span>Choose a convenient time</span></div>
  return <div className="ec-journey-placeholder"><Smartphone /><span>Care updates delivered</span></div>
}

export function HowItWorksPage() {
  return <main className="ec-page ec-how-page"><LandingNavbar activePage="how-it-works" /><header className="ec-how-header"><h1>How <span>EasyCare</span> Works</h1><p>We make healthcare simple, convenient and reliable for you and your loved ones.<br />Just a few easy steps to get the right care.</p></header><div className="ec-how-content"><section className="ec-journey" aria-label="Five steps to EasyCare">{journey.map(([Icon, title, text, tone, visual], index) => <article className="ec-journey-card" key={title}><b className={`ec-journey-number ec-journey-${tone}`}>{index + 1}</b><span className={`ec-journey-icon ec-journey-icon-${tone}`}><Icon /></span><h2>{title}</h2><p>{text}</p><div className="ec-journey-visual"><JourneyVisual type={visual} /></div>{index < journey.length - 1 && <i className="ec-journey-arrow"><ArrowRight /></i>}</article>)}</section><div className="ec-how-support"><section className="ec-next"><h2>What Happens Next?</h2><div>{nextSteps.map(([Icon, title, text]) => <article key={title}><span><Icon /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section><section className="ec-dedicated"><div><h2>Your Dedicated<br />Care Coordinator</h2><p>One person who understands your family's needs and coordinates every detail of the care journey.</p><ul><li><Check />Understands your needs</li><li><Check />Coordinates the right care</li><li><Check />Keeps your family informed</li></ul></div><img src="/easycare-care-coordinator.png" alt="Dedicated EasyCare coordinator" /></section></div><section className="ec-how-cta"><div><HeartHandshake /><p>Quality care made simple. Because your family deserves the best.</p></div><div><button className="ec-button ec-button-outline" type="button">Talk to Our Team</button><Link className="ec-button ec-button-primary" to="/doctors">Find Care Now <ArrowRight /></Link></div></section></div></main>
}
