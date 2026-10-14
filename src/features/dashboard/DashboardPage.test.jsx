import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { loadDashboardPage } from '../../services/dashboardPageService.js'
import { getVitalHistory } from '../../services/patientDashboardService.js'
import { getAIHealthOverview } from '../../services/aiHealthOverviewService.js'
import { getPatientOnboarding } from '../../services/patientOnboardingService.js'
import { familyCommandCenterService } from '../../services/familyCommandCenterService.js'
import { isScheduledOn, patientMonitoringService } from '../../services/patientMonitoringService.js'
import { patientHealthGoalService } from '../../services/patientHealthGoalService.js'
import { documentHealthIntelligenceService } from '../../services/documentHealthIntelligenceService.js'
import { getHealthWorldNews } from '../../services/healthWorldNewsService.js'
const { auth } = vi.hoisted(() => ({ auth: { patient: null, status: 'authenticated' } }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/dashboardQueryService.js', () => ({
  DASHBOARD_STALE_MS: 30000,
  measureDashboardLoad: (name, load) => load(),
  dashboardKey: (viewerId, patientId, day, resource) => ['patient-dashboard', viewerId || patientId, patientId, day, resource],
  createDashboardQueryResources: ({ patient, viewerId, day }) => {
    const result = loadDashboardPage(patient.id)
    return { key: resource => ['patient-dashboard', viewerId || patient.id, patient.id, day, resource], sharedOwnSections: {},
      tasks: Object.fromEntries(['overview','alerts','records','labs','prescriptions','appointment','medications'].map(name => [name, async () => {
        const section = (await result)[name]
        if (section?.status === 'error') throw new Error('Section unavailable')
        return section?.data
      }])) }
  },
}))
vi.mock('../../services/dashboardPageService.js', () => ({ loadDashboardPage: vi.fn() }))
vi.mock('../../services/patientDashboardService.js', () => ({ getVitalHistory: vi.fn() }))
vi.mock('../../services/aiHealthOverviewService.js', () => ({ getAIHealthOverview: vi.fn() }))
vi.mock('../../services/patientOnboardingService.js', () => ({ getPatientOnboarding: vi.fn() }))
vi.mock('../../services/familyCommandCenterService.js', () => ({ familyCommandCenterService: { load: vi.fn() } }))
vi.mock('../../services/patientMonitoringService.js', async importOriginal => ({ ...(await importOriginal()), isScheduledOn: vi.fn((plan, date) => plan.isActive && date >= plan.startDate && (!plan.endDate || date <= plan.endDate)), patientMonitoringService: { listMyPlans: vi.fn(), listMyCheckIns: vi.fn() } }))
vi.mock('../../services/patientHealthGoalService.js', () => ({ patientHealthGoalService: { listMyGoals: vi.fn() } }))
vi.mock('../../services/documentHealthIntelligenceService.js', () => ({ documentHealthIntelligenceService: { getForPatient: vi.fn() } }))
vi.mock('../../services/healthWorldNewsService.js', () => ({ getHealthWorldNews: vi.fn() }))
const ready = data => ({ status: 'ready', data })
function data() { return { overview: ready({ profile: { fullName: 'Recorded Patient', bloodType: null }, healthProfile: null, allergies: [], conditions: [] }), appointment: ready({ next: null, doctor: null }), medications: ready([]), vitals: ready({}), alerts: ready([]), records: ready([]), labs: ready([]), prescriptions: ready([]), plans: ready([]) } }
let queryClient
const view = () => <QueryClientProvider client={queryClient}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>
const region = title => within(screen.getByRole('article', { name: title }))
beforeEach(() => {
  vi.resetAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.patient = { id: 'patient-a', full_name: 'Recorded Patient' }
  auth.status = 'authenticated'
  loadDashboardPage.mockResolvedValue(data())
  getVitalHistory.mockResolvedValue([])
  getAIHealthOverview.mockResolvedValue({ summary: null, fallback: { summary: 'Overview unavailable', guidance: [] } })
  getPatientOnboarding.mockResolvedValue({ status: 'completed' })
  familyCommandCenterService.load.mockResolvedValue({ status: 'ready', members: [{ patientId: 'patient-a' }], ownerPatientId: 'patient-a', hasConnectedMembers: false })
  patientMonitoringService.listMyPlans.mockResolvedValue([])
  patientMonitoringService.listMyCheckIns.mockResolvedValue([])
  isScheduledOn.mockImplementation((plan, date) => plan.isActive && date >= plan.startDate && (!plan.endDate || date <= plan.endDate))
  patientHealthGoalService.listMyGoals.mockResolvedValue([])
  documentHealthIntelligenceService.getForPatient.mockResolvedValue({ status: 'ready', items: [], total_count: 0, extraction_pending: false })
  getHealthWorldNews.mockResolvedValue({ items: [], cached: false, stale: false })
})
describe('individual real health dashboard', () => {
  it('switches Dashboard copy to Myanmar and back while preserving the session preference and diagnosis value', async () => {
    render(<LocalizationProvider>{view()}</LocalizationProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    expect(await screen.findByText('သင့်ကျန်းမာရေး ယနေ့အခြေအနေ')).toBeInTheDocument()
    expect(screen.getByText('Cervical Spondylosis')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /မင်္ဂလာ(နံနက်ခင်း|နေ့လယ်ခင်း|ညနေခင်း)ပါ၊ Recorded Patient/ })).toBeInTheDocument()
    expect(await screen.findByText('ယနေ့ ဆေးသောက်ရန် လုပ်ဆောင်ချက် မရှိပါ။')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ချိန်းဆိုရန်' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'အမြန် လုပ်ဆောင်ရန်' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(screen.getByText('Your Health Today')).toBeInTheDocument()
    expect(sessionStorage.getItem('easycare-language')).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    expect(screen.getByText('သင့်ကျန်းမာရေး ယနေ့အခြေအနေ')).toBeInTheDocument()
    expect(sessionStorage.getItem('easycare-language')).toBe('my')
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(screen.getByText('Your Health Today')).toBeInTheDocument()
  })

  it('opens One-Tap Care from the primary dashboard action', async () => {
    render(view())
    expect(await screen.findByRole('link', { name: 'I Need Care' })).toHaveAttribute('href', '/care/start')
  })
  it('shows the optional onboarding card until setup is completed', async () => {
    getPatientOnboarding.mockResolvedValue({ status: 'skipped' })
    render(view())
    expect(await screen.findByRole('heading', { name: 'Complete your profile' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue Setup' })).toHaveAttribute('href', '/onboarding')
    getPatientOnboarding.mockResolvedValue({ status: 'completed' })
  })

  it('hides the onboarding card for completed setup', async () => {
    render(view())
    await screen.findByText('No medication actions for today.')
    expect(screen.queryByRole('heading', { name: 'Complete your profile' })).not.toBeInTheDocument()
  })

  it('shows optional Family setup for an eligible adult with no family group', async () => {
    auth.patient = { id: 'patient-a', full_name: 'Recorded Patient', date_of_birth: '1990-01-01' }
    render(view())
    expect(await screen.findByRole('heading', { name: 'Care for your family with EasyCare' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set Up Family' })).toHaveAttribute('href', '/family')
    expect(familyCommandCenterService.load).toHaveBeenCalled()
  })

  it('shows real family names and member counts from Family RPCs', async () => {
    auth.patient = { id: 'patient-a', full_name: 'Recorded Patient', date_of_birth: '1990-01-01' }
    familyCommandCenterService.load.mockResolvedValue({ status: 'ready', familyName: 'Recorded Family', ownerPatientId: 'patient-a', hasConnectedMembers: true, members: [{ patientId: 'patient-a', displayName: 'Recorded Patient' }, { patientId: 'adult', displayName: 'Adult', statusReason: 'Appointment tomorrow' }] })
    render(view())
    expect(await screen.findByRole('heading', { name: 'Recorded Family' })).toBeInTheDocument()
    expect(screen.getByText('Recorded Family')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Care Circle' })).toHaveAttribute('href', '/family')
    expect(screen.getByRole('link', { name: 'View Family Health' })).toHaveAttribute('href', '/family/overview')
  })

  it('loads the authenticated patient and shows neutral empty states without fixture numbers', async () => {
    render(view())
    expect(await screen.findByText('No medication actions for today.')).toBeInTheDocument()
    expect(loadDashboardPage.mock.calls[0][0]).toBe('patient-a')
    expect(getVitalHistory).not.toHaveBeenCalled()
    expect(patientMonitoringService.listMyPlans).toHaveBeenCalledTimes(1)
    expect(patientMonitoringService.listMyCheckIns).toHaveBeenCalledTimes(1)
    expect(getAIHealthOverview).not.toHaveBeenCalled()
    expect(documentHealthIntelligenceService.getForPatient).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Recorded Patient')
    for (const text of ['No upcoming appointment.', 'No current action due.', 'No monitoring measurements yet.']) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByLabelText('Personal Health Information')).toHaveTextContent('Cervical Spondylosis')
    expect(screen.queryByRole('article', { name: 'Personal Health Information' })).not.toBeInTheDocument()
    expect(screen.queryByText(/76 bpm|120\/80|completely healthy|Excellent health|Everything looks normal/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Care Plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Care Coordinator' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Care Updates' })).not.toBeInTheDocument()
  })
  it('renders actual measurements, schedules, statuses, record sources and labs', async () => {
    const rows = data()
    rows.overview.data.profile.fullName = 'A Different Name'
    rows.vitals = ready({ heart_rate: { heartRate: 83, recordedAt: '2026-10-01T09:00Z', sourceType: 'manual' }, blood_pressure: { systolicBp: 123, diastolicBp: 81, recordedAt: '2026-10-01T10:00Z' } })
    rows.medications = ready({ medications: [{ id: 'one', name: 'Recorded medication', dosage: 'Recorded dose', todaySchedules: [{ schedule: { id: 's', timeOfDay: '08:00', timezone: 'Asia/Yangon' }, events: [] }] }, { id: 'two', name: 'Another recorded medication', todaySchedules: [{ schedule: { id: 's2', timeOfDay: '20:00' }, events: [{ id: 'e', status: 'skipped' }] }] }], checkIns: [], checkInsAvailable: false })
    rows.appointment = ready({ next: { id: 'a', scheduledStart: '2026-12-01T09:00Z', status: 'pending', appointmentType: 'teleconsult', consultationChannel: 'video' }, doctor: { displayName: 'Recorded Doctor', specialty: 'Recorded specialty' } })
    rows.alerts = ready([{ id: 'alert', title: 'Recorded alert', alertType: 'vital', severity: 'warning', message: 'Recorded message', status: 'acknowledged', detectedAt: '2026-10-01T09:00Z' }])
    rows.records = ready(['encounter', 'document', 'history'].map(kind => ({ kind, recordedAt: '2026-10-01', record: { id: kind, title: `Recorded ${kind}` } })))
    rows.labs = ready([{ id: 'l', testName: 'Recorded test', valueNumeric: 0, unit: 'mg/dL', resultStatus: 'final', abnormalFlag: 'unknown', observedAt: '2026-10-01T09:00Z' }])
    rows.plans = ready([{ id: 'p', package: { name: 'Recorded package' }, status: 'active' }])
    loadDashboardPage.mockResolvedValue(rows)
    render(view())
    await region("Today's Medications").findByText('Recorded medication · Recorded dose')
    expect(screen.queryByText('123/81 mmHg')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A Different Name')
    expect(screen.queryByText('Source: manual')).not.toBeInTheDocument()
    expect(region("Today's Medications").getAllByText('Not done').length).toBeGreaterThan(0)
    expect(region("Today's Medications").queryByText('taken')).not.toBeInTheDocument()
    expect(region("Today's Medications").getAllByText('Not done').length).toBeGreaterThan(0)
    expect(region('Upcoming Care').getByText('pending')).toBeInTheDocument()
    expect(region('Upcoming Care').queryByText('confirmed')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Appointment' })).toHaveAttribute('href', '/appointments/a')
    expect(screen.getByRole('heading', { name: 'Needs Attention' })).toBeInTheDocument()
    for (const text of ['Recorded package']) expect(screen.getByText(text)).toBeInTheDocument()
  })
  it('summarizes patient check-ins and recurrence without counting PRN as required', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const rows = data()
    rows.medications = ready({ medications: [
      { id: '81000000-0000-4000-8000-000000000011', name: 'Scheduled medicine', dosage: '1 tablet', frequency: 'twice daily', instructions: 'Recorded directions', schedules: [] },
      { id: '81000000-0000-4000-8000-000000000012', name: 'As needed medicine', frequency: 'as needed', schedules: [] },
    ], checkInsAvailable: true, checkIns: [
      { patientMedicationId: '81000000-0000-4000-8000-000000000011', occurrenceIndex: 1, isPrn: false, status: 'taken', completedAt: new Date().toISOString() },
      { patientMedicationId: '81000000-0000-4000-8000-000000000012', occurrenceIndex: null, isPrn: true, status: 'taken', completedAt: new Date().toISOString() },
    ] })
    loadDashboardPage.mockResolvedValue(rows)
    patientMonitoringService.listMyPlans.mockResolvedValue([{ id: 'p1', title: 'Blood pressure check', isActive: true, startDate: today, recurrenceType: 'daily', times: [{ id: 't1', timeOfDay: '08:00' }] }])
    patientMonitoringService.listMyCheckIns.mockResolvedValue([{ monitoringPlanId: 'p1', localDate: today, occurrenceKey: 't1', status: 'done', completedAt: new Date().toISOString() }])
    patientHealthGoalService.listMyGoals.mockResolvedValue([{ id: 'g1', title: 'Walk more', isCompleted: false }, { id: 'g2', title: 'Drink water', isCompleted: true }])
    render(view())
    const progress = await screen.findByRole('article', { name: 'Care Progress' })
    await within(progress).findByText('1 active · 1 completed')
    expect(within(progress).getByText('2/3 completed')).toBeInTheDocument()
    expect(within(progress).getByText('1/2 completed')).toBeInTheDocument()
    expect(within(progress).getByText('1/7')).toBeInTheDocument()
    expect(await screen.findByText('Today: 1/1 completed')).toBeInTheDocument()
    expect(within(progress).getByText('1 active · 1 completed')).toBeInTheDocument()
    expect(region("Today's Medications").getByText('twice daily')).toBeInTheDocument()
    expect(region("Today's Medications").getByText('Recorded directions')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Health World' })).getByText('Latest trusted health updates will appear here.')).toBeInTheDocument()
  })
  it('places Health Trends directly below Health World and keeps personal health information compact', async () => {
    auth.patient = { id: 'patient-a', full_name: 'Recorded Patient', date_of_birth: '1990-01-01' }
    const page = render(view())
    await screen.findByRole('heading', { name: 'Care for your family with EasyCare' })
    const world = await screen.findByRole('article', { name: 'Health World' })
    const familyBanner = page.container.querySelector('.dashboard-family-card')
    const hero = page.container.querySelector('.dashboard-hero-section')
    const personalHealth = page.container.querySelector('.dashboard-personal-health-note')
    const trends = page.container.querySelector('[aria-label="Health Trends"]')
    expect(familyBanner.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hero.compareDocumentPosition(world) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hero.contains(personalHealth)).toBe(true)
    expect(world.nextElementSibling).toBe(trends)
    expect(page.container.querySelector('article[aria-label="Personal Health Information"]')).toBeNull()
    expect(page.container.querySelectorAll('[aria-label="Health World"]')).toHaveLength(1)
    expect(page.container.querySelector('.dashboard-command-grid [aria-label="Health World"]')).toBeNull()
    expect(within(world).getByRole('heading', { name: 'The WHO Info' })).toBeInTheDocument()
    expect(within(world).getByText('Latest health updates from WHO')).toBeInTheDocument()
    expect(within(world).getByRole('img', { name: 'World Health Organization' })).toHaveAttribute('src', '/who-logo.png')
    expect(within(world).queryByRole('link')).not.toBeInTheDocument()
  })
  it('isolates query, trend and AI failures while keeping successful care visible', async () => {
    const rows = data(); rows.labs = { status: 'error' }; rows.vitals = { status: 'error' }
    rows.medications = ready({ medications: [{ id: 'one', name: 'Still visible', todaySchedules: [{ schedule: { id: 's', timeOfDay: '08:00' }, events: [] }] }], checkIns: [], checkInsAvailable: false })
    loadDashboardPage.mockResolvedValue(rows)
    patientMonitoringService.listMyCheckIns.mockRejectedValue(new Error('unavailable'))
    getAIHealthOverview.mockRejectedValue(new Error('unavailable'))
    render(view())
    expect(await region("Today's Medications").findByText('Still visible')).toBeInTheDocument()
    expect(screen.queryByText('AI overview is temporarily unavailable.')).not.toBeInTheDocument()
    expect(await screen.findByText('Health trends are temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getAllByText('Temporarily unavailable.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('No upcoming appointment.')).toBeInTheDocument()
    expect(screen.queryByText('No recent lab results.')).not.toBeInTheDocument()
  })
  it('does not show empty claims while loading', () => {
    loadDashboardPage.mockReturnValue(new Promise(() => {}))
    getVitalHistory.mockReturnValue(new Promise(() => {}))
    getAIHealthOverview.mockReturnValue(new Promise(() => {}))
    render(view())
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0)
    expect(screen.queryByText('No upcoming appointment.')).not.toBeInTheDocument()
    expect(screen.queryByText('No current action due.')).not.toBeInTheDocument()
  })
  it('never queries clinical data for a prototype account without an authorized ID', () => {
    auth.patient = { isPrototype: true, full_name: 'Demo Patient' }
    render(view())
    expect(screen.getByText(/Sign in with a patient account to view your records/)).toBeInTheDocument()
    expect(loadDashboardPage).not.toHaveBeenCalled()
    expect(getVitalHistory).not.toHaveBeenCalled()
    expect(getAIHealthOverview).not.toHaveBeenCalled()
    expect(screen.queryByText(/Demo Patient/)).not.toBeInTheDocument()
  })
  it('discards late data from a previous authenticated account', async () => {
    let finish
    loadDashboardPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const page = render(view())
    auth.patient = { id: 'patient-b', full_name: 'Other Patient' }
    page.rerender(view())
    await waitFor(() => expect(loadDashboardPage.mock.calls.some(call => call[0] === 'patient-b')).toBe(true))
    const old = data(); old.overview.data.profile.bloodType = 'PRIVATE OLD VALUE'
    await act(async () => finish(old))
    expect(screen.queryByText('PRIVATE OLD VALUE')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /patient|family|member/i })).not.toBeInTheDocument()
  })
})





const actionableFamily = () => ({ ownerPatientId: 'patient-a', hasConnectedMembers: true, familyName: 'Shared Family', members: [{ patientId: 'patient-a', displayName: 'Recorded Patient' }, { patientId: 'shared', displayName: 'Shared Member', status: 'needs_attention', statusReason: 'Review shared alert', detailDestination: '/family/health?groupId=g&memberId=m', alerts: [{ id: 'alert', patientId: 'shared', title: 'Review shared alert', careType: 'Care alert', sourceStatus: 'open', destination: '/family/health?groupId=g&memberId=m' }] }] })
afterEach(() => { queryClient.clear(); vi.useRealTimers() })
describe('Dashboard family sharing lifecycle', () => {
  beforeEach(() => { auth.patient.date_of_birth = '1990-01-01' })
  it('keeps shared family details in the setup banner without the removed summary card', async () => {
    familyCommandCenterService.load.mockResolvedValue(actionableFamily())
    render(view())
    expect(await screen.findByRole('heading', { name: 'Shared Family' })).toBeInTheDocument()
    expect(screen.getByText('Shared Member')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Family Care Today' })).not.toBeInTheDocument()
    expect(familyCommandCenterService.load).toHaveBeenCalledTimes(1)
  })
  it('clears stale details before rechecking revoked access on focus', async () => {
    let finish
    familyCommandCenterService.load.mockResolvedValueOnce(actionableFamily()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(view())
    await screen.findByText('Shared Member')
    act(() => window.dispatchEvent(new Event('focus')))
    expect(screen.queryByText('Shared Member')).not.toBeInTheDocument()
    await waitFor(() => expect(familyCommandCenterService.load).toHaveBeenCalledTimes(2))
    await act(async () => finish({ ownerPatientId: 'patient-a', hasConnectedMembers: true, members: [] }))
    expect(screen.queryByText('Shared Member')).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Family Care Today' })).not.toBeInTheDocument()
  })
  it('hides protected details exactly at expiry without another family read', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T05:00:00Z'))
    familyCommandCenterService.load.mockResolvedValue({ ...actionableFamily(), accessExpiresAt: '2026-10-12T05:00:01Z' })
    render(view())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Shared Member')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.queryByText('Shared Member')).not.toBeInTheDocument()
    expect(screen.queryByText('Family information is unavailable right now. You can open Family Setup to try again.')).not.toBeInTheDocument()
    expect(familyCommandCenterService.load).toHaveBeenCalledTimes(1)
  })
  it('isolates family-source failure from successful Dashboard sections', async () => {
    familyCommandCenterService.load.mockRejectedValue(new Error('Family source failed'))
    render(view())
    expect(screen.queryByText('Family information is unavailable right now. You can open Family Setup to try again.')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Care for your family with EasyCare' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set Up Family' })).toHaveAttribute('href', '/family')
    expect(await screen.findByText('No medication actions for today.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'I Need Care' })).toBeInTheDocument()
  })
  it('clears family details immediately on account switch and discards an old result', async () => {
    let finish
    familyCommandCenterService.load.mockResolvedValueOnce(actionableFamily()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const page = render(view())
    await screen.findByText('Shared Member')
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(familyCommandCenterService.load).toHaveBeenCalledTimes(2))
    auth.patient = { id: 'patient-b', date_of_birth: '1990-01-01' }
    familyCommandCenterService.load.mockResolvedValue({ ownerPatientId: 'patient-b', members: [] })
    page.rerender(view())
    expect(screen.queryByText('Shared Member')).not.toBeInTheDocument()
    await act(async () => finish(actionableFamily()))
    expect(screen.queryByText('Shared Member')).not.toBeInTheDocument()
  })
})




it('shows all active origins with separate doses, PRN and only real times', async () => {
  const rows = data()
  rows.medications = ready({ medications: [
    { id: '81000000-0000-4000-8000-000000000013', name: 'Clinical active entry', dosage: '5 mg', frequency: 'three times daily', schedules: [] },
    { id: 'reported:r', name: 'Reported active entry', dosage: '1 tablet', frequency: 'daily', isPatientReported: true, source: 'Patient-reported' },
    { id: '81000000-0000-4000-8000-000000000014', name: 'PRN active entry', frequency: 'as needed', schedules: [] },
  ], checkInsAvailable: true, checkIns: [{ patientMedicationId: '81000000-0000-4000-8000-000000000013', occurrenceIndex: 1, isPrn: false, status: 'taken' }, { patientMedicationId: '81000000-0000-4000-8000-000000000013', occurrenceIndex: 3, isPrn: false, status: 'taken' }, { patientMedicationId: '81000000-0000-4000-8000-000000000014', occurrenceIndex: null, isPrn: true, status: 'taken' }] })
  loadDashboardPage.mockResolvedValue(rows)
  render(view())
  const card = region("Today's Medications")
  expect(await card.findByText('Clinical active entry · 5 mg')).toBeInTheDocument()
  expect(card.queryByText('Reported active entry · 1 tablet')).not.toBeInTheDocument()
  expect(card.getByText('2 of 3 doses done · View details')).toBeInTheDocument()
  const doseDetails = card.getByText('2 of 3 doses done · View details').closest('details')
  expect(doseDetails.open).toBe(false)
  doseDetails.querySelector('summary').click()
  expect(card.getByText('Dose 3')).toBeInTheDocument()
  expect(card.getByText(/2 of 3 required doses completed/)).toBeInTheDocument()
  const doses = within(card.getByRole('list', { name: "Today's doses for Clinical active entry" }))
  expect(doses.getAllByText('Done')).toHaveLength(2)
  expect(doses.getByText('Not done')).toBeInTheDocument()
  expect(card.getAllByText('As needed').length).toBeGreaterThan(0)
  expect(card.queryByText('Tracking unavailable')).not.toBeInTheDocument()
  expect(card.queryByText(/08:00|09:00|20:00/)).not.toBeInTheDocument()
  expect(card.getByRole('link', { name: 'View Medications' })).toHaveAttribute('href', '/my-care-plan#care-my-medications')
})

it('renders the requested frontend-only cleanup without removed cards or empty grid wrappers', async () => {
  const rows = data(); rows.overview = { status: 'error', data: null }; rows.vitals = { status: 'error' }; rows.records = { status: 'error' }; rows.labs = { status: 'error' }
  loadDashboardPage.mockResolvedValue(rows)
  const page = render(view())
  await screen.findByText('No medication actions for today.')
  const personal = page.container.querySelector('.dashboard-personal-health-note')
  expect(personal).toHaveTextContent('Cervical Spondylosis')
  expect(personal).not.toHaveTextContent('Temporarily unavailable.')
  for (const title of ['Health at a Glance', 'Health Intelligence', 'AI Health Overview', 'Recent Health Records', 'Recent Lab Results']) {
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
    expect(screen.queryByRole('article', { name: title })).not.toBeInTheDocument()
  }
  expect(screen.queryByText('No health intelligence is available yet.')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: /explanation language/i })).not.toBeInTheDocument()
  expect(getAIHealthOverview).not.toHaveBeenCalled()
  expect(documentHealthIntelligenceService.getForPatient).not.toHaveBeenCalled()
  for (const title of ['Health Trends', "Today's Medications", 'Upcoming Care', 'Care Progress', 'Monitoring Progress']) expect(screen.getByRole('article', { name: title })).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Family Care Today' })).not.toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'Active Care Package' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Quick Actions' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Health Records' })).toHaveAttribute('href', '/health-records')
  expect(page.container.querySelector('.dashboard-secondary-grid')).toBeNull()
  expect(page.container.querySelectorAll('.dashboard-command-grid')).toHaveLength(1)
  expect(page.container.querySelector('.dashboard-command-grid').children).toHaveLength(2)
})
