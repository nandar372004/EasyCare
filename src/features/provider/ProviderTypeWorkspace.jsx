import { useAuth } from '../auth/AuthContext.jsx'
import { getProviderTypeLabel } from './providerTypeLabels.js'

export function ProviderTypeWorkspace() {
  const { provider } = useAuth()
  const label = getProviderTypeLabel(provider?.type)
  return <section className="card"><span className="eyebrow">Provider Workspace</span><h1>{label} Workspace</h1><p>Welcome, {provider?.displayName}.</p><p>Your account is verified. Tools for your provider category are being prepared.</p></section>
}
