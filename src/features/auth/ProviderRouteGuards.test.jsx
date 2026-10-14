import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminProtectedRoute, ProviderProtectedRoute, ProtectedRoute, getPostLoginPath } from './RouteGuards.jsx'

const auth = vi.hoisted(() => ({ value: null }))
vi.mock('./AuthContext.jsx', () => ({ useAuth: () => auth.value }))
afterEach(() => cleanup())

describe('role-separated routes', () => {
  it.each([
    ['doctor','/provider'],['nurse','/provider/nurse'],['nurse_aide','/provider/nurse-aide'],
    ['skilled_nurse_aide','/provider/nurse-aide'],['special_nurse','/provider/nurse-aide'],['caregiver','/provider/caregiver'],
  ])('routes %s to its own workspace and rejects an inappropriate return path', (type,path) => {
    expect(getPostLoginPath({provider:{id:'verified',type}},{from:'/dashboard'})).toBe(path)
    expect(getPostLoginPath({provider:{id:'verified',type}},{from:'/provider/apply'})).toBe(path)
  })
  it('routes patients and admins to their existing authorized workspaces', () => {
    expect(getPostLoginPath({patient:{id:'patient'}},{from:'/provider/apply'})).toBe('/dashboard')
    expect(getPostLoginPath({admin:true},{from:'/provider'})).toBe('/admin/provider-applications')
  })
  it.each([
    ['doctor', '/provider'], ['nurse_aide', '/provider/nurse-aide'],
    ['skilled_nurse_aide', '/provider/nurse-aide'], ['special_nurse', '/provider/nurse-aide'],
  ])('routes setup-ready %s accounts to their provider workspace', (type, path) => {
    expect(getPostLoginPath({ providerSetup: { type, accountStatus: 'active', setupState: 'ready' } })).toBe(path)
    expect(getPostLoginPath({ providerSetup: { type, accountStatus: 'active', setupState: 'setup_required' } })).toBe('/provider/setup')
  })
  it.each([['nurse','/provider/nurse'],['nurse_aide','/provider/nurse-aide'],['caregiver','/provider/caregiver']])('keeps %s out of the doctor appointment interface',async(type,path)=>{
    auth.value={status:'authenticated',isAuthenticated:true,provider:{id:'verified',type},patient:null}
    render(<MemoryRouter initialEntries={['/provider/appointments']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider/appointments" element={<div>Doctor actions</div>}/><Route path={path} element={<div>Category workspace</div>}/></Route></Routes></MemoryRouter>)
    expect(await screen.findByText('Category workspace')).toBeInTheDocument()
    expect(screen.queryByText('Doctor actions')).not.toBeInTheDocument()
  })
  it('allows provider identity to enter only provider routes', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, provider: { id: 'verified-provider' }, patient: null }
    render(<MemoryRouter initialEntries={['/provider']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider" element={<div>Provider workspace</div>} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /></Routes></MemoryRouter>)
    expect(screen.getByText('Provider workspace')).toBeInTheDocument()
  })
  it('redirects provider-only identity away from patient routes', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, provider: { id: 'verified-provider' }, patient: null }
    render(<MemoryRouter initialEntries={['/dashboard']}><Routes><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Route><Route path="/provider" element={<div>Provider workspace</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Provider workspace')).toBeInTheDocument()
    expect(screen.queryByText('Patient dashboard')).not.toBeInTheDocument()
  })
  it('allows patient identity into the Medical Documents patient route', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, provider: null, patient: { id: 'patient-id' }, workspace: 'patient' }
    render(<MemoryRouter initialEntries={['/medical-documents']}><Routes><Route element={<ProtectedRoute />}><Route path="/medical-documents" element={<div>Medical Documents</div>} /></Route><Route path="/provider" element={<div>Provider workspace</div>} /></Routes></MemoryRouter>)
    expect(screen.getByText('Medical Documents')).toBeInTheDocument()
  })
  it('rejects patient-only identity from provider routes', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, provider: null, patient: { id: 'patient-id' } }
    render(<MemoryRouter initialEntries={['/provider/patients']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider/patients" element={<div>Provider patients</div>} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Patient dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Provider patients')).not.toBeInTheDocument()
  })
  it('redirects anonymous access to provider sign-in', async () => {
    auth.value = { status: 'anonymous', isAuthenticated: false, provider: null, patient: null }
    render(<MemoryRouter initialEntries={['/provider']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider" element={<div>Provider workspace</div>} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Provider login')).toBeInTheDocument()
  })

  it('keeps an approved provider out of admin routes', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, provider: { id: 'verified-provider' }, patient: null, admin: false }
    render(<MemoryRouter initialEntries={['/admin/provider-applications']}><Routes><Route element={<AdminProtectedRoute />}><Route path="/admin/provider-applications" element={<div>Admin queue</div>} /></Route><Route path="/provider" element={<div>Provider workspace</div>} /><Route path="/dashboard" element={<div>Patient dashboard</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Provider workspace')).toBeInTheDocument()
    expect(screen.queryByText('Admin queue')).not.toBeInTheDocument()
  })

  it('keeps a main admin without provider identity out of Provider Workspace', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, admin: true, provider: null, patient: null, workspace: 'admin' }
    render(<MemoryRouter initialEntries={['/provider']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider" element={<div>Provider workspace</div>} /></Route><Route path="/provider/login" element={<div>Provider login</div>} /><Route path="/admin/provider-applications" element={<div>Admin queue</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Admin queue')).toBeInTheDocument()
    expect(screen.queryByText('Provider workspace')).not.toBeInTheDocument()
  })

  it('routes an authenticated setup-required provider to provider setup without signing out', async () => {
    auth.value = { status: 'authenticated', isAuthenticated: true, session: { user: { id: 'invited-provider' } }, providerSetup: { id: 'provider-id', type: 'doctor', accountStatus: 'invited', setupState: 'setup_required' }, provider: null, patient: null, admin: false }
    render(<MemoryRouter initialEntries={['/provider/appointments']}><Routes><Route element={<ProviderProtectedRoute />}><Route path="/provider/appointments" element={<div>Doctor workspace</div>} /></Route><Route path="/provider/setup" element={<div>Provider setup</div>} /><Route path="/provider/login" element={<div>Provider login</div>} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Provider setup')).toBeInTheDocument()
    expect(screen.queryByText('Provider login')).not.toBeInTheDocument()
  })

  it('routes a setup-ready provider to the provider-type workspace', async () => {
    const identity = { providerSetup: { id: 'provider-id', type: 'nurse', accountStatus: 'active', setupState: 'ready' } }
    expect(getPostLoginPath(identity)).toBe('/provider/nurse')
    expect(getPostLoginPath({ providerSetup: { ...identity.providerSetup, setupState: 'setup_required' } })).toBe('/provider/setup')
  })
})
