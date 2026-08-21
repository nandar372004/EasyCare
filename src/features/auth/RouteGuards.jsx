import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

const publicAuthRoutes = new Set(['/login', '/register'])

export function getSafeReturnPath(locationState) {
  const candidate = locationState?.from
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return '/dashboard'
  const path = candidate.split('?')[0]
  return publicAuthRoutes.has(path) || path === '/' ? '/dashboard' : candidate
}

function LoadingSession() {
  return <main className="session-loading" role="status">Restoring your secure session…</main>
}

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <LoadingSession />
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return <Outlet />
}

export function PublicOnlyRoute() {
  const auth = useAuth()
  if (auth.status === 'loading') return <LoadingSession />
  if (auth.isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
