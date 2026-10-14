import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { getProviderTypeLabel } from './providerTypeLabels.js'
import { getProviderWorkspacePath } from './providerWorkspaceRouting.js'

export function WorkspaceChoicePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  if (auth.patient && !auth.provider && !auth.admin) return <Navigate to="/dashboard" replace />
  if (auth.provider && !auth.patient && !auth.admin) return <Navigate to={getProviderWorkspacePath(auth.provider.type)} replace />
  if (auth.admin && !auth.patient && !auth.provider) return <Navigate to="/admin/provider-applications" replace />
  if (!auth.patient && !auth.provider && !auth.admin) return <Navigate to="/login" replace />
  function choose(workspace) {
    const destination = workspace === 'provider' ? getProviderWorkspacePath(auth.provider.type) : workspace === 'admin' ? '/admin/provider-applications' : '/dashboard'
    if (auth.switchWorkspace(workspace)) navigate(destination, { replace: true })
  }
  const options = [
    auth.patient && ['patient', 'Patient Dashboard'],
    auth.provider && ['provider', `Provider Workspace · ${getProviderTypeLabel(auth.provider.type)}`],
    auth.admin && ['admin', 'Admin Provider Review'],
  ].filter(Boolean)
  return <main className="workspace-choice-page"><section className="card workspace-choice-card"><span className="eyebrow">EasyCare</span><h1>Choose where you want to go</h1><p>This account has access to more than one EasyCare workspace. Choose a destination to continue.</p><div className="workspace-choice-options">{options.map(([workspace, label]) => <button className="button button--primary" type="button" key={workspace} onClick={() => choose(workspace)}>{label}</button>)}</div></section></main>
}
