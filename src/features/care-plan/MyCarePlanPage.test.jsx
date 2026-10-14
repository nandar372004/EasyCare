import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MyCarePlanPage, planDayLabel } from './MyCarePlanPage.jsx'
import { CarePlanPage } from './CarePlanPage.jsx'
import { CarePlanDashboardSummary } from '../dashboard/CarePlanDashboardSummary.jsx'
import { primaryNavigation } from '../../data/navigation.js'
import { Sidebar } from '../../components/Sidebar.jsx'
import { BottomNav } from '../../components/BottomNav.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

const { auth, familyMocks, catalogMocks } = vi.hoisted(() => ({
  auth: { status: 'authenticated', patient: { id: 'patient-own', full_name: 'Nandar Kyaw' }, user: { id: 'profile-own' } },
  familyMocks: { getGroups: vi.fn(), getMembers: vi.fn() },
  catalogMocks: { listPackages: vi.fn(), quote: vi.fn() },
}))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/familyHealthService.js', () => ({ familyHealthService: familyMocks }))
vi.mock('../../services/carePlanCatalogService.js', () => ({ carePlanCatalogService: catalogMocks }))

const now = new Date('2026-10-03T10:00:00.000Z')
const summary = (id = 'plan-a', patientId = 'patient-own', status = 'active', title = 'Recorded recovery plan') => ({
  id, patient_id: patientId, status, timezone: 'Asia/Yangon', starts_at: '2026-09-29T18:00:00.000Z', target_end_at: '2026-10-12T18:00:00.000Z', updated_at: '2026-10-02T08:00:00.000Z',
  current_version: { id: `${id}-v1`, version_no: 1, title, summary: null, instructions: 'Use the provider instructions as written.' },
  progress: { today: { state: 'tasks_due', completed: 1, total: 3, percent: 33 } },
})
const row = (id, taskId, scheduledAt, extra = {}) => ({ id, task_id: taskId, local_due_date: '2026-10-03', scheduled_at: scheduledAt, timezone: 'Asia/Yangon', status: 'pending', required: true, completed: false, ...extra })
const detail = (plan = summary(), tasks = [], goals = []) => ({
  plan: { id: plan.id, patient_id: plan.patient_id, status: plan.status, timezone: plan.timezone, starts_at: plan.starts_at, target_end_at: plan.target_end_at, updated_at: plan.updated_at, current_version_id: plan.current_version.id },
  versions: [{ ...plan.current_version, created_at: plan.updated_at }], tasks, goals, progress: plan.progress,
})
const makeService = ({ plans = [summary()], tasks = [], occurrences = [], goals = [], detailValue, progress } = {}) => {
  const planDetail = detailValue || detail(plans[0] || summary(), tasks, goals)
  if (progress) planDetail.progress = progress
  return {
    listMyPlans: vi.fn().mockResolvedValue(plans), getDetail: vi.fn().mockResolvedValue(planDetail),
    getOccurrences: vi.fn().mockResolvedValue(occurrences), reconcileOccurrences: vi.fn().mockResolvedValue(0),
    acknowledgeOccurrence: vi.fn().mockResolvedValue(undefined),
  }
}
const renderPage = (service, initialEntry = '/my-care-plan') => render(<MemoryRouter initialEntries={[initialEntry]}><Routes><Route path="/my-care-plan" element={<MyCarePlanPage service={service} nowProvider={() => now} />} /><Route path="*" element={<p>Not found</p>} /></Routes></MemoryRouter>)
const task = (id, type, title, extra = {}) => ({ id, version_id: 'plan-a-v1', task_type: type, title, instructions: null, required: true, manual_acknowledgement: false, ...extra })

beforeEach(() => {
  auth.status = 'authenticated'; auth.patient = { id: 'patient-own', full_name: 'Nandar Kyaw' }; auth.user = { id: 'profile-own' }
  familyMocks.getGroups.mockReset().mockResolvedValue([])
  familyMocks.getMembers.mockReset().mockResolvedValue([])
  catalogMocks.listPackages.mockReset().mockResolvedValue([{
    id: 'ec000000-0000-4000-8000-000000000001', code: 'basic-elderly', name: 'Basic Elderly Care',
    allowedDurationDays: [1, 3, 7, 14, 30],
    levels: [{ id: 'ec100000-0000-4000-8000-000000000001', code: 'nurse-aide', name: 'Nurse Aide', unitPrice: 36000, currency: 'MMK' }],
  }])
  catalogMocks.quote.mockImplementation(async (_packageId, _serviceId, days) => ({
    package_code: 'basic-elderly', care_level_code: 'nurse-aide', duration_days: days,
    unit_price: '36000.00', subtotal: String(36000 * days), commission_percent: '17',
    provider_amount: String(Math.round(36000 * days * .83)), commission_amount: String(36000 * days - Math.round(36000 * days * .83)), currency: 'MMK',
  }))
})
afterEach(() => cleanup())

