import { useDashboardTranslation } from './useDashboardTranslation.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { DashboardSkeleton } from './DashboardSkeleton.jsx'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'

// Keep the authenticated shell visible while the route's own code loads.
export function DashboardRouteSkeleton() {
  const t = useDashboardTranslation()
  const localization = useOptionalLocalization()
  const { patient } = useAuth()
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Yangon', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return <div className="dashboard-page individual-health-dashboard" lang={localization?.language || 'en'}>
    <section className="dashboard-hero-section"><div className="card dashboard-hero"><div className="dashboard-hero-copy"><span className="eyebrow">{t("Your Health Today")}</span><h1>{t(greeting)}{localization?.language === 'my' ? '၊ ' : ', '}{patient?.full_name || t('EasyCare Patient')}</h1><p>{t("Here is your latest health and care information.")}</p></div></div><article className="card patient-health-section"><div className="section-title"><h2>{t("Personal Health Information")}</h2></div><p>{t("Cervical Spondylosis")}</p></article></section>
    <div className="dashboard-main-grid">{["Today's Medications", 'Upcoming Care'].map(title => <article key={title} className="card patient-health-section"><h2>{t(title)}</h2><DashboardSkeleton label={`Loading ${title.toLowerCase()}…`} /></article>)}</div>
  </div>
}

export function PatientDocumentRouteSkeleton() {
  return <section className="card patient-health-section"><h1>Medical Documents</h1><DashboardSkeleton label="Loading medical documents…" /></section>
}
