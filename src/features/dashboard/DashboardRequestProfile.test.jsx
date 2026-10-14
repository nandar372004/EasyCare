import { MyCarePlanDashboard } from '../care-plan/MyCarePlanDashboard.jsx'
import { carePlanMedicationQueryKey } from '../../services/carePlanMedicationService.js'
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage.jsx'

const capture = vi.hoisted(() => ({ requests: [], groups: false, blockers: {}, respond: null, auth: { status: 'authenticated', user: { id: 'viewer' }, patient: { id: '81000000-0000-4000-8000-000000000001', full_name: 'Profiled Patient', date_of_birth: '1990-01-01' } } }))
const patientId = '81000000-0000-4000-8000-000000000001'
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => capture.auth }))
vi.mock('../../lib/supabase.js', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('https://profile.example.supabase.co', 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (url, init) => {
    const parsed = new URL(url)
    const resource = parsed.pathname.split('/').at(-1)
    capture.requests.push({ resource, query: parsed.search, body: init.body, startedAt: performance.now() })
    if (capture.blockers[resource]) await capture.blockers[resource]
    let rows = []
    if (resource === 'patients') rows = [{ id: patientId, full_name: 'Profiled Patient', date_of_birth: '1990-01-01', status: 'active' }]
    if (resource === 'get_my_patient_onboarding') rows = { status: 'completed' }
    if (resource === 'get_my_reported_health_intake') rows = { items: [] }
    if (resource === 'get_my_family_groups' && capture.groups) rows = [{ id: 'g' }]
    if (resource === 'get_family_health_members') rows = [{ member_id: '81000000-0000-4000-8000-000000000009', patient_id: '81000000-0000-4000-8000-000000000002', display_name: 'Shared Relative', authorization: { status: 'active', records: true, appointments: true, medications: true, alerts: true, care_plans: true } }]
    if (capture.respond) rows = capture.respond(resource, parsed.searchParams, rows, init.body ? JSON.parse(init.body) : null)
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } } })
  return { supabase: client, supabaseConfiguration: { mode: 'supabase' } }
})
const clients = []
const newClient = () => { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); return client }
const page = (client, content = <DashboardPage />) => <QueryClientProvider client={client}><MemoryRouter>{content}</MemoryRouter></QueryClientProvider>
const settled = async () => {
  await screen.findByText('No medication actions for today.')
  await waitFor(() => expect(screen.queryByText('Loading health trends…')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading family care…' })).not.toBeInTheDocument())
}
beforeEach(() => { capture.requests = []; capture.groups = false; capture.blockers = {}; capture.respond = null; capture.auth = { status: 'authenticated', user: { id: 'viewer' }, patient: { id: patientId, full_name: 'Profiled Patient', date_of_birth: '1990-01-01' } } })
afterEach(() => { clients.forEach(client => client.clear()); clients.length = 0 })
describe('Dashboard real request serialization profile', () => {
  it.each([false, true])('captures a cold adult dashboard, authorized family present: %s', async groups => {
    capture.groups = groups
    const client = newClient()
    render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>)
    await screen.findByText('No medication actions for today.')
    await waitFor(() => expect(screen.queryByText('Loading health trends…')).not.toBeInTheDocument())
    expect(screen.queryByRole('article', { name: 'Family Care Today' })).not.toBeInTheDocument()
    const resources = Object.fromEntries([...new Set(capture.requests.map(row => row.resource))].sort().map(resource => [resource, capture.requests.filter(row => row.resource === resource).length]))
    console.info(JSON.stringify({ phase: 'after', groups, requests: capture.requests.length, resources }))
    expect(capture.requests).toHaveLength(groups ? 36 : 24)
    expect(capture.requests.some(row => ['profiles','patients','vital_readings'].includes(row.resource))).toBe(false)
    for (const resource of ['patient_medications', 'appointments', 'monitoring_alerts']) expect(capture.requests.filter(row => row.resource === resource && row.query.includes(patientId))).toHaveLength(1)
    for (const resource of ['patient_monitoring_plans', 'patient_monitoring_plan_times', 'patient_monitoring_check_ins']) expect(resources[resource]).toBe(1)
    client.clear()
  })
})



it('renders the shell and fast cards while family and monitoring sources are still pending', async () => {
  let finishFamily, finishMonitoring
  capture.blockers.get_my_family_groups = new Promise(resolve => { finishFamily = resolve })
  capture.blockers.patient_monitoring_plans = new Promise(resolve => { finishMonitoring = resolve })
  render(page(newClient()))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Profiled Patient')
  expect(screen.getByText('Cervical Spondylosis')).toBeInTheDocument()
  await screen.findByText('No medication actions for today.')
  expect(screen.getByText('No upcoming appointment.')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'Loading family care…' })).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Loading health trends…' })).toBeInTheDocument()
  expect(capture.requests.some(row => row.resource === 'patient_monitoring_plan_times')).toBe(true)
  expect(capture.requests.some(row => row.resource === 'patient_monitoring_check_ins')).toBe(true)
  await act(async () => { finishFamily(); finishMonitoring() })
  await settled()
})
it('coalesces StrictMode effects and shares every ordinary resource on a fresh route revisit', async () => {
  const client = newClient()
  const view = render(page(client, <StrictMode><DashboardPage /></StrictMode>))
  await settled()
  expect(capture.requests).toHaveLength(24)
  const clinicalCount = capture.requests.filter(row => row.resource === 'patient_medications').length
  view.rerender(page(client, <div>Another route</div>))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  view.rerender(page(client))
  await settled()
  expect(capture.requests.filter(row => row.resource === 'patient_medications')).toHaveLength(clinicalCount)
  expect(capture.requests.filter(row => row.resource === 'patient_monitoring_plans')).toHaveLength(1)
  expect(capture.requests.filter(row => row.resource === 'get_my_reported_health_intake')).toHaveLength(1)
  expect(capture.requests.filter(row => row.resource === 'appointments')).toHaveLength(1)
  expect(capture.requests.filter(row => row.resource === 'get_my_family_groups')).toHaveLength(2)
})
it('keeps successful ordinary data visible during an explicit section refresh', async () => {
  const client = newClient()
  render(page(client)); await settled()
  let finish
  capture.blockers.medication_events = new Promise(resolve => { finish = resolve })
  await act(async () => { void client.invalidateQueries({ predicate: query => query.queryKey.at(-1) === 'medications' }) })
  await screen.findByText('Refreshing…')
  const card = within(screen.getByRole('article', { name: "Today's Medications" }))
  expect(card.getByText('No medication actions for today.')).toBeInTheDocument()
  expect(card.queryByText('Loading…')).not.toBeInTheDocument()
  await act(async () => finish())
  await waitFor(() => expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument())
})
it('does not refetch monitoring when the trend metric or period changes', async () => {
  capture.respond = (resource, params, rows) => {
    if (resource === 'patient_monitoring_plans') return [
      { id: 'bp', title: 'BP', measurement_type: 'blood_pressure', measurement_unit: 'mmHg' },
      { id: 'weight', title: 'Weight', measurement_type: 'weight', measurement_unit: 'kg' },
    ]
    if (resource === 'patient_monitoring_check_ins') return [
      { monitoring_plan_id: 'bp', local_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), status: 'done', systolic_value: 120, diastolic_value: 80, measurement_unit: 'mmHg' },
      { monitoring_plan_id: 'weight', local_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), status: 'done', measurement_value: '58.5', measurement_unit: 'kg' },
    ]
    return rows
  }
  render(page(newClient()))
  const measurement = await screen.findByLabelText('Measurement')
  const count = capture.requests.filter(row => row.resource.startsWith('patient_monitoring')).length
  fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } })
  fireEvent.change(measurement, { target: { value: 'weight' } })
  expect(screen.getAllByText('58.5 kg').length).toBeGreaterThan(0)
  expect(capture.requests.filter(row => row.resource.startsWith('patient_monitoring'))).toHaveLength(count)
})
it('hides the previous account immediately and fetches with a separate viewer/patient cache', async () => {
  capture.respond = (resource, params, rows) => resource === 'patient_medications' ? [{ id: '81000000-0000-4000-8000-000000000009', patient_id: patientId, medication_name: 'Private previous medication', frequency: 'daily', status: 'active' }] : rows
  const client = newClient()
  const view = render(page(client))
  await screen.findByText('Private previous medication', { selector: 'strong' })
  capture.auth = { status: 'authenticated', user: { id: 'other-viewer' }, patient: { id: '81000000-0000-4000-8000-000000000003', full_name: 'Other patient', date_of_birth: '1990-01-01' } }
  capture.respond = null
  view.rerender(page(client))
  expect(screen.queryByText('Private previous medication')).not.toBeInTheDocument()
  await settled()
  expect(capture.requests.filter(row => row.resource === 'patient_medications')).toHaveLength(2)
  expect(client.getQueryCache().getAll().some(query => query.queryKey[1] === 'other-viewer' && query.queryKey[2] === capture.auth.patient.id)).toBe(true)
})