describe('patient My Care Plan', () => {
  it('derives day number using plan timezone calendar dates, including without a target', () => {
    const plan = summary()
    expect(planDayLabel(plan, now)).toBe('Day 4 of 14')
    expect(planDayLabel({ ...plan, target_end_at: null }, now)).toBe('Day 4')
    expect(planDayLabel({ ...plan, starts_at: '2026-10-05T00:00:00Z' }, now)).toBeNull()
  })
  it('renders the patient route and honest no-plan state without suggesting a purchase creates a clinical plan', async () => {
    const service = makeService({ plans: [] })
    renderPage(service)
    expect(await screen.findByRole('heading', { name: 'No active care plan' })).toBeInTheDocument()
    expect(screen.getByText(/will appear here when your care provider creates one/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore Home Care separately' })).toHaveAttribute('href', '/care-plan')
    expect(service.getDetail).not.toHaveBeenCalled()
  })
  it('uses the authenticated patient identity, filters foreign plan rows, and ignores an arbitrary query ID', async () => {
    const service = makeService({ plans: [summary('foreign', 'patient-other'), summary()] })
    renderPage(service, '/my-care-plan?patientId=patient-other')
    expect(await screen.findByRole('heading', { name: "Today's Progress" })).toBeInTheDocument()
    expect(service.listMyPlans).toHaveBeenCalledWith()
    expect(service.getDetail).toHaveBeenCalledWith('plan-a')
    expect(screen.queryByText(/patient-other/)).not.toBeInTheDocument()
  })
  it('renders real plan status and title with backend progress and an accessible progress indicator', async () => {
    const plan = summary()
    const service = makeService({ plans: [plan], tasks: [task('t1', 'activity', 'Walk as advised')], occurrences: [row('o1', 't1', '2026-10-03T08:00:00Z')] })
    renderPage(service)
    expect(await screen.findByRole('heading', { name: 'Recorded recovery plan' })).toBeInTheDocument()
    await screen.findByRole('heading', { name: "Today's Progress" })
    expect(screen.getByText('Active care plan')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: "Today's care tasks completed" })).toHaveAttribute('max', '3')
    expect(screen.getByRole('progressbar', { name: "Today's care tasks completed" })).toHaveAttribute('value', '1')
    expect(screen.getByText('Day 4 of 14')).toBeInTheDocument()
    expect(screen.getByText('Use the provider instructions as written.')).toBeInTheDocument()
    expect(service.reconcileOccurrences).toHaveBeenCalledWith('plan-a')
  })
  it('shows no_tasks_due semantically without a percentage or zero progress bar', async () => {
    const plan = summary(); plan.progress = { today: { state: 'no_tasks_due', completed: 0, total: 0, percent: null } }
    const service = makeService({ plans: [plan], progress: plan.progress })
    renderPage(service)
    expect((await screen.findAllByText('No care tasks due today')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/0%|100%/)).not.toBeInTheDocument()
  })
  it('orders today occurrences deterministically and shows real upcoming required occurrence', async () => {
    const tasks = [task('late', 'activity', 'Later activity'), task('early', 'instruction', 'Earlier instruction'), task('tomorrow', 'appointment', 'Tomorrow follow-up', { appointment: { id: 'appointment-1' } })]
    const occurrences = [row('o-late', 'late', '2026-10-03T09:30:00Z'), row('o-early', 'early', '2026-10-03T08:00:00Z'), row('o-tomorrow', 'tomorrow', '2026-10-04T04:00:00Z', { local_due_date: '2026-10-04' })]
    const service = makeService({ tasks, occurrences })
    renderPage(service)
    await screen.findByRole('heading', { name: 'Today' })
    const todayRegion = screen.getByRole('region', { name: 'Today' })
    const titles = within(todayRegion).getAllByRole('heading', { level: 3 }).map(item => item.textContent)
    expect(titles).toEqual(['Earlier instruction', 'Later activity'])
    expect(screen.getByText('Tomorrow follow-up')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View appointment' })).toHaveAttribute('href', '/appointments/appointment-1')
  })
  it.each(['medication', 'vital_check', 'appointment', 'follow_up'])('does not offer generic completion for %s tasks', async type => {
    const service = makeService({ tasks: [task('source-task', type, 'Source backed task', { manual_acknowledgement: true })], occurrences: [row('source-occurrence', 'source-task', '2026-10-03T08:00:00Z')] })
    renderPage(service)
    await screen.findByText('Source backed task')
    expect(screen.queryByRole('button', { name: /mark as done/i })).not.toBeInTheDocument()
    expect(service.acknowledgeOccurrence).not.toHaveBeenCalled()
  })
  it('allows an eligible due manual task and refreshes progress after acknowledgement', async () => {
    const plan = summary()
    const initial = detail(plan, [task('manual', 'activity', 'Walk as instructed', { manual_acknowledgement: true })])
    const updated = structuredClone(initial); updated.progress.today = { state: 'tasks_due', completed: 2, total: 3, percent: 67 }
    const service = makeService({ plans: [plan], detailValue: initial, occurrences: [row('manual-occ', 'manual', '2026-10-03T08:00:00Z')] })
    service.getDetail.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated)
    renderPage(service)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(service.acknowledgeOccurrence).toHaveBeenCalledWith('manual-occ'))
    await waitFor(() => expect(screen.getByRole('progressbar', { name: "Today's care tasks completed" })).toHaveAttribute('value', '2'))
    expect(screen.getByRole('status')).toHaveTextContent('Care task marked as done.')
  })
  it('does not offer acknowledgement when a manual task is not configured for it', async () => {
    const service = makeService({ tasks: [task('manual', 'instruction', 'Read provider note')], occurrences: [row('manual-occ', 'manual', '2026-10-03T08:00:00Z')] })
    renderPage(service)
    await screen.findByText('Read provider note')
    expect(screen.queryByRole('button', { name: /mark as done/i })).not.toBeInTheDocument()
  })
  it('requests reconciliation with only the plan ID and keeps detail visible if reconciliation fails', async () => {
    const service = makeService({ tasks: [task('t', 'medication', 'Morning dose')], occurrences: [row('o', 't', '2026-10-03T08:00:00Z')] })
    service.reconcileOccurrences.mockRejectedValue(new Error('offline'))
    renderPage(service)
    expect(await screen.findByText('Morning dose')).toBeInTheDocument()
    expect(await screen.findByText(/Some source records could not be refreshed/)).toBeInTheDocument()
    expect(service.reconcileOccurrences).toHaveBeenCalledTimes(1)
    expect(service.reconcileOccurrences).toHaveBeenCalledWith('plan-a')
    expect(service.reconcileOccurrences.mock.calls[0]).toHaveLength(1)
  })
  it('preserves plan progress and goals when only the occurrence projection fails', async () => {
    const service = makeService({ goals: [{ id: 'g', version_id: 'plan-a-v1', title: 'Real objective' }] })
    service.getOccurrences.mockRejectedValue(new Error('offline'))
    renderPage(service)
    expect(await screen.findByText('Real objective')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: "Today's care tasks completed" })).toBeInTheDocument()
    expect(screen.getByText("Today's care tasks could not be loaded.")).toBeInTheDocument()
    expect(screen.getByText('Upcoming tasks are unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('No upcoming care tasks')).not.toBeInTheDocument()
  })
  it('renders real goals and the no-goals and no-upcoming states', async () => {
    const service = makeService({ tasks: [task('past', 'custom', 'Completed window')], occurrences: [row('o', 'past', '2026-10-03T08:00:00Z', { completed: true })], goals: [{ id: 'g', version_id: 'plan-a-v1', title: 'Monitor as advised', description: 'Use the prescribed schedule.' }] })
    renderPage(service)
    expect(await screen.findByText('Monitor as advised')).toBeInTheDocument()
    expect(screen.getByText('Use the prescribed schedule.')).toBeInTheDocument()
    expect(screen.getByText('No upcoming care tasks')).toBeInTheDocument()
    cleanup()
    renderPage(makeService())
    expect(await screen.findByText('No care goals have been added to this plan yet.')).toBeInTheDocument()
  })
  it.each(['paused', 'completed', 'discontinued'])('communicates %s plan state and offers no lifecycle controls', async status => {
    const plan = summary('plan-a', 'patient-own', status)
    const service = makeService({ plans: [plan], tasks: [task('manual', 'activity', 'Read instructions', { manual_acknowledgement: true })], occurrences: [row('manual-occ', 'manual', '2026-10-03T08:00:00Z')] })
    renderPage(service)
    expect(await screen.findByText(`${status[0].toUpperCase()}${status.slice(1)} care plan`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activate|pause|resume|complete|discontinue|cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark as done/i })).not.toBeInTheDocument()
  })
  it('shows loading and network error states distinctly from no plan', async () => {
    const waiting = makeService(); waiting.listMyPlans.mockReturnValue(new Promise(() => {}))
    renderPage(waiting)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your care plan')
    cleanup()
    const failed = makeService(); failed.listMyPlans.mockRejectedValue(new Error('offline'))
    renderPage(failed)
    expect(await screen.findByRole('heading', { name: 'Unable to load your care plans' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No active care plan' })).not.toBeInTheDocument()
  })
  it('shows explicit selection instead of silently merging multiple active plans', async () => {
    const service = makeService({ plans: [summary('one'), summary('two', 'patient-own', 'active', 'Second plan')] })
    renderPage(service)
    expect(await screen.findByText('Select a plan to view its tasks and progress.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Choose a care plan' })).toBeInTheDocument()
    expect(service.getDetail).not.toHaveBeenCalled()
  })
})

