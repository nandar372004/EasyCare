import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { getProviderWorkspacePath } from '../provider/providerWorkspaceRouting.js'

const publicAuthRoutes = new Set(['/login', '/register'])

export function getSafeReturnPath(locationState) {
  const candidate = locationState?.from
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return '/dashboard'
  const path = candidate.split('?')[0]
  return publicAuthRoutes.has(path) || path === '/' ? '/dashboard' : candidate
}

const patientRoutePrefixes = ['/dashboard', '/onboarding', '/appointments', '/my-care-plan', '/health-records', '/medical-documents', '/prescriptions', '/lab-results', '/medications', '/family', '/doctors', '/care-plan', '/consultations', '/payments', '/messages', '/notifications', '/location', '/settings', '/subscription']
const adminRoutePrefix = '/admin/provider-applications'

function isPatientPath(path) {
  return patientRoutePrefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

export function getPostLoginPath(identity, returnLocation) {
  const patient = Boolean(identity?.patient)
  const provider = Boolean(identity?.provider)
  const admin = identity?.admin === true
  const providerSetup = identity?.providerSetup
  if (!patient && !provider && !admin && providerSetup) {
    return providerSetup.setupState === 'ready' && providerSetup.accountStatus === 'active'
      ? getProviderWorkspacePath(providerSetup.type)
      : '/provider/setup'
  }
  const availableCount = Number(patient) + Number(provider) + Number(admin)
  if (availableCount > 1) return '/workspace'

  const safeReturn = getSafeReturnPath(returnLocation)
  const returnPath = safeReturn.split('?')[0]
  if (admin) return returnPath.startsWith(adminRoutePrefix) ? safeReturn : adminRoutePrefix
  if (provider) {
    const destination = getProviderWorkspacePath(identity.provider.type)
    if (destination !== '/provider') return destination
    return returnPath === '/provider' || ['/provider/appointments', '/provider/patients', '/provider/care-plans'].some(path => returnPath === path || returnPath.startsWith(`${path}/`)) ? safeReturn : destination
  }
  if (patient) return isPatientPath(returnPath) ? safeReturn : '/dashboard'
  return '/dashboard'
}

function LoadingSession() {
  return <main className="session-loading" role="status">Restoring your secure session…</main>
}

export function ProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()

  if (auth.status === 'loading') return <LoadingSession />
  const identityCount = Number(Boolean(auth.patient)) + Number(Boolean(auth.provider)) + Number(auth.admin === true)
  if (auth.isAuthenticated && identityCount > 1 && !auth.workspace) return <Navigate to="/workspace" replace />
  if (auth.isAuthenticated && auth.workspace === 'admin' && auth.admin) return <Navigate to={adminRoutePrefix} replace />
  if (auth.isAuthenticated && auth.workspace === 'provider' && auth.provider) return <Navigate to="/provider" replace />
  if (auth.isAuthenticated && auth.providerSetup && !auth.patient && !auth.admin) return <Navigate to={auth.providerSetup.setupState === 'ready' && auth.providerSetup.accountStatus === 'active' ? getProviderWorkspacePath(auth.providerSetup.type) : '/provider/setup'} replace />
  if (!auth.isAuthenticated || !auth.patient) {
    if (auth.isAuthenticated && auth.admin) return <Navigate to={adminRoutePrefix} replace />
    if (auth.isAuthenticated && auth.provider) return <Navigate to="/provider" replace />
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, restoreFailed: auth.restoreError === true }} />
  }
  return <Outlet />
}

export function PatientOnboardingRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading') return <LoadingSession />
  const identityCount = Number(Boolean(auth.patient)) + Number(Boolean(auth.provider)) + Number(auth.admin === true)
  if (!auth.isAuthenticated || !auth.patient || (identityCount > 1 && !auth.workspace)) {
    if (auth.isAuthenticated && identityCount > 1 && !auth.workspace) return <Navigate to="/workspace" replace />
    if (auth.isAuthenticated && auth.admin && auth.workspace === 'admin') return <Navigate to={adminRoutePrefix} replace />
    if (auth.isAuthenticated && auth.provider && auth.workspace === 'provider') return <Navigate to="/provider" replace />
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, restoreFailed: auth.restoreError === true }} />
  }
  return <Outlet />
}

export function ProviderProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading') return <LoadingSession />
  if (!auth.isAuthenticated) {
    return <Navigate to="/provider/login" replace state={{ from: `${location.pathname}${location.search}`, restoreFailed: auth.restoreError === true }} />
  }
  const setupProvider = auth.providerSetup?.setupState === 'ready' && auth.providerSetup.accountStatus === 'active' ? auth.providerSetup : null
  const providerIdentity = auth.provider || setupProvider
  const identityCount = Number(Boolean(auth.patient)) + Number(Boolean(providerIdentity)) + Number(auth.admin === true)
  if (identityCount > 1 && !auth.workspace) return <Navigate to="/workspace" replace />
  if (auth.admin && auth.workspace === 'admin') return <Navigate to={adminRoutePrefix} replace />
  if (!providerIdentity) {
    if (auth.providerSetup && !auth.patient && !auth.admin) return <Navigate to="/provider/setup" replace />
    return <Navigate to={auth.patient ? '/dashboard' : '/provider/login'} replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  if (auth.patient && auth.workspace === 'patient') return <Navigate to="/dashboard" replace />
  const destination = getProviderWorkspacePath(providerIdentity.type)
  if (providerIdentity.type && destination !== '/provider' && location.pathname !== destination) return <Navigate to={destination} replace />
  if (providerIdentity.type === 'doctor' && ['/provider/nurse', '/provider/nurse-aide', '/provider/caregiver'].includes(location.pathname)) return <Navigate to="/provider" replace />
  return <Outlet />
}

export function IdentityProtectedRoute() {
  const auth = useAuth()
  if (auth.status === 'loading') return <LoadingSession />
  if (!auth.isAuthenticated || (!auth.patient && !auth.provider && !auth.admin)) return <Navigate to="/login" replace />
  return <Outlet />
}

export function AdminProtectedRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading') return <LoadingSession />
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  if (!auth.admin) return <Navigate to={auth.provider && !auth.patient ? '/provider' : '/dashboard'} replace />
  if (auth.patient || auth.provider) {
    if (!auth.workspace) return <Navigate to="/workspace" replace />
    if (auth.workspace === 'patient') return <Navigate to="/dashboard" replace />
    if (auth.workspace === 'provider') return <Navigate to="/provider" replace />
  }
  return <Outlet />
}

export function PublicOnlyRoute() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading') return <LoadingSession />
  // Registration is an explicit account-creation destination. Let its page
  // offer a safe choice when a session exists instead of redirecting silently.
  if (auth.isAuthenticated && location.pathname !== '/register') return <Navigate to={getPostLoginPath(auth, location.state)} replace />
  return <Outlet />
}
