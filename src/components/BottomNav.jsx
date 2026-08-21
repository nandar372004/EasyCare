import { NavLink } from 'react-router-dom'
import { CalendarDays, Home, MessageSquare, Stethoscope, UserRound } from 'lucide-react'
import { useLocalization } from '../features/localization/LocalizationContext.jsx'

const items = [
  { to: '/dashboard', labelKey: 'nav.home', icon: Home },
  { to: '/appointments', labelKey: 'nav.appointments', icon: CalendarDays },
  { to: '/doctors?type=video', labelKey: 'nav.consultations', fallbackLabel: 'Consultations', icon: Stethoscope },
  { to: '/messages', labelKey: 'nav.messages', icon: MessageSquare },
  { to: '/settings', labelKey: 'nav.settings', fallbackLabel: 'Profile', icon: UserRound },
]

export function BottomNav() {
  const { t } = useLocalization()
  return (
    <nav className="bottom-nav" aria-label={t('mobileNavigation')}>
      {items.map(({ to, labelKey, fallbackLabel, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
          <Icon aria-hidden="true" /><span>{fallbackLabel ?? t(labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
