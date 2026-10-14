import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, AudioLines, Bell, BriefcaseMedical, CalendarDays, Check,
  ClipboardList, Headphones, HeartPulse, Home, LockKeyhole, MessageSquare,
  Pill, ShieldCheck, Stethoscope, UserRound, UsersRound, Video, Volume2,
} from 'lucide-react'
import { Brand } from '../../components/Brand.jsx'
import { LandingNavbar } from './LandingNavbar.jsx'
import { useLandingTranslation } from './useLandingTranslation.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './landingLocalization.css'
import englishGreeting from '../../../EasyCare Greeting(English).mp3'
import myanmarGreeting from '../../../EasyCare Greeting(Myanmar).mp3'

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

function IntroAudioControl() {
  const t = useLandingTranslation()
  const language = useOptionalLocalization()?.language || 'en'
  const audioRef = useRef(null)
  const previousLanguage = useRef(language)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (audio) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

  useEffect(() => {
    if (previousLanguage.current === language) return
    previousLanguage.current = language
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setIsPlaying(false)
  }, [language])

  async function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    setHasInteracted(true)
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      return
    }

    if (audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration)) audio.currentTime = 0
    try {
      await audio.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
    }
  }

  function handleEnded() {
    if (audioRef.current) audioRef.current.currentTime = 0
    setIsPlaying(false)
  }

  return <>
    <audio ref={audioRef} src={language === 'my' ? myanmarGreeting : englishGreeting} preload="none" onEnded={handleEnded} onError={() => setIsPlaying(false)} />
    <button className={`ec-intro-audio-control${isPlaying ? ' is-playing' : ''}${!hasInteracted ? ' is-attention' : ''}`} type="button" onClick={togglePlayback} aria-label={t(isPlaying ? 'Pause EasyCare introduction' : 'Play EasyCare introduction')} aria-pressed={isPlaying} title={t(isPlaying ? 'Pause EasyCare introduction' : 'Play EasyCare introduction')}>
      {isPlaying ? <AudioLines aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </button>
  </>
}

function TrustCard() {
  const t = useLandingTranslation()
  const items = [[ShieldCheck, 'Verified', 'Professionals'], [Home, 'Care', 'at Home'], [UsersRound, 'Family', 'Updates'], [LockKeyhole, 'Secure', 'Health Records']]
  return <div className="ec-trust-card">{items.map(([Icon, a, b]) => <div key={a}><span><Icon /></span><strong>{t(a)}<br />{t(b)}</strong></div>)}</div>
}

function HeroSection() {
  const t = useLandingTranslation()
  return <section className="ec-hero" id="home"><div className="ec-hero-copy"><h1 className="ec-hero-headline">{t("Smarter Care,")}<br />{t("Healthier Lives")}<span>{t("Healthcare Without Boundaries")}</span></h1><p>{t("Connecting your loved ones with verified doctors, nurses and caregivers – at home or online – with support that keeps your family informed.")}</p><div className="ec-hero-actions"><Link className="ec-button ec-button-primary" to="/doctors">{t("Find Care")} <ArrowRight /></Link><Link className="ec-button ec-button-outline" to="/doctors">{t("Book a Doctor")} <CalendarDays /></Link></div></div><div className="ec-hero-photo"><img src="/easycare-home-care-hero.png" alt={t("A home-care nurse supporting an older woman")} /><IntroAudioControl /><TrustCard /></div></section>
}

function SectionHeading({ label, title, children }) { const t = useLandingTranslation(); return <div className="ec-section-heading"><span>{t(label)}</span><h2>{t(title)}</h2>{children && <p>{t(children)}</p>}</div> }

function ServicesSection() {
  const t = useLandingTranslation()
  return <section className="ec-section ec-services" id="services"><SectionHeading label="Our Services" title="Care Designed Around Your Family">Comprehensive healthcare services delivered to your loved ones with compassion and professionalism.</SectionHeading><div className="ec-service-grid">{services.map(([Icon, title, text, tone]) => <article className="ec-service-card" key={title}><span className={`ec-icon ec-icon-${tone}`}><Icon /></span><h3>{t(title)}</h3><p>{t(text)}</p><button type="button" onClick={() => scrollTo('contact')}>{t("Learn more")} <ArrowRight /></button></article>)}</div></section>
}

