import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Outlet, useNavigate } from 'react-router-dom'
import App from './App.jsx'
const { auth } = vi.hoisted(() => ({ auth: { status: 'authenticated', isAuthenticated: true, user: { id: 'viewer' }, patient: { id: 'patient', date_of_birth: '1990-01-01' }, provider: null } }))
vi.mock('./features/auth/AuthContext.jsx', () => ({ AuthProvider: ({ children }) => children, useAuth: () => auth }))
vi.mock('./app/AppShell.jsx', () => ({ AppShell: () => <Outlet /> }))
vi.mock('./features/family/FamilyPage.jsx', () => ({ FamilyPage: () => <h1>Health Circle destination</h1> }))
vi.mock('./features/family/FamilyHealthPage.jsx', () => ({ FamilyHealthPage: () => <h1>Shared care destination</h1> }))
vi.mock('./features/family/FamilyCommandCenterPage.jsx', () => ({ FamilyCommandCenterPage: () => <h1>Family overview destination</h1> }))
vi.mock('./features/appointments/AppointmentsPage.jsx', () => ({ AppointmentsPage: () => <h1>Appointment destination</h1> }))
vi.mock('./features/care-plan/MyCarePlanDashboard.jsx', () => ({ MyCarePlanDashboard: () => <h1>Own care plan destination</h1> }))
vi.mock('./features/health/MedicalDocumentsPage.jsx', () => ({ MedicalDocumentsPage: () => <h1>Documents destination</h1> }))
vi.mock('./features/health/HealthPages.jsx', () => ({ MedicationsPage: () => <h1>Medications destination</h1>, HealthRecordsPage: () => null, LabResultsPage: () => null, PrescriptionsPage: () => null }))
vi.mock('./features/dashboard/DashboardPage.jsx', () => ({ DashboardPage: () => <h1>Own dashboard destination</h1> }))
vi.mock('./features/auth/LoginPage.jsx', () => ({ LoginPage: () => <h1>Sign in destination</h1> }))
const destinations = [
  ['/family/overview', 'Family overview destination'], ['/family', 'Health Circle destination'],
  ['/family/health?groupId=g&memberId=m', 'Shared care destination'], ['/appointments/a', 'Appointment destination'],
  ['/my-care-plan', 'Own care plan destination'], ['/medical-documents?factId=f#medical-document-d', 'Documents destination'],
  ['/medications', 'Medications destination'], ['/dashboard', 'Own dashboard destination'],
]
beforeEach(() => { auth.status = 'authenticated'; auth.isAuthenticated = true; auth.patient = { id: 'patient', date_of_birth: '1990-01-01' }; auth.provider = null; auth.workspace = 'patient' })
describe('real application CTA routes and patient guards', () => {
  it.each(destinations)('registers the patient destination %s', async (path, heading) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })
  it.each(destinations)('requires patient sign-in for direct access to %s', async path => {
    auth.status = 'anonymous'; auth.isAuthenticated = false; auth.patient = null
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Sign in destination' })).toBeInTheDocument()
  })
  it('returns to the overview through browser history', async () => {
    function Back() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Test back</button> }
    render(<MemoryRouter initialEntries={['/family/overview', '/appointments/a']} initialIndex={1}><Back /><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Appointment destination' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Test back' }))
    expect(await screen.findByRole('heading', { name: 'Family overview destination' })).toBeInTheDocument()
  })
})
