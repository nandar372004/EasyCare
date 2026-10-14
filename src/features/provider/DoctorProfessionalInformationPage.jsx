import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { DoctorProfessionalInformationForm } from './DoctorProfessionalInformationForm.jsx'

export { calculateDoctorAge } from './DoctorProfessionalInformationForm.jsx'

export function DoctorProfessionalInformationPage() {
  const auth = useAuth()
  const identity = auth.provider || auth.providerSetup

  if (auth.status === 'loading') return <main className="doctor-professional-information"><p role="status">Loading your provider account…</p></main>
  if (!auth.isAuthenticated) return <Navigate to="/provider/login" replace />
  if (identity?.type !== 'doctor') return <main className="doctor-professional-information"><h1>Doctor Professional Information</h1><p>This form is available to doctor accounts only.</p></main>

  return <main className="doctor-professional-information">
    <header><div><span className="eyebrow">Doctor Portal</span><h1>Doctor Professional Information</h1><p>Save your personal and professional details to your private provider record.</p></div><Link className="button button--secondary" to={auth.provider ? '/provider/profile' : '/provider/setup'}>{auth.provider ? 'Back to Profile' : 'Continue Setup'}</Link></header>
    <DoctorProfessionalInformationForm providerId={identity.id} providerName={identity.displayName || identity.fullName} />
  </main>
}
