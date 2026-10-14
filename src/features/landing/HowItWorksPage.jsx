import { Link } from 'react-router-dom'
import {
  ArrowRight, Bell, CalendarCheck, Check, ClipboardList, Headphones, HeartHandshake,
  HeartPulse, Home, ShieldCheck, Smartphone, UsersRound,
} from 'lucide-react'
import { LandingNavbar } from './LandingNavbar.jsx'
import { useLandingTranslation } from './useLandingTranslation.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './landingLocalization.css'

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

function JourneyVisual({ type }) { const t = useLandingTranslation();
  if (type === 'coordinator') return <img src="/easycare-care-coordinator.png" alt={t("Care coordinator reviewing a family's needs")} />
  if (type === 'care') return <img src="/easycare-home-care-hero.png" alt={t("A nurse providing care at home")} />
  if (type === 'family') return <img src="/dashboard-doctors.png" alt={t("A family discussing their care needs")} />
  if (type === 'schedule') return <div className="ec-journey-placeholder"><CalendarCheck /><span>{t("Choose a convenient time")}</span></div>
  return <div className="ec-journey-placeholder"><Smartphone /><span>{t("Care updates delivered")}</span></div>
}

export function HowItWorksPage() { const t = useLandingTranslation(); const language = useOptionalLocalization()?.language || 'en';
  return <main className="ec-page ec-landing-page ec-localized-public ec-how-page" lang={language}><LandingNavbar localized activePage="how-it-works" /><header className="ec-how-header"><h1>{language === 'my' ? <><span>EasyCare</span> {t("Works")}</> : <>How <span>EasyCare</span> Works</>}</h1><p>{t("We make healthcare simple, convenient and reliable for you and your loved ones.")}<br />{t("Just a few easy steps to get the right care.")}</p></header><div className="ec-how-content"><section className="ec-journey" aria-label={t("Five steps to EasyCare")}>{journey.map(([Icon, title, text, tone, visual], index) => <article className="ec-journey-card" key={title}><b className={`ec-journey-number ec-journey-${tone}`}>{index + 1}</b><span className={`ec-journey-icon ec-journey-icon-${tone}`}><Icon /></span><h2>{t(title)}</h2><p>{t(text)}</p><div className="ec-journey-visual"><JourneyVisual type={visual} /></div>{index < journey.length - 1 && <i className="ec-journey-arrow"><ArrowRight /></i>}</article>)}</section><div className="ec-how-support"><section className="ec-next"><h2>{t("What Happens Next?")}</h2><div>{nextSteps.map(([Icon, title, text]) => <article key={title}><span><Icon /></span><h3>{t(title)}</h3><p>{t(text)}</p></article>)}</div></section><section className="ec-dedicated"><div><h2>{t("Your Dedicated")}<br />{t("Care Coordinator")}</h2><p>{t("One person who understands your family's needs and coordinates every detail of the care journey.")}</p><ul><li><Check />{t("Understands your needs")}</li><li><Check />{t("Coordinates the right care")}</li><li><Check />{t("Keeps your family informed")}</li></ul></div><img src="/easycare-care-coordinator.png" alt={t("Dedicated EasyCare coordinator")} /></section></div><section className="ec-how-cta"><div><HeartHandshake /><p>{t("Quality care made simple. Because your family deserves the best.")}</p></div><div><button className="ec-button ec-button-outline" type="button">{t("Talk to Our Team")}</button><Link className="ec-button ec-button-primary" to="/doctors">{t("Find Care Now")} <ArrowRight /></Link></div></section></div></main>
}
