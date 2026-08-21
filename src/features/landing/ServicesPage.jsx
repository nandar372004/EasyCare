import { Link } from 'react-router-dom'
import {
  ArrowRight, BriefcaseMedical, Check, HeartHandshake, HeartPulse, Headphones,
  LockKeyhole, Pill, ShieldCheck, Stethoscope, UsersRound, Video,
} from 'lucide-react'
import { LandingNavbar } from './LandingNavbar.jsx'

const serviceCards = [
  [BriefcaseMedical, 'Doctor Home Visits', 'Experienced doctors visit your loved ones at home with the right care.', ['General consultation', 'Chronic disease care'], 'blue'],
  [Stethoscope, 'Nurse Home Care', 'Skilled nurses provide professional care and support at home.', ['Wound care', 'Vital monitoring'], 'violet'],
  [Video, 'Online Consultation', 'Consult with doctors securely via video call from anywhere.', ['Video consultation', 'E-prescription'], 'green'],
  [HeartHandshake, 'Elderly Care', 'Specialized care for seniors and chronic conditions.', ['Daily living support', 'Companion care'], 'coral'],
  [Pill, 'Medication Support', 'Medication reminders and adherence tracking for better health.', ['Reminders & alerts', 'Refill assistance'], 'amber'],
  [Headphones, 'Care Coordinator', "A dedicated coordinator manages and follows up on your family's care.", ['Care management', 'Follow-up & support'], 'sky'],
]

const trustItems = [
  [ShieldCheck, 'Verified Professionals', 'All providers are verified, licensed and experienced.'],
  [LockKeyhole, 'Safe & Reliable', "Your family's health data is protected with top security."],
  [UsersRound, 'Family Connected', 'Stay informed with real-time updates and transparency.'],
  [HeartPulse, 'Compassionate Care', 'We treat your family like our own.'],
]

export function ServicesPage() {
  return <main className="ec-page ec-services-page"><LandingNavbar activePage="services" /><section className="ec-services-hero"><div className="ec-services-hero-copy"><span>Our Services</span><h1>Comprehensive Care,<br />Right at <em>Home</em> or <strong>Online</strong></h1><p>EasyCare connects your family with verified healthcare professionals to deliver the right care, in the right place, at the right time.</p></div><div className="ec-services-hero-photo"><img src="/easycare-home-care-hero.png" alt="A nurse providing compassionate care to an older woman at home" /></div></section><div className="ec-services-content"><section className="ec-services-cards" aria-label="EasyCare services">{serviceCards.map(([Icon, title, text, benefits, tone]) => <article className="ec-services-card" key={title}><span className={`ec-icon ec-icon-${tone}`}><Icon /></span><h2>{title}</h2><p>{text}</p><ul>{benefits.map((benefit) => <li key={benefit}><Check />{benefit}</li>)}</ul><button type="button">Learn more <ArrowRight /></button></article>)}</section><section className="ec-services-trust" aria-label="EasyCare commitments">{trustItems.map(([Icon, title, text]) => <article key={title}><span><Icon /></span><div><h3>{title}</h3><p>{text}</p></div></article>)}</section><section className="ec-guidance"><div className="ec-guidance-visual" aria-hidden="true"><img src="/dashboard-doctors.png" alt="" /></div><div className="ec-guidance-copy"><h2>Not Sure Which Care Is Right for Your Loved One?</h2><p>Let EasyCare guide you to the most appropriate care.</p><ul><li><Check />Describe the situation</li><li><Check />Get care recommendations</li><li><Check />Our team will follow up</li></ul><div><button className="ec-button ec-button-primary" type="button">Get Care Guidance</button><button className="ec-button ec-button-outline" type="button">Talk to Care Coordinator</button></div></div><div className="ec-guidance-symbol" aria-hidden="true"><HeartHandshake /><span>Care guidance<br />for your family</span></div></section></div></main>
}
