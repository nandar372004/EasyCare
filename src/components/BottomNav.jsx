import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Bot, CalendarDays, ClipboardList, CreditCard, FileText, FlaskConical, HeartPulse, Home, LayoutDashboard, MapPin, MessageSquare, Pill, Settings, Stethoscope, Users, X } from 'lucide-react'
import { useLocalization } from '../features/localization/LocalizationContext.jsx'
import { primaryNavigation } from '../data/navigation.js'
import './mobileNavigation.css'

const items = [
  { to: '/dashboard', labelKey: 'nav.home', icon: Home },
  { to: '/my-care-plan', labelKey: 'nav.myCarePlan', fallbackLabel: 'My Care Plan', icon: ClipboardList },
  { to: '/appointments', labelKey: 'nav.appointments', icon: CalendarDays },
  { to: '/messages', labelKey: 'nav.messages', icon: MessageSquare },
]
const icons = { LayoutDashboard, Bot, Stethoscope, CalendarDays, HeartPulse, ClipboardList, FlaskConical, Pill, CreditCard, MessageSquare, MapPin, Settings, Home, Users, FileText }
const groups = [
  { key: 'dashboard', en: 'Dashboard', my: 'ပင်မစာမျက်နှာ' },
  { key: 'care', en: 'Care', my: 'စောင့်ရှောက်မှု' },
  { key: 'health', en: 'Health', my: 'ကျန်းမာရေး' },
  { key: 'support', en: 'Support', my: 'အကူအညီ' },
]

export function BottomNav() {
  const { t, language } = useLocalization()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return undefined
    const closeOnEscape = event => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const mobileLabel = item => item.labelKey ? t(item.labelKey) : item.label
  const allTabsLabel = language === 'my' ? 'အက်ပ်မီနူး' : 'All tabs'
  return (
    <nav className="bottom-nav" aria-label={t('mobileNavigation')}>
      {items.map(({ to, labelKey, fallbackLabel, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
          <Icon aria-hidden="true" /><span>{fallbackLabel ?? t(labelKey)}</span>
        </NavLink>
      ))}
      <button className={`bottom-nav-all${open ? ' active' : ''}`} type="button" aria-expanded={open} aria-controls="mobile-all-tabs" onClick={() => setOpen(value => !value)}>
        <LayoutDashboard aria-hidden="true" /><span>{allTabsLabel}</span>
      </button>
      {open && <div className="mobile-nav-backdrop" onClick={() => setOpen(false)}>
        <section id="mobile-all-tabs" className="mobile-nav-panel" role="dialog" aria-modal="true" aria-label={allTabsLabel} onClick={event => event.stopPropagation()}>
          <header className="mobile-nav-panel-header"><h2>{allTabsLabel}</h2><button type="button" className="mobile-nav-close" aria-label={language === 'my' ? 'ပိတ်ရန်' : 'Close'} onClick={() => setOpen(false)}><X aria-hidden="true" /></button></header>
          <div className="mobile-nav-groups">{groups.map(group => {
            const groupItems = primaryNavigation.filter(item => item.group === group.key)
            if (!groupItems.length) return null
            return <section className="mobile-nav-group" key={group.key} aria-label={language === 'my' ? group.my : group.en}>
              <h3>{language === 'my' ? group.my : group.en}</h3>
              <div>{groupItems.map(item => {
                const Icon = icons[item.icon]
                return <NavLink key={item.to} to={item.to} end={item.end || item.to === '/'} className={({ isActive }) => isActive ? 'active' : ''} onClick={() => setOpen(false)}>
                  {Icon && <Icon aria-hidden="true" />}<span>{mobileLabel(item)}</span>
                </NavLink>
              })}</div>
            </section>
          })}</div>
        </section>
      </div>}
    </nav>
  )
}
