import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router-dom'
import App from './App.jsx'

const { state, service } = vi.hoisted(() => ({
  state: { status: 'authenticated', patient: { id: 'patient-own' }, isAuthenticated: true },
  service: { listMyPlans: vi.fn(), getDetail: vi.fn(), getOccurrences: vi.fn(), reconcileOccurrences: vi.fn(), acknowledgeOccurrence: vi.fn() },
}))
vi.mock('./features/auth/AuthContext.jsx', () => ({ AuthProvider: ({ children }) => children, useAuth: () => state }))
vi.mock('./features/auth/RouteGuards.jsx', () => ({ ProtectedRoute: () => createElement(Outlet), ProviderProtectedRoute: () => createElement(Outlet), IdentityProtectedRoute: () => createElement(Outlet), AdminProtectedRoute: () => createElement(Outlet), PatientOnboardingRoute: () => createElement(Outlet), PublicOnlyRoute: () => createElement(Outlet) }))
vi.mock('./app/AppShell.jsx', () => ({ AppShell: () => createElement(Outlet) }))
vi.mock('./services/carePlanService.js', () => ({ carePlanService: service }))
vi.mock('./services/patientMonitoringService.js', () => ({
  patientMonitoringService: { listMyPlans: vi.fn().mockResolvedValue([]), listMyCheckIns: vi.fn().mockResolvedValue([]) },
  isScheduledOn: () => false,
}))

beforeEach(() => { cleanup(); vi.clearAllMocks(); service.listMyPlans.mockResolvedValue([]) })

describe('application Care Plan routes', () => {
  it('registers /my-care-plan as the connected patient dashboard', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/my-care-plan']}><App /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: 'My Health Goals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Monitoring Plan' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Key Health Conditions' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Medications' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Upcoming Appointments' })).toBeInTheDocument()
  })
  it('does not accept a patient ID route segment', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/my-care-plan/other-patient']}><App /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(service.listMyPlans).not.toHaveBeenCalled()
  })
  it('keeps the existing /care-plan route on the Home Care request wizard', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/care-plan']}><App /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: 'Request Professional Home Care' })).toBeInTheDocument()
    expect(service.listMyPlans).not.toHaveBeenCalled()
  })
})


it('focuses the existing My Medications heading from the Dashboard section link', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/my-care-plan#care-my-medications']}><App /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'My Medications' })).toHaveFocus()
})
