import { NavLink } from 'react-router-dom'
import { Bot, CalendarDays, ClipboardList, CreditCard, FlaskConical, HeartPulse, LayoutDashboard, MapPin, MessageSquare, Pill, Settings, Stethoscope } from 'lucide-react'
import { Brand } from './Brand.jsx'
import { primaryNavigation } from '../data/navigation.js'
import { useLocalization } from '../features/localization/LocalizationContext.jsx'

const icons = { LayoutDashboard, Bot, Stethoscope, CalendarDays, HeartPulse, ClipboardList, FlaskConical, Pill, CreditCard, MessageSquare, MapPin, Settings }

const groups = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'care', label: 'CARE' },
  { key: 'health', label: 'HEALTH' },
  { key: 'support', label: 'SUPPORT' },
]

export function Sidebar() {
  const { t } = useLocalization()
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="sidebar-nav" aria-label={t('primaryNavigation')}>
        {groups.map((group) => {
          const items = primaryNavigation.filter((item) => item.group === group.key)
          if (items.length === 0) return null
          return (
            <div className="sidebar-group" key={group.key}>
              <div className="sidebar-group-label">{group.label}</div>
              {items.map((item) => {
                const Icon = icons[item.icon]
                return (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          )
        })}
      </nav>
      <div className="sidebar-note">
        <strong>Foundation build</strong>
        <span>Features will be connected in later phases.</span>
      </div>
    </aside>
  )
}
