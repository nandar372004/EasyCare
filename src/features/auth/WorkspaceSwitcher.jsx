import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { getProviderTypeLabel } from '../provider/providerTypeLabels.js'
import { getProviderWorkspacePath } from '../provider/providerWorkspaceRouting.js'

const destinations = {
  patient: '/dashboard',
  provider: '/provider',
  admin: '/admin/provider-applications',
}

export function WorkspaceSwitcher() {
  const auth = useAuth()
  const navigate = useNavigate()
  const options = [
    auth.patient && { value: 'patient', label: 'Patient Dashboard' },
    auth.provider && { value: 'provider', label: `Provider Workspace · ${getProviderTypeLabel(auth.provider.type)}` },
    auth.admin && { value: 'admin', label: 'Admin Provider Review' },
  ].filter(Boolean)

  if (options.length < 2) return null

  function switchTo(event) {
    const workspace = event.target.value
    if (!destinations[workspace] || !auth.switchWorkspace(workspace)) return
    navigate(workspace === 'provider' ? getProviderWorkspacePath(auth.provider.type) : destinations[workspace])
  }

  return (
    <label className="workspace-switcher">
      <span className="sr-only">Switch workspace</span>
      <select aria-label="Switch workspace" value={auth.workspace || ''} onChange={switchTo}>
        {!auth.workspace && <option value="" disabled>Choose workspace</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}
