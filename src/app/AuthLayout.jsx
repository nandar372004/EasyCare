import { Outlet, useLocation } from 'react-router-dom'
import { CalendarDays, Headphones, LockKeyhole, ShieldCheck, UsersRound } from 'lucide-react'
import { Brand } from '../components/Brand.jsx'
import { DevelopmentConfigNotice } from '../components/DevelopmentConfigNotice.jsx'

export function AuthLayout() {
  const location = useLocation()
  if (location.pathname === '/login') {
    const features = [
      [UsersRound, 'Family Connected Care', 'Stay updated on appointments, visits, medications and health updates.'],
      [ShieldCheck, 'Trusted & Verified Professionals', 'Connect with qualified doctors, nurses and caregivers you can trust.'],
      [CalendarDays, 'Care at Your Convenience', 'Book home visits or online consultations that fit your schedule.'],
      [LockKeyhole, 'Secure & Private', "Your family's health information is protected with strong security."],
    ]
    const trust = [[ShieldCheck, 'Encrypted Data', 'End-to-end protection'], [ShieldCheck, 'Verified Providers', 'Trusted professionals'], [Headphones, '24/7 Support', 'We’re here to help'], [LockKeyhole, 'Privacy First', 'You’re in control']]
    return (
      <main className="ec-signin-layout">
        <section className="ec-signin-intro">
          <Brand />
          <div>
            <h1>Welcome back!<br />We’re glad to see <span>you.</span></h1>
            <p>Sign in to continue managing your loved one’s health and care with EasyCare.</p>
            <div className="ec-signin-features">{features.map(([Icon, title, text]) => <article key={title}><i><Icon /></i><div><b>{title}</b><small>{text}</small></div></article>)}</div>
          </div>
        </section>
        <section className="ec-signin-panel"><div className="ec-signin-tools"><span>🌐 မြန်မာ</span><span>EN</span><a href="mailto:support@example.easycare">? &nbsp; Need help?</a></div><div className="ec-signin-panel-content"><DevelopmentConfigNotice /><Outlet /></div></section>
        <section className="ec-signin-trust">{trust.map(([Icon, title, text]) => <article key={title}><i><Icon /></i><span><b>{title}</b><small>{text}</small></span></article>)}</section>
        <footer>© 2026 EasyCare Tele Clinic. All rights reserved.</footer>
      </main>
    )
  }
  return <main className="auth-layout"><section className="auth-intro" aria-label="MediBridge AI introduction"><Brand /><div><span className="eyebrow">Connected care, thoughtfully designed</span><h1>Healthcare support, wherever you are.</h1><p>A secure foundation for future virtual care experiences.</p></div></section><section className="auth-panel"><div className="auth-panel-content"><DevelopmentConfigNotice /><Outlet /></div></section></main>
}