describe('Home Care distinction and dashboard summary', () => {
  it('keeps /care-plan as Home Care, labels the summary as a request, and distinguishes navigation entries', () => {
    render(<MemoryRouter><CarePlanPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Request Professional Home Care' })).toBeInTheDocument()
    expect(screen.getByText('Your Home Care Request')).toBeInTheDocument()
    expect(primaryNavigation.find(item => item.to === '/care-plan').label).toBe('Home Care')
    expect(primaryNavigation.find(item => item.to === '/my-care-plan').label).toBe('My Care Plan')
  })
  it('labels desktop and mobile navigation distinctly for Home Care and My Care Plan', () => {
    render(<LocalizationProvider><MemoryRouter><><Sidebar /><BottomNav /></></MemoryRouter></LocalizationProvider>)
    expect(screen.getByRole('link', { name: 'Home Care' })).toHaveAttribute('href', '/care-plan')
    expect(screen.getAllByRole('link', { name: 'My Care Plan' }).some(link => link.getAttribute('href') === '/my-care-plan')).toBe(true)
  })
  it('requires an explicit For Who choice and summarizes the selected recipient separately from the requester', async () => {
    familyMocks.getGroups.mockResolvedValue([{ id: 'group-a' }])
    familyMocks.getMembers.mockResolvedValue([
      { member_id: 'm-a', patient_id: 'patient-family', display_name: 'U Kyaw Aung Moe', relationshipLabel: 'Father', is_self: false, authorization: { status: 'active', appointments: true, payments: true } },
      { member_id: 'm-b', patient_id: 'patient-revoked', display_name: 'Revoked Member', relationshipLabel: 'Mother', is_self: false, authorization: { status: 'revoked', appointments: true, payments: true } },
      { member_id: 'm-c', patient_id: 'patient-view-only', display_name: 'View Only Member', relationshipLabel: 'Mother', is_self: false, authorization: { status: 'active', appointments: false, payments: true } },
    ])
    render(<MemoryRouter><CarePlanPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('radio', { name: /Basic Elderly Care/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('108,000 MMK total')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Preferred start date'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Please select who this Home Care service is for.')).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /U Kyaw Aung Moe.*Father/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Nandar Kyaw.*Myself/ })).toBeInTheDocument()
    expect(screen.queryByText('Revoked Member')).not.toBeInTheDocument()
    expect(screen.queryByText('View Only Member')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /U Kyaw Aung Moe.*Father/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Home address'), { target: { value: 'No. 10, Example Street' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('U Kyaw Aung Moe — Father')).toBeInTheDocument()
    expect(screen.getByText('Requested by / payer')).toBeInTheDocument()
    expect(screen.getByText('Nandar Kyaw', { selector: 'span' })).toBeInTheDocument()
    expect(catalogMocks.quote).toHaveBeenCalledWith('ec000000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', expect.any(Number))
  })
  it('isolates dashboard query failure and renders only real patient-owned active plan data', async () => {
    const failed = makeService(); failed.listMyPlans.mockRejectedValue(new Error('offline'))
    const { container, rerender } = render(<MemoryRouter><CarePlanDashboardSummary patientId="patient-own" service={failed} /></MemoryRouter>)
    await waitFor(() => expect(failed.listMyPlans).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    const plan = summary()
    const nextHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const service = makeService({ plans: [summary('foreign', 'patient-other'), plan], tasks: [task('next-task', 'activity', 'Next real task')], occurrences: [row('next-occ', 'next-task', nextHour)] })
    rerender(<MemoryRouter><CarePlanDashboardSummary patientId="patient-own" service={service} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Recorded recovery plan' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 3 tasks completed today/)).toBeInTheDocument()
    expect(screen.getByText(/Next real task/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View My Care Plan' })).toHaveAttribute('href', '/my-care-plan')
    expect(service.getDetail).toHaveBeenCalledWith('plan-a')
  })
})
