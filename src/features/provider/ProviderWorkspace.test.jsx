import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProviderProtectedRoute } from '../auth/RouteGuards.jsx'
import { ProviderCarePlansPlaceholder, ProviderPatientsPage, ProviderShell } from './ProviderWorkspace.jsx'
import { ProviderCarePlansPlaceholder as CarePlansPage, ProviderCarePlanWizardPage } from './ProviderCarePlans.jsx'
import { WorkspaceChoicePage } from './WorkspaceChoicePage.jsx'

const state = vi.hoisted(() => ({ auth: null, rows: [], plans: [], documents: [], documentCalls: [], rpc: {} }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => state.auth }))
vi.mock('../../services/providerWorkspaceService.js', () => ({ providerWorkspaceService: { listPatients: () => Promise.resolve(state.rows) } }))
vi.mock('../../services/medicalDocumentService.js', () => ({ medicalDocumentService: {
  list: () => Promise.resolve(state.documents),
  createSignedUrl: (...args) => { state.documentCalls.push(args); return Promise.resolve('https://signed.example/provider-file') },
} }))
vi.mock('../../services/carePlanService.js', () => ({ carePlanService: {
  listProviderPlans: () => Promise.resolve(state.plans),
  createDraft: (...args) => state.rpc.createDraft(...args), addGoal: (...args) => state.rpc.addGoal(...args), addTask: (...args) => state.rpc.addTask(...args),
  approveVersion: (...args) => state.rpc.approveVersion(...args), transition: (...args) => state.rpc.transition(...args),
  listProviderSources: (...args) => state.rpc.listProviderSources?.(...args) ?? Promise.resolve([]),
} }))
afterEach(() => cleanup())

describe('provider workspace boundary', () => {
  it('shows only rows supplied by the relationship-scoped RPC', async () => {
    state.auth = { status: 'authenticated', isAuthenticated: true, provider: { id: 'provider-id', displayName: 'Dr. Example' } }
    state.rows = [{ id: 'authorized-patient', displayName: 'Authorized Patient', relationshipContext: 'appointment' }]
    render(<MemoryRouter initialEntries={['/provider/patients']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider/patients" element={<ProviderPatientsPage />} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Authorized Patient')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated Patient')).not.toBeInTheDocument()
  })

  it('shows patient source documents and signed viewing only for a relationship-scoped selected patient', async () => {
    const user = userEvent.setup()
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    state.auth = { status: 'authenticated', isAuthenticated: true, provider: { id: 'provider-id', displayName: 'Dr. Example' } }
    state.rows = [{ id: 'authorized-patient', displayName: 'Authorized Patient', relationshipContext: 'appointment' }]
    state.documents = [{ id: 'doc-1', patient_id: 'authorized-patient', document_type: 'lab_report', title: 'Lab report', original_filename: 'lab.pdf', source: 'patient_upload', status: 'active' }]
    state.documentCalls = []
    render(<MemoryRouter initialEntries={['/provider/patients']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider/patients" element={<ProviderPatientsPage />} /></Route></Routes></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Select patient' }))
    expect(await screen.findByRole('heading', { name: 'Patient Medical Documents' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'View / Download' }))
    expect(state.documentCalls).toEqual([[state.documents[0], 'authorized-patient']])
    expect(opened).toHaveBeenCalledWith('https://signed.example/provider-file', '_blank', 'noopener,noreferrer')
    opened.mockRestore()
  })

  it('lists only plans returned by the provider-scoped plan contract', async () => {
    state.auth = { provider: { type: 'doctor' } }
    state.plans = [{ plan_id: 'plan-id', patient_id: 'patient-id', patient_name: 'Authorized Patient', status: 'draft', title: 'Clinician plan', version_no: 1, starts_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }]
    render(<MemoryRouter><CarePlansPage /></MemoryRouter>)
    expect(await screen.findByText('Clinician plan')).toBeInTheDocument()
    expect(screen.getByText('Authorized Patient')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated Patient')).not.toBeInTheDocument()
  })

  it('creates a clinician-authored draft, goal and manual task, then requires explicit activation', async () => {
    const user = userEvent.setup()
    const planId = 'plan-created'
    state.auth = { provider: { type: 'doctor' } }
    state.rows = [{ id: 'authorized-patient-id', displayName: 'Authorized Patient', relationshipContext: 'appointment' }]
    state.rpc = {
      createDraft: vi.fn().mockResolvedValue(planId), addGoal: vi.fn().mockResolvedValue('goal-id'), addTask: vi.fn().mockResolvedValue('task-id'),
      approveVersion: vi.fn().mockResolvedValue('version-id'), transition: vi.fn().mockResolvedValue(undefined),
    }
    render(<MemoryRouter initialEntries={['/provider/care-plans/new']}><Routes><Route path="/provider/care-plans/new" element={<ProviderCarePlanWizardPage />} /><Route path="/provider/care-plans/:planId" element={<div>Saved Care Plan detail</div>} /></Routes></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /authorized patient/i }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Plan title'), 'Monitoring plan')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Goal title'), 'Track daily progress')
    await user.click(screen.getByRole('button', { name: 'Add goal' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Task title'), 'Record a note')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Review Care Plan')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to Activation' }))
    const confirm = screen.getByRole('checkbox', { name: /confirm activating it/i })
    expect(confirm).not.toBeChecked()
    await user.click(confirm)
    await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByText('Saved Care Plan detail')).toBeInTheDocument()
    expect(state.rpc.createDraft).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'authorized-patient-id', title: 'Monitoring plan' }))
    expect(state.rpc.addGoal).toHaveBeenCalledOnce()
    expect(state.rpc.addTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'instruction', manualAcknowledgement: true }))
    expect(state.rpc.approveVersion).toHaveBeenCalledWith(planId)
    expect(state.rpc.transition).toHaveBeenCalledWith(planId, 'activate')
  })

  it('offers only server-resolved workspaces to a dual-identity account', async () => {
    const switchWorkspace = vi.fn(() => true)
    state.auth = { patient: { id: 'patient-id' }, provider: { id: 'provider-id', type: 'skilled_nurse_aide' }, switchWorkspace }
    render(<MemoryRouter><WorkspaceChoicePage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Choose where you want to go' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Patient Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Provider Workspace · Skilled Nurse Aide' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('labels the provider workspace with the authorized provider type', () => {
    state.auth = { provider: { id: 'provider-id', type: 'special_nurse', displayName: 'Synthetic Provider' }, patient: null, admin: false, signOut: vi.fn() }
    render(<MemoryRouter initialEntries={['/provider']}><Routes><Route path="/provider" element={<ProviderShell />} /></Routes></MemoryRouter>)
    expect(screen.getByText('Special Nurse')).toBeInTheDocument()
  })
})
