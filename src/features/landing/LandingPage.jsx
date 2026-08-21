import { Link } from 'react-router-dom'
import {
  ArrowRight, Bell, BriefcaseMedical, CalendarDays, Check,
  ClipboardList, Headphones, HeartPulse, Home, LockKeyhole, MessageSquare,
  Pill, ShieldCheck, Stethoscope, UserRound, UsersRound, Video,
} from 'lucide-react'
import { Brand } from '../../components/Brand.jsx'
import { LandingNavbar } from './LandingNavbar.jsx'

const services = [
  [BriefcaseMedical, 'Doctor Home Visits', 'Professional doctors come to your home', 'blue'],
  [Stethoscope, 'Nurse Home Care', 'Skilled nursing care in the comfort of home', 'violet'],
  [Video, 'Online Consultation', 'Consult with doctors via secure video call', 'green'],
  [HeartPulse, 'Elderly Care', 'Specialized care for seniors and chronic care', 'coral'],
  [Pill, 'Medication Support', 'Medicine reminders and adherence tracking', 'amber'],
  [Headphones, 'Care Coordinator', 'Dedicated coordinator for your family', 'sky'],
]
const steps = [
  [ClipboardList, 'Tell Us What You Need', "Share your loved one's condition and care needs", 'blue'],
  [Stethoscope, 'We Connect You', 'We match you with the right verified healthcare professional', 'green'],
  [Home, 'Receive Care', 'Care is delivered at home or online as needed', 'violet'],
  [Bell, 'Stay Updated', 'Get real-time updates and alerts on their care', 'amber'],
]
const familyBenefits = ['Upcoming visits and appointments', 'Health updates and alerts', 'Medication tracking and reminders', 'Care reports and progress', 'Easy communication with Care Coordinator']
const coordinatorBenefits = ["Understands your family's needs", 'Coordinates providers and visits', 'Monitors care and follows up', 'Communicates updates and alerts', 'Helps with questions and support']

function scrollTo(id, done) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); done?.() }

function TrustCard() {
  const items = [[ShieldCheck, 'Verified', 'Professionals'], [Home, 'Care', 'at Home'], [UsersRound, 'Family', 'Updates'], [LockKeyhole, 'Secure', 'Health Records']]
  return <div className="ec-trust-card">{items.map(([Icon, a, b]) => <div key={a}><span><Icon /></span><strong>{a}<br />{b}</strong></div>)}</div>
}

function HeroSection() {
  return <section className="ec-hero" id="home"><div className="ec-hero-copy"><h1>Trusted Healthcare,<br />Right at <span>Home</span></h1><p>Connecting your loved ones with verified doctors, nurses and caregivers – at home or online – with support that keeps your family informed.</p><div className="ec-hero-actions"><Link className="ec-button ec-button-primary" to="/doctors">Find Care <ArrowRight /></Link><Link className="ec-button ec-button-outline" to="/doctors">Book a Doctor <CalendarDays /></Link></div><div className="ec-social-proof"><div className="ec-avatars" aria-hidden="true"><span>MM</span><span>TH</span><span>KM</span><span>SU</span></div><div><small>Trusted by 1,000+ families in Mandalay</small><div className="ec-rating"><span>★★★★★</span> 4.8/5</div></div></div></div><div className="ec-hero-photo"><img src="/easycare-home-care-hero.png" alt="A home-care nurse supporting an older woman" /><TrustCard /></div></section>
}

function SectionHeading({ label, title, children }) { return <div className="ec-section-heading"><span>{label}</span><h2>{title}</h2>{children && <p>{children}</p>}</div> }

function ServicesSection() {
  return <section className="ec-section ec-services" id="services"><SectionHeading label="Our Services" title="Care Designed Around Your Family">Comprehensive healthcare services delivered to your loved ones with compassion and professionalism.</SectionHeading><div className="ec-service-grid">{services.map(([Icon, title, text, tone]) => <article className="ec-service-card" key={title}><span className={`ec-icon ec-icon-${tone}`}><Icon /></span><h3>{title}</h3><p>{text}</p><button type="button" onClick={() => scrollTo('contact')}>Learn more <ArrowRight /></button></article>)}</div></section>
}