it('shares My Care Plan medication actions, Done updates and reverted states with Dashboard', async () => {
  const clinicalId = '81000000-0000-4000-8000-000000000010'
  const prnId = '81000000-0000-4000-8000-000000000011'
  const medication = { id: clinicalId, patient_id: patientId, medication_name: 'Shared tracked medicine', dose: 'Recorded dose', frequency: 'twice daily', status: 'active', medication_schedules: [] }
  capture.respond = (resource, params, rows, body) => {
    if (resource === 'patient_medications') return [medication, { ...medication, id: prnId, medication_name: 'Shared PRN medicine', frequency: 'as needed' }]
    if (resource === 'get_my_reported_health_intake') return { items: [{ id: 'untracked', itemType: 'medication', entryKind: 'item', source: 'patient_reported', name: 'Untracked broader-list entry', details: { frequency: 'daily' } }] }
    if (resource === 'record_patient_medication_check_in') return { id: 'check', patient_medication_id: body.target_medication_id, occurrence_index: body.target_occurrence_index, is_prn: false, status: 'taken', local_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
    return rows
  }
  const client = newClient()
  render(page(client, <><DashboardPage /><MyCarePlanDashboard /></>))
  const dashboard = within(screen.getByRole('article', { name: "Today's Medications" }))
  const carePlan = within(screen.getByRole('region', { name: 'My Medications' }))
  await dashboard.findByText('Shared tracked medicine · Recorded dose')
  await carePlan.findByText('Shared tracked medicine · Recorded dose')
  expect(dashboard.queryByText('Untracked broader-list entry')).not.toBeInTheDocument()
  expect(carePlan.getByText('Untracked broader-list entry')).toBeInTheDocument()
  expect(dashboard.getByText('0 of 2 required doses completed')).toBeInTheDocument()
  expect(dashboard.getByText('Dose 1')).toBeInTheDocument()
  expect(dashboard.getByText('Dose 2')).toBeInTheDocument()
  expect(capture.requests.filter(row => row.resource === 'patient_medications' && row.query.includes(patientId))).toHaveLength(1)
  expect(capture.requests.filter(row => row.resource === 'patient_medication_check_ins')).toHaveLength(1)
  expect(capture.requests.filter(row => row.resource === 'medication_events')).toHaveLength(1)
  const medicationReads = capture.requests.filter(row => ['patient_medications','medication_events','patient_medication_check_ins','get_my_reported_health_intake'].includes(row.resource)).length
  fireEvent.click(carePlan.getAllByRole('button', { name: 'Done' })[0])
  await dashboard.findByText('1 of 2 required doses completed')
  expect(carePlan.getByText(/✓ Done/)).toBeInTheDocument()
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  // The current storage has taken-only check-ins and no Reopen write. A
  // refreshed/reverted source snapshot removes that occurrence in both views.
  act(() => client.setQueryData(carePlanMedicationQueryKey('viewer', patientId, day), current => ({ ...current, checkIns: [] })))
  await dashboard.findByText('0 of 2 required doses completed')
  expect(carePlan.queryByText(/✓ Done/)).not.toBeInTheDocument()
  expect(carePlan.getAllByRole('button', { name: 'Done' })).toHaveLength(2)
  expect(capture.requests.filter(row => ['patient_medications','medication_events','patient_medication_check_ins','get_my_reported_health_intake'].includes(row.resource))).toHaveLength(medicationReads)
  expect(dashboard.getByRole('link', { name: 'View Medications' })).toHaveAttribute('href', '/my-care-plan#care-my-medications')
})