function HowItWorksSection() {
  const t = useLandingTranslation()
  return <section className="ec-section ec-how" id="how-it-works"><SectionHeading label="How EasyCare Works" title="Simple Steps, Better Care" /><div className="ec-steps">{steps.map(([Icon, title, text, tone], index) => <article className="ec-step" key={title}><div className={`ec-step-icon ec-icon-${tone}`}><Icon /></div>{index < steps.length - 1 && <div className="ec-step-connector"><ArrowRight /></div>}<h3>{t(title)}</h3><p>{t(text)}</p></article>)}</div></section>
}

function DashboardPreview() {
  const t = useLandingTranslation()
  const menu = [[Home, 'Dashboard'], [CalendarDays, 'Appointments'], [BriefcaseMedical, 'Home Visits'], [Pill, 'Medications'], [ClipboardList, 'Health Records'], [MessageSquare, 'Messages'], [UserRound, 'Profile']]
  return <div className="ec-dashboard" aria-label={t("Family dashboard preview")}><aside><Brand compact />{menu.map(([Icon, label], i) => <div className={i === 0 ? 'selected' : ''} key={label}><Icon />{t(label)}</div>)}</aside><main><div className="ec-dash-welcome"><span>{t("Welcome back,")}</span><strong>{t("Maung Maung's Family")}</strong></div><div className="ec-stat-grid"><article><small>{t("Next Appointment")}</small><strong>{t("May 25, 2025")}</strong><span>{t("10:00 AM · Dr. Thida Win")}</span></article><article><small>{t("Upcoming Visit")}</small><strong>{t("May 27, 2025")}</strong><span>{t("Nurse Visit · At Home")}</span></article><article><small>{t("Medications")}</small><strong>{t("2 Due Today")}</strong><span className="warning">{t("1 missed")}</span></article><article><small>{t("Health Score")}</small><strong>{t("Good")}</strong><span className="positive">{t("Improving")}</span></article></div><div className="ec-dash-lower"><article><small>{t("Recent Activity")}</small><p>{t("✓ Nurse visit completed")}</p><p>{t("✓ Medication taken")}</p><p>{t("✓ Blood pressure recorded")}</p></article><article><small>{t("Health Overview")}</small><div className="ec-health-values"><div><span>{t("Blood Pressure")}</span><b>120/80</b><i>{t("Normal")}</i></div><div><span>{t("Blood Sugar")}</span><b>142 mg/dL</b><i className="warning">{t("Slightly high")}</i></div></div><svg viewBox="0 0 260 60" role="img" aria-label={t("Health trend chart")}><polyline points="0,43 28,32 52,45 78,28 106,36 134,18 160,26 190,12 218,19 260,6" /></svg></article></div></main></div>
}

function FamilyCareSection() {
  const t = useLandingTranslation()
  return <section className="ec-section ec-family" id="families"><div className="ec-family-copy"><span className="ec-kicker">{t("Family Peace of Mind")}</span><h2>{t("Stay Close to Their Care,")}<br />{t("Even When You're")} <em>{t("Far Away.")}</em></h2><p>{t("Our Family Health Dashboard keeps you informed about your loved one's health and care.")}</p><ul>{familyBenefits.map((item) => <li key={item}><Check />{t(item)}</li>)}</ul><button className="ec-button ec-button-primary" type="button">{t("Learn More About Family Dashboard")} <ArrowRight /></button></div><DashboardPreview /></section>
}

function CareCoordinatorSection() {
  const t = useLandingTranslation()
  return <section className="ec-section ec-coordinator" id="about"><div className="ec-coordinator-photo"><img src="/easycare-care-coordinator.png" alt={t("EasyCare coordinator speaking with a family from her laptop")} /></div><div className="ec-coordinator-copy"><span className="ec-kicker">{t("Dedicated Care Coordinator")}</span><h2>{t("One Person Helping")}<br />{t("Coordinate the Care Journey.")}</h2><p>{t("Your Care Coordinator is your single point of contact, ensuring seamless, personalized care for your family.")}</p></div><div className="ec-coordinator-actions"><ul>{coordinatorBenefits.map((item) => <li key={item}><Check />{t(item)}</li>)}</ul><button className="ec-button ec-button-primary" type="button">{t("Talk to a Care Coordinator")} <ArrowRight /></button></div></section>
}

export function LandingPage() { const t = useLandingTranslation(); const language = useOptionalLocalization()?.language || 'en'; return <main className="ec-page ec-landing-page" lang={language}><h2 className="sr-only">{t("Welcome to MediBridge AI")}</h2><LandingNavbar localized /><HeroSection /><ServicesSection /><HowItWorksSection /><FamilyCareSection /><CareCoordinatorSection /><div id="contact" className="ec-contact-anchor" aria-hidden="true" /></main> }