function HowItWorksSection() {
  return <section className="ec-section ec-how" id="how-it-works"><SectionHeading label="How EasyCare Works" title="Simple Steps, Better Care" /><div className="ec-steps">{steps.map(([Icon, title, text, tone], index) => <article className="ec-step" key={title}><div className={`ec-step-icon ec-icon-${tone}`}><Icon /></div>{index < steps.length - 1 && <div className="ec-step-connector"><ArrowRight /></div>}<h3>{title}</h3><p>{text}</p></article>)}</div></section>
}

function DashboardPreview() {
  const menu = [[Home, 'Dashboard'], [CalendarDays, 'Appointments'], [BriefcaseMedical, 'Home Visits'], [Pill, 'Medications'], [ClipboardList, 'Health Records'], [MessageSquare, 'Messages'], [UserRound, 'Profile']]
  return <div className="ec-dashboard" aria-label="Family dashboard preview"><aside><Brand compact />{menu.map(([Icon, label], i) => <div className={i === 0 ? 'selected' : ''} key={label}><Icon />{label}</div>)}</aside><main><div className="ec-dash-welcome"><span>Welcome back,</span><strong>Maung Maung's Family</strong></div><div className="ec-stat-grid"><article><small>Next Appointment</small><strong>May 25, 2025</strong><span>10:00 AM · Dr. Thida Win</span></article><article><small>Upcoming Visit</small><strong>May 27, 2025</strong><span>Nurse Visit · At Home</span></article><article><small>Medications</small><strong>2 Due Today</strong><span className="warning">1 missed</span></article><article><small>Health Score</small><strong>Good</strong><span className="positive">Improving</span></article></div><div className="ec-dash-lower"><article><small>Recent Activity</small><p>✓ Nurse visit completed</p><p>✓ Medication taken</p><p>✓ Blood pressure recorded</p></article><article><small>Health Overview</small><div className="ec-health-values"><div><span>Blood Pressure</span><b>120/80</b><i>Normal</i></div><div><span>Blood Sugar</span><b>142 mg/dL</b><i className="warning">Slightly high</i></div></div><svg viewBox="0 0 260 60" role="img" aria-label="Health trend chart"><polyline points="0,43 28,32 52,45 78,28 106,36 134,18 160,26 190,12 218,19 260,6" /></svg></article></div></main></div>
}

function FamilyCareSection() {
  return <section className="ec-section ec-family" id="families"><div className="ec-family-copy"><span className="ec-kicker">Family Peace of Mind</span><h2>Stay Close to Their Care,<br />Even When You're <em>Far Away.</em></h2><p>Our Family Health Dashboard keeps you informed about your loved one's health and care.</p><ul>{familyBenefits.map((item) => <li key={item}><Check />{item}</li>)}</ul><button className="ec-button ec-button-primary" type="button">Learn More About Family Dashboard <ArrowRight /></button></div><DashboardPreview /></section>
}

function CareCoordinatorSection() {
  return <section className="ec-section ec-coordinator" id="about"><div className="ec-coordinator-photo"><img src="/easycare-care-coordinator.png" alt="EasyCare coordinator speaking with a family from her laptop" /></div><div className="ec-coordinator-copy"><span className="ec-kicker">Dedicated Care Coordinator</span><h2>One Person Helping<br />Coordinate the Care Journey.</h2><p>Your Care Coordinator is your single point of contact, ensuring seamless, personalized care for your family.</p></div><div className="ec-coordinator-actions"><ul>{coordinatorBenefits.map((item) => <li key={item}><Check />{item}</li>)}</ul><button className="ec-button ec-button-primary" type="button">Talk to a Care Coordinator <ArrowRight /></button></div></section>
}

export function LandingPage() { return <main className="ec-page"><h2 className="sr-only">Welcome to MediBridge AI</h2><LandingNavbar /><HeroSection /><ServicesSection /><HowItWorksSection /><FamilyCareSection /><CareCoordinatorSection /><div id="contact" className="ec-contact-anchor" aria-hidden="true" /></main> }
