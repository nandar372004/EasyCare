import { Bell, LogOut } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from './Brand.jsx'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { GlobalSearch } from './GlobalSearch.jsx'

export function Header() {
  const auth = useAuth()

  return (
    <header className="top-header">
      <div className="header-search">
        <GlobalSearch />
      </div>
      <div className="header-actions">
        <button className="icon-button" type="button" aria-label="Notifications are not available yet">
          <Bell aria-hidden="true" /><span className="notification-dot" aria-hidden="true" />
        </button>
        {!auth.isFixtureMode && auth.isAuthenticated && (
          <Link className="icon-button" to="/" aria-label="Back to home">
            <LogOut aria-hidden="true" />
          </Link>
        )}
      </div>
    </header>
  )
}
