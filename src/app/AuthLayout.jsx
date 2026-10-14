import { useLoginTranslation } from '../features/auth/useLoginTranslation.js'
import { useOptionalLocalization } from '../features/localization/LocalizationContext.jsx'
import '../features/auth/loginLocalization.css'
import { Outlet, useLocation } from 'react-router-dom'
import { CalendarDays, Headphones, LockKeyhole, ShieldCheck, UsersRound } from 'lucide-react'
import { Brand } from '../components/Brand.jsx'
import { DevelopmentConfigNotice } from '../components/DevelopmentConfigNotice.jsx'

export function AuthLayout() {
  const t = useLoginTranslation()
  const localization = useOptionalLocalization()
  const location = useLocation()
  if (location.pathname === '/register') {
    return (
      <main className="registration-page">
        <Brand />
        <DevelopmentConfigNotice />
        <Outlet />
      </main>
    )
  }
  if (location.pathname === '/login') {
    const features = [
      [UsersRound, 'Family Connected Care', 'Stay updated on appointments, visits, medications and health updates.'],
      [ShieldCheck, 'Trusted & Verified Professionals', 'Connect with qualified doctors, nurses and caregivers you can trust.'],
      [CalendarDays, 'Care at Your Convenience', 'Book home visits or online consultations that fit your schedule.'],
      [LockKeyhole, 'Secure & Private', "Your family's health information is protected with strong security."],
    ]
    const trust = [[ShieldCheck, 'Encrypted Data', 'End-to-end protection'], [ShieldCheck, 'Verified Providers', 'Trusted professionals'], [Headphones, '24/7 Support', 'We’re here to help'], [LockKeyhole, 'Privacy First', 'You’re in control']]
    return (
      <main className="ec-signin-layout" lang={localization?.language || 'en'}>
        <section className="ec-signin-intro">
          <Brand />
          <div>
            <h1>{t("Welcome back!")}<br />{t("We’re glad to see")} <span>{t("you.")}</span></h1>
            <p>{t("Sign in to continue managing your loved one’s health and care with EasyCare.")}</p>
            <div className="ec-signin-features">{features.map(([Icon, title, text]) => <article key={title}><i><Icon /></i><div><b>{t(title)}</b><small>{t(text)}</small></div></article>)}</div>
          </div>
        </section>
        <section className="ec-signin-panel"><div className="ec-signin-tools"><div className="ec-login-language" role="group" aria-label="Myanmar | English"><button type="button" lang="my" aria-label="Myanmar" aria-pressed={localization?.language === 'my'} onClick={() => localization?.setLanguage('my')}>မြန်မာ</button><span aria-hidden="true">|</span><button type="button" lang="en" aria-pressed={localization?.language !== 'my'} onClick={() => localization?.setLanguage('en')}>English</button></div><a href="mailto:support@example.easycare">? &nbsp; {t("Need help?")}</a></div><div className="ec-signin-panel-content"><DevelopmentConfigNotice /><Outlet /></div></section>
        <section className="ec-signin-trust">{trust.map(([Icon, title, text]) => <article key={title}><i><Icon /></i><span><b>{t(title)}</b><small>{t(text)}</small></span></article>)}</section>
        <footer>{t("© 2026 EasyCare Digital Health Platform. All rights reserved.")}</footer>
      </main>
    )
  }
  return <main className="auth-layout"><section className="auth-intro" aria-label="MediBridge AI introduction"><Brand /><div><span className="eyebrow">Connected care, thoughtfully designed</span><h1>Healthcare support, wherever you are.</h1><p>A secure foundation for future virtual care experiences.</p></div></section><section className="auth-panel"><div className="auth-panel-content"><DevelopmentConfigNotice /><Outlet /></div></section></main>
}

