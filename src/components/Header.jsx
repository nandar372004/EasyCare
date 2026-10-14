import { useState } from 'react'
import { Bell, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { WorkspaceSwitcher } from '../features/auth/WorkspaceSwitcher.jsx'
import { useNotifications } from '../features/notifications/NotificationContext.jsx'
import { GlobalSearch } from './GlobalSearch.jsx'

export function Header() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { unreadCount } = useNotifications()
  const [signOutError, setSignOutError] = useState(false)

  async function logout() {
    setSignOutError(false)
    try {
      await auth.signOut()
      navigate('/login', { replace: true })
    } catch {
      setSignOutError(true)
      navigate('/login', { replace: true, state: { signOutError: true } })
    }
  }

  return (
    <header className="top-header">
      <div className="header-search">
        <GlobalSearch />
      </div>
      <div className="header-actions">
        {signOutError && <span className="sr-only" role="status">Sign-out failed; the local workspace was cleared.</span>}
        <button className="icon-button notification-bell" type="button" onClick={() => navigate('/notifications')} aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
          <Bell aria-hidden="true" />{unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
        {auth.isAuthenticated && (
          <button className="icon-button" type="button" onClick={() => void logout()} aria-label="Log out">
            <LogOut aria-hidden="true" />
          </button>
        )}
        <WorkspaceSwitcher />
      </div>
    </header>
  )
}
