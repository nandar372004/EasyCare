import { Link } from 'react-router-dom'
import {
  ArrowRight, BriefcaseMedical, Check, HeartHandshake, HeartPulse, Headphones,
  LockKeyhole, Pill, ShieldCheck, Stethoscope, UsersRound, Video,
} from 'lucide-react'
import { LandingNavbar } from './LandingNavbar.jsx'
import { useLandingTranslation } from './useLandingTranslation.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './landingLocalization.css'

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

export function ServicesPage() { const t = useLandingTranslation(); const language = useOptionalLocalization()?.language || 'en';
  return <main className="ec-page ec-landing-page ec-localized-public ec-services-page" lang={language}><LandingNavbar localized activePage="services" /><section className="ec-services-hero"><div className="ec-services-hero-copy"><span>{t("Our Services")}</span><h1>{t("Comprehensive Care,")}<br />{language === 'en' && <>{t("Right at")} </>}<em>{t("Home", "serviceHome")}</em> {t("or")} <strong>{t("Online")}</strong></h1><p>{t("EasyCare connects your family with verified healthcare professionals to deliver the right care, in the right place, at the right time.")}</p></div><div className="ec-services-hero-photo"><img src="/easycare-home-care-hero.png" alt={t("A nurse providing compassionate care to an older woman at home")} /></div></section><div className="ec-services-content"><section className="ec-services-cards" aria-label={t("EasyCare services")}>{serviceCards.map(([Icon, title, text, benefits, tone]) => <article className="ec-services-card" key={title}><span className={`ec-icon ec-icon-${tone}`}><Icon /></span><h2>{t(title)}</h2><p>{t(text)}</p><ul>{benefits.map((benefit) => <li key={benefit}><Check />{t(benefit)}</li>)}</ul><button type="button">{t("Learn more")} <ArrowRight /></button></article>)}</section><section className="ec-services-trust" aria-label={t("EasyCare commitments")}>{trustItems.map(([Icon, title, text]) => <article key={title}><span><Icon /></span><div><h3>{t(title)}</h3><p>{t(text)}</p></div></article>)}</section><section className="ec-guidance"><div className="ec-guidance-visual" aria-hidden="true"><img src="/dashboard-doctors.png" alt="" /></div><div className="ec-guidance-copy"><h2>{t("Not Sure Which Care Is Right for Your Loved One?")}</h2><p>{t("Let EasyCare guide you to the most appropriate care.")}</p><ul><li><Check />{t("Describe the situation")}</li><li><Check />{t("Get care recommendations")}</li><li><Check />{t("Our team will follow up")}</li></ul><div><button className="ec-button ec-button-primary" type="button">{t("Get Care Guidance")}</button><button className="ec-button ec-button-outline" type="button">{t("Talk to Care Coordinator")}</button></div></div><div className="ec-guidance-symbol" aria-hidden="true"><HeartHandshake /><span>{t("Care guidance")}<br />{t("for your family")}</span></div></section></div></main>
}

