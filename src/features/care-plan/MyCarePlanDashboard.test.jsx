import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MyCarePlanDashboard } from './MyCarePlanDashboard.jsx'

const { auth, api, plans, healthGoals, monitoring, lifestyle } = vi.hoisted(() => ({
  auth: { status: 'authenticated', patient: { id: 'patient-a' } },
  api: { conditions: vi.fn(), medications: vi.fn(), today: vi.fn(), checkins: vi.fn(), recordCheckin: vi.fn(), appointments: vi.fn(), provider: vi.fn(), vitals: vi.fn(), labs: vi.fn(), markTaken: vi.fn(), reported: vi.fn() },
  plans: { list: vi.fn(), detail: vi.fn() },
  healthGoals: { rows: [], list: vi.fn(), create: vi.fn(), setCompletion: vi.fn(), remove: vi.fn() },
  monitoring: { plans: [], checkIns: [], listPlans: vi.fn(), listCheckIns: vi.fn(), save: vi.fn(), deactivate: vi.fn(), record: vi.fn(), measure: vi.fn() },
  lifestyle: { rows: [], list: vi.fn(), save: vi.fn(), deactivate: vi.fn(), saveResource: vi.fn(), deleteResource: vi.fn() },
}))
let lifestyleResourceSequence = 0
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/patientDashboardService.js', () => ({
  getCarePlanConditions: api.conditions, getActiveMedications: api.medications, getTodayMedications: api.today,
  getTodayMedicationCheckIns: api.checkins, recordPatientMedicationCheckIn: api.recordCheckin,
  getUpcomingAppointments: api.appointments, getDashboardAppointmentProvider: api.provider,
  getLatestVitals: api.vitals, getRecentLabResults: api.labs, recordMedicationEventStatus: api.markTaken,
}))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: { metadata: { isSynthetic: false }, listMedications: api.medications } }))
vi.mock('../../services/patientReportedHealthService.js', () => ({ getMyReportedHealthIntake: api.reported }))
vi.mock('../../services/patientLifestylePlanService.js', () => ({ patientLifestylePlanService: { listMyPlans: lifestyle.list, saveMyPlan: lifestyle.save, deactivateMyPlan: lifestyle.deactivate, saveMyResource: lifestyle.saveResource, deleteMyResource: lifestyle.deleteResource } }))
vi.mock('../../services/patientHealthGoalService.js', () => ({
  patientHealthGoalService: {
    listMyGoals: healthGoals.list,
    createMyGoal: healthGoals.create,
    setGoalCompletion: healthGoals.setCompletion,
    deleteMyGoal: healthGoals.remove,
  },
  sortPatientHealthGoals: goals => [...(goals || [])].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id))),
}))
vi.mock('../../services/patientMonitoringService.js', () => ({
  patientMonitoringService: {
    listMyPlans: monitoring.listPlans,
    listMyCheckIns: monitoring.listCheckIns,
    saveMyPlan: monitoring.save,
    deactivateMyPlan: monitoring.deactivate,
    recordMyCheckIn: monitoring.record,
    recordMyMeasurement: monitoring.measure,
  },
  isScheduledOn: (plan, date) => {
    if (!plan?.isActive || date < plan.startDate || (plan.endDate && date > plan.endDate)) return false
    if (plan.recurrenceType === 'daily') return true
    if (plan.recurrenceType === 'once') return date === plan.startDate
    return plan.recurrenceType === 'selected_days' && (plan.daysOfWeek || []).includes(new Date(`${date}T12:00:00Z`).getUTCDay())
  },
}))
function Destination() { const location = useLocation(); return <p>Medication destination: {location.state?.medicationId || 'list'}</p> }
let medicationQueryClient
const renderPage = () => render(<QueryClientProvider client={medicationQueryClient}><MemoryRouter initialEntries={['/my-care-plan']}><Routes><Route path="/my-care-plan" element={<MyCarePlanDashboard />} /><Route path="/medications" element={<Destination />} /><Route path="/appointments/:id" element={<p>Appointment details</p>} /><Route path="/health-records" element={<p>Health records</p>} /><Route path="*" element={<p>Destination</p>} /></Routes></MemoryRouter></QueryClientProvider>)
const todayYangon = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const todayLabel = () => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${todayYangon()}T12:00:00Z`))

beforeEach(() => {
  vi.resetAllMocks()
  medicationQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.status = 'authenticated'; auth.patient = { id: 'patient-a' }
  api.conditions.mockResolvedValue({ conditions: [], allergies: [] })
  api.medications.mockResolvedValue([]); api.today.mockResolvedValue([]); api.checkins.mockResolvedValue([]); api.recordCheckin.mockImplementation(async ({ medicationId, occurrenceIndex }) => ({ id: `check-${medicationId}-${occurrenceIndex ?? 1}`, patientMedicationId: medicationId, localDate: todayYangon(), occurrenceIndex: occurrenceIndex ?? 1, isPrn: occurrenceIndex === null, status: 'taken' })); api.reported.mockResolvedValue({ items: [] }); api.markTaken.mockResolvedValue({ status: 'taken', confirmed_at: '2026-10-11T02:05:00Z' })
  api.appointments.mockResolvedValue([]); api.provider.mockResolvedValue(null)
  api.vitals.mockResolvedValue({}); api.labs.mockResolvedValue([])
  plans.list.mockResolvedValue([]); plans.detail.mockResolvedValue(null)
  lifestyle.rows = []
  lifestyleResourceSequence = 0
  lifestyle.list.mockImplementation(async () => lifestyle.rows.map(plan => ({ ...plan, resources: [...(plan.resources || [])] })))
  lifestyle.save.mockImplementation(async input => ({ id: input.id || '91000000-0000-4000-8000-000000000001', title: input.title, description: input.description || null, category: input.category || null, isActive: true }))
  lifestyle.deactivate.mockResolvedValue({ isActive: false })
  lifestyle.saveResource.mockImplementation(async (planId, input) => ({ id: input.id || `92000000-0000-4000-8000-${String(++lifestyleResourceSequence).padStart(12, '0')}`, planId, title: input.title || null, url: input.url, resourceType: new URL(input.url).hostname.includes('youtube') || new URL(input.url).hostname === 'youtu.be' ? 'youtube' : 'website' }))
  lifestyle.deleteResource.mockResolvedValue(undefined)
  healthGoals.rows = []
  healthGoals.list.mockImplementation(async () => healthGoals.rows.map(goal => ({ ...goal })))
  healthGoals.create.mockImplementation(async title => {
    const goal = { id: `71000000-0000-4000-8000-${String(healthGoals.rows.length + 1).padStart(12, '0')}`, title, isCompleted: false, completedAt: null, createdAt: new Date(Date.UTC(2026, 0, healthGoals.rows.length + 1)).toISOString() }
    healthGoals.rows.push(goal); return { ...goal }
  })
  healthGoals.setCompletion.mockImplementation(async (id, isCompleted) => {
    const goal = healthGoals.rows.find(item => item.id === id)
    Object.assign(goal, { isCompleted, completedAt: isCompleted ? '2026-10-12T00:00:00Z' : null })
    return { ...goal }
  })
  healthGoals.remove.mockImplementation(async id => { healthGoals.rows = healthGoals.rows.filter(goal => goal.id !== id) })
  monitoring.plans = []; monitoring.checkIns = []
  monitoring.listPlans.mockImplementation(async () => monitoring.plans.map(plan => ({ ...plan })))
  monitoring.listCheckIns.mockImplementation(async () => monitoring.checkIns.map(checkIn => ({ ...checkIn })))
  monitoring.save.mockImplementation(async plan => {
    const saved = { ...plan, id: plan.id || '81000000-0000-4000-8000-000000000001', isActive: true, createdAt: plan.createdAt || new Date().toISOString(), times: (plan.times || []).map((time, index) => ({ id: `82000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, timeOfDay: `${time}:00` })) }
    monitoring.plans = [saved, ...monitoring.plans.filter(item => item.id !== saved.id)]
    return saved
  })
  monitoring.deactivate.mockImplementation(async id => { monitoring.plans = monitoring.plans.map(plan => plan.id === id ? { ...plan, isActive: false } : plan) })
  monitoring.record.mockImplementation(async input => {
    const row = { id: `83000000-0000-4000-8000-${String(monitoring.checkIns.length + 1).padStart(12, '0')}`, monitoringPlanId: input.planId, localDate: input.localDate, occurrenceKey: input.occurrenceKey, status: input.isDone ? 'done' : 'open', completedAt: input.isDone ? new Date().toISOString() : null, measurementValue: input.measurementValue || null, measurementUnit: input.measurementUnit || null, notes: input.notes || null }
    monitoring.checkIns = [...monitoring.checkIns.filter(item => !(item.monitoringPlanId === row.monitoringPlanId && item.localDate === row.localDate && item.occurrenceKey === row.occurrenceKey)), row]
    return row
  })
  monitoring.measure.mockImplementation(async input => {
    const row = { id: `83000000-0000-4000-8000-${String(monitoring.checkIns.length + 1).padStart(12, '0')}`, monitoringPlanId: input.planId, localDate: input.localDate, occurrenceKey: input.occurrenceKey, occurrenceLabel: 'Any time', status: 'done', completedAt: new Date().toISOString(), measurementValue: input.measurementValue == null ? null : String(input.measurementValue), measurementUnit: input.measurementUnit, systolicValue: input.systolicValue == null ? null : Number(input.systolicValue), diastolicValue: input.diastolicValue == null ? null : Number(input.diastolicValue) }
    monitoring.checkIns = [...monitoring.checkIns.filter(item => !(item.monitoringPlanId === row.monitoringPlanId && item.localDate === row.localDate && item.occurrenceKey === row.occurrenceKey)), row]
    return row
  })
})
afterEach(cleanup)

describe('connected My Care Plan dashboard', () => {
  it('focuses the medications section from a notification deep link', async () => {
    render(<QueryClientProvider client={medicationQueryClient}><MemoryRouter initialEntries={['/my-care-plan#care-my-medications']}><MyCarePlanDashboard /></MemoryRouter></QueryClientProvider>)
    const heading = await screen.findByRole('heading', { name: 'My Medications' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(heading.id).toBe('care-my-medications')
  })
  it('stacks dashboard cards in two independent columns with a single-column responsive fallback', async () => {
    const { container } = renderPage()
    await screen.findByText('No health goals yet.')
    const columns = container.querySelectorAll('.care-dashboard-column')
    expect(columns).toHaveLength(2)
    for (const title of ['My Health Goals', 'My Medications']) {
      expect(within(columns[0]).getByRole('region', { name: title })).toBeInTheDocument()
    }
    for (const title of ['My Lifestyle Plan', 'My Monitoring Plan', 'My Upcoming Appointments']) {
      expect(within(columns[1]).getByRole('region', { name: title })).toBeInTheDocument()
    }
    expect([...columns[1].querySelectorAll('.care-dashboard-card h2')].map(heading => heading.textContent)).toEqual(['My Lifestyle Plan', 'My Monitoring Plan', 'My Upcoming Appointments'])
    expect([...container.querySelectorAll('.care-dashboard-column .care-dashboard-card h2')].map(heading => heading.textContent)).toEqual(['My Health Goals', 'My Medications', 'My Lifestyle Plan', 'My Monitoring Plan', 'My Upcoming Appointments'])
    const styles = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')
    expect(styles).toMatch(/\.care-dashboard-columns\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
    expect(styles).toMatch(/\.care-dashboard-column\{display:flex;flex-direction:column[^}]*gap:14px/)
    expect(styles).toMatch(/@media\(max-width:760px\)\{\.care-dashboard-columns\{grid-template-columns:minmax\(0,1fr\)/)
  })
  it('removes underlines from My Care Plan links and controls while retaining a scoped focus ring', () => {
    const styles = readFileSync(join(process.cwd(), 'src/features/care-plan/myCarePlanNoUnderlines.css'), 'utf8')
    expect(styles).toMatch(/\.my-care-page\.care-dashboard a:visited/)
    expect(styles).toMatch(/\.my-care-page\.care-dashboard a \*/)
    expect(styles).toMatch(/\.my-care-page\.care-dashboard \[class\*="underline"\]/)
    expect(styles).toMatch(/text-decoration:\s*none/)
    expect(styles).toMatch(/\.my-care-page\.care-dashboard a:focus-visible/)
    expect(styles).toMatch(/outline:\s*3px solid var\(--primary\)/)
    expect(styles).not.toMatch(/^\s*a\s*\{/m)
  })
  it('renders the patient cards, removes the separate conditions card, and shows the monitoring empty state', async () => {
    renderPage()
    expect(await screen.findByText('No health goals yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add your first goal' })).toBeInTheDocument()
    for (const title of ['My Health Goals', 'My Medications', 'My Lifestyle Plan', 'My Monitoring Plan', 'My Upcoming Appointments']) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Key Health Conditions' })).not.toBeInTheDocument()
    expect(screen.getByText('No monitoring routines yet.')).toBeInTheDocument()
    expect(screen.getByText('No active medications recorded.')).toBeInTheDocument()
    expect(screen.getByText('No lifestyle plans yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create your first plan' })).toBeInTheDocument()
    expect(screen.queryByText(/patient goals unavailable|information is unavailable right now|not supported/i)).not.toBeInTheDocument()
  })
  it('keeps clinician care-plan guidance separate from the patient lifestyle workspace', async () => {
    plans.list.mockResolvedValue([{ id: 'plan-1', patient_id: 'patient-a', status: 'active' }])
    plans.detail.mockResolvedValue({ plan: { current_version_id: 'v1' }, versions: [{ id: 'v1', title: 'Care guidance' }], goals: [{ id: 'goal-1', version_id: 'v1', title: 'Attend follow-up' }] })
    renderPage()
    expect(screen.queryByRole('heading', { name: 'My Key Health Conditions' })).not.toBeInTheDocument()
    expect(screen.queryByText('Attend follow-up')).not.toBeInTheDocument()
    expect(await screen.findByText('No health goals yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Lifestyle Plan' })).toBeInTheDocument()
    expect(screen.getByText('No lifestyle plans yet.')).toBeInTheDocument()
  })
  it('creates and edits a personal lifestyle plan and deactivates it without affecting other cards', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Lifestyle Plan' })
    await user.click(await within(card).findByRole('button', { name: 'Create your first plan' }))
    await user.type(within(card).getByLabelText('Plan title *'), 'Improve Sleep')
    await user.type(within(card).getByLabelText('My Plan'), 'Keep a steady bedtime.')
    await user.selectOptions(within(card).getByLabelText('Category'), 'sleep')
    await user.click(within(card).getByRole('button', { name: 'Create plan' }))
    expect(await within(card).findByText('Improve Sleep')).toBeInTheDocument()
    await user.click(within(card).getByText('Improve Sleep'))
    await user.click(within(card).getByRole('button', { name: 'Edit plan' }))
    const title = within(card).getByLabelText('Plan title *')
    await user.clear(title); await user.type(title, 'Sleep Better')
    await user.click(within(card).getByRole('button', { name: 'Save changes' }))
    expect(await within(card).findByText('Sleep Better')).toBeInTheDocument()
    expect(within(card).queryByText('Improve Sleep')).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Deactivate' }))
    expect(await within(card).findByText('No lifestyle plans yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My Medications' })).toBeInTheDocument()
  })
  it('adds YouTube and website resources, opens links safely, edits and removes only a resource', async () => {
    const user = userEvent.setup()
    lifestyle.rows = [{ id: '91000000-0000-4000-8000-000000000001', title: 'Exercise Routine', description: 'Move each day.', category: 'exercise', isActive: true, resources: [] }]
    renderPage()
    const card = screen.getByRole('region', { name: 'My Lifestyle Plan' })
    await user.click(await within(card).findByText('Exercise Routine'))
    await user.click(within(card).getByRole('button', { name: 'Add Resource' }))
    await user.type(within(card).getByLabelText('URL *'), 'https://youtu.be/abc123')
    await user.type(within(card).getByLabelText('Title (optional)'), 'Beginner Workout')
    await user.click(within(card).getByRole('button', { name: 'Add link' }))
    const workout = await within(card).findByRole('link', { name: /Beginner Workout YouTube/ })
    expect(workout).toHaveAttribute('target', '_blank')
    expect(workout).toHaveAttribute('rel', 'noopener noreferrer')
    expect(workout).toHaveAttribute('href', 'https://youtu.be/abc123')
    await user.click(within(card).getByRole('button', { name: 'Edit link' }))
    const resourceTitle = within(card).getByLabelText('Title (optional)')
    await user.clear(resourceTitle); await user.type(resourceTitle, 'Updated Workout')
    await user.click(within(card).getByRole('button', { name: 'Save link' }))
    expect(await within(card).findByRole('link', { name: /Updated Workout YouTube/ })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Add Resource' }))
    await user.type(within(card).getByLabelText('URL *'), 'https://example.com/guide')
    await user.click(within(card).getByRole('button', { name: 'Add link' }))
    expect(await within(card).findByRole('link', { name: /example\.com Website/ })).toHaveAttribute('target', '_blank')
    expect(within(card).getByText('2 resources')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Remove resource: Updated Workout' }))
    expect(within(card).queryByRole('link', { name: /Updated Workout/ })).not.toBeInTheDocument()
    expect(within(card).getByText('1 resource')).toBeInTheDocument()
  })
  it('adds a selected-day routine with two patient-entered times', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Monitoring Plan' })
    await user.click(await within(card).findByRole('button', { name: '+ Add your first routine' }))
    await user.type(within(card).getByLabelText('Routine name *'), 'Hand exercises')
    await user.selectOptions(within(card).getByLabelText('Schedule type'), 'selected_days')
    await user.click(within(card).getByLabelText('Mon'))
    await user.click(within(card).getByLabelText('Wed'))
    await user.click(within(card).getByRole('button', { name: 'Add a time' }))
    await user.type(within(card).getByLabelText('Time 1'), '09:00')
    await user.click(within(card).getByRole('button', { name: 'Add a time' }))
    await user.type(within(card).getByLabelText('Time 2'), '18:00')
    await user.click(within(card).getByRole('button', { name: 'Add routine' }))
    await waitFor(() => expect(monitoring.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Hand exercises', recurrenceType: 'selected_days', daysOfWeek: [1, 3], times: ['09:00', '18:00'] })))
    expect(await within(card).findByRole('heading', { name: 'Hand exercises' })).toBeInTheDocument()
    expect(within(card).getByText('9:00 AM')).toBeInTheDocument()
    expect(within(card).getByText('6:00 PM')).toBeInTheDocument()
  })
  it('tracks one-time routines, measurement values, completion, and reopening', async () => {
    monitoring.plans = [{ id: '81000000-0000-4000-8000-000000000002', title: 'Measure blood pressure', relatedContext: 'High blood pressure', recurrenceType: 'once', daysOfWeek: [], startDate: todayYangon(), endDate: null, isActive: true, createdAt: '2026-10-01T00:00:00Z', times: [] }]
    renderPage()
    const card = screen.getByRole('region', { name: 'My Monitoring Plan' })
    const checkbox = await within(card).findByRole('checkbox', { name: /Any time today/ })
    expect(within(card).getByText('Related to: High blood pressure')).toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('Value'), { target: { value: '128 / 82' } })
    fireEvent.change(within(card).getByLabelText('Unit'), { target: { value: 'mmHg' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save value' }))
    await waitFor(() => expect(monitoring.record).toHaveBeenLastCalledWith(expect.objectContaining({ localDate: todayYangon(), occurrenceKey: 'any', isDone: false, measurementValue: '128 / 82', measurementUnit: 'mmHg' })))
    fireEvent.click(checkbox)
    await waitFor(() => expect(monitoring.record).toHaveBeenLastCalledWith(expect.objectContaining({ isDone: true, measurementValue: '128 / 82', measurementUnit: 'mmHg' })))
    expect(await within(card).findByText('Done')).toBeInTheDocument()
    fireEvent.click(checkbox)
    await waitFor(() => expect(monitoring.record).toHaveBeenLastCalledWith(expect.objectContaining({ isDone: false })))
  })
  it('records separate systolic and diastolic values for a dated scheduled occurrence and retains history', async () => {
    const today = todayYangon()
    monitoring.plans = [{ id: '81000000-0000-4000-8000-000000000008', title: 'Blood Pressure', recurrenceType: 'daily', daysOfWeek: [], startDate: '2026-10-01', endDate: null, isActive: true, measurementType: 'blood_pressure', measurementUnit: 'mmHg', times: [] }]
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Monitoring Plan' })
    expect(await within(card).findByLabelText('Systolic')).toBeInTheDocument()
    await user.type(within(card).getByLabelText('Systolic'), '125')
    await user.type(within(card).getByLabelText('Diastolic'), '80')
    await user.click(within(card).getByRole('button', { name: 'Save & Mark Done' }))
    await waitFor(() => expect(monitoring.measure).toHaveBeenCalledWith(expect.objectContaining({ localDate: today, systolicValue: '125', diastolicValue: '80', measurementUnit: 'mmHg' })))
    expect(await within(card).findByText(new RegExp(`125 / 80 mmHg`))).toBeInTheDocument()
    await user.click(within(card).getByText('View History'))
    expect(within(card).getByRole('list')).toHaveTextContent(/125 \/ 80 mmHg/)
  })
  it('opens the routine form by keyboard and keeps touch targets and layout mobile-friendly', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Monitoring Plan' })
    const add = await within(card).findByRole('button', { name: '+ Add your first routine' })
    add.focus()
    await user.keyboard('{Enter}')
    expect(within(card).getByLabelText('Routine name *')).toHaveFocus()
    const styles = readFileSync(join(process.cwd(), 'src/features/care-plan/patientMonitoringPlan.css'), 'utf8')
    expect(styles).toContain('@media(max-width:440px)')
    expect(styles).toContain('min-height:44px')
    expect(styles).toContain(':focus-visible')
  })
  it('edits and pauses a routine while retaining its completed history', async () => {
    const yesterday = new Date(`${todayYangon()}T12:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayDate = yesterday.toISOString().slice(0, 10)
    const planId = '81000000-0000-4000-8000-000000000003'
    monitoring.plans = [{ id: planId, title: 'Daily walk', relatedContext: '', notes: '', recurrenceType: 'daily', daysOfWeek: [], startDate: yesterdayDate, endDate: null, isActive: true, createdAt: '2026-10-01T00:00:00Z', times: [] }]
    monitoring.checkIns = [{ id: '83000000-0000-4000-8000-000000000004', monitoringPlanId: planId, localDate: yesterdayDate, occurrenceKey: 'any', status: 'done', measurementValue: null }]
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Monitoring Plan' })
    await user.click(await within(card).findByRole('button', { name: 'Edit Daily walk' }))
    await user.clear(within(card).getByLabelText('Routine name *'))
    await user.type(within(card).getByLabelText('Routine name *'), 'Evening walk')
    await user.click(within(card).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(monitoring.save).toHaveBeenCalledWith(expect.objectContaining({ id: planId, title: 'Evening walk' })))
    await user.click(within(card).getByRole('button', { name: 'Deactivate Evening walk' }))
    await user.click(within(card).getByText('View all monitoring'))
    expect(await within(card).findByText('Paused')).toBeInTheDocument()
    expect(within(card).getByText(/View History/)).toBeInTheDocument()
    expect(within(card).getByText('Done')).toBeInTheDocument()
  })
  it('opens medication details and appointment details through their existing routes', async () => {
    api.medications.mockResolvedValue([{ id: 'med-1', name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice daily', status: 'active', schedules: [] }])
    api.appointments.mockResolvedValue([{ id: 'appt-1', providerId: 'provider-1', scheduledStart: '2026-10-20T02:30:00Z', status: 'pending', consultationChannel: 'Video consultation' }])
    api.provider.mockResolvedValue({ displayName: 'Dr. Thiri Aung', specialty: 'General Practitioner' })
    renderPage()
    fireEvent.click(await screen.findByRole('link', { name: /Paracetamol/ }))
    expect(await screen.findByText('Medication destination: med-1')).toBeInTheDocument()
    cleanup()
    renderPage()
    fireEvent.click(await screen.findByRole('link', { name: /Dr\. Thiri Aung/ }))
    expect(await screen.findByText('Appointment details')).toBeInTheDocument()
  })
  it('hides whole synthetic medication rows and preserves real medication cards', async () => {
    api.medications.mockResolvedValue([
      { id: 'syn-cetirizine', name: 'Cetirizine', dosage: '10 mg', frequency: 'Once daily', instructions: 'Synthetic record: take in the evening', status: 'active', schedules: [] },
      { id: 'syn-paracetamol', name: 'Paracetamol demo course', dosage: '500 mg', frequency: 'Every 8 hours', instructions: 'Synthetic: sample course', status: 'active', schedules: [] },
      { id: 'real-paracetamol', name: 'Paracetamol', dosage: '500 mg', frequency: 'Every 8 hours as needed for pain', instructions: 'Take as needed for pain.', status: 'active', schedules: [] },
      { id: 'real-diclofenac', name: 'Diclofenac Gel', dosage: 'Thin layer', frequency: '3 times daily', instructions: 'Apply to neck area.', status: 'active', schedules: [] },
      { id: 'real-vitamin', name: 'Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Take after food.', status: 'active', schedules: [] },
    ])
    renderPage()
    const card = screen.getByRole('region', { name: 'My Medications' })
    expect(await within(card).findByText('Paracetamol · 500 mg')).toBeInTheDocument()
    expect(within(card).getByText('Diclofenac Gel · Thin layer')).toBeInTheDocument()
    expect(within(card).getByText('Vitamin B Complex · 1 tablet')).toBeInTheDocument()
    expect(within(card).queryByText(/Cetirizine|Paracetamol demo course/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Synthetic record|Synthetic:/)).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Paracetamol · 500 mg/ })).toHaveAttribute('href', '/medications')
  })
  it('adds goals from the keyboard, rejects empty input, and cancels with Escape', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = screen.getByRole('region', { name: 'My Health Goals' })
    await user.click(await within(card).findByRole('button', { name: '+ Add your first goal' }))
    const input = within(card).getByRole('textbox', { name: 'New health goal' })
    expect(input).toHaveAttribute('maxLength', '200')
    await user.keyboard('{Enter}')
    expect(await within(card).findByRole('alert')).toHaveTextContent('Enter a goal.')
    expect(healthGoals.create).not.toHaveBeenCalled()
    await user.type(input, '  Drink more water  ')
    await user.keyboard('{Enter}')
    expect(await within(card).findByLabelText('Drink more water')).toBeInTheDocument()
    expect(healthGoals.create).toHaveBeenCalledWith('Drink more water')
    await user.click(within(card).getByRole('button', { name: '+ Add goal' }))
    const nextInput = within(card).getByRole('textbox', { name: 'New health goal' })
    await user.keyboard('{Escape}')
    expect(within(card).queryByRole('textbox', { name: 'New health goal' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '+ Add goal' })).toHaveFocus()
  })
  it('includes a narrow-screen checklist layout', () => {
    const styles = readFileSync(join(process.cwd(), 'src/features/care-plan/patientHealthGoals.css'), 'utf8')
    expect(styles).toContain('@media(max-width:420px)')
    expect(styles).toContain('.patient-health-goal-add-form input{flex-basis:100%}')
    expect(styles).toContain('text-decoration:line-through')
  })
  it('completes, reopens, deletes, and reloads personal goals in stable groups', async () => {
    healthGoals.rows = [
      { id: '71000000-0000-4000-8000-000000000001', title: 'Walk each day', isCompleted: false, completedAt: null, createdAt: '2026-10-10T00:00:00Z' },
      { id: '71000000-0000-4000-8000-000000000002', title: 'Completed goal', isCompleted: true, completedAt: '2026-10-11T00:00:00Z', createdAt: '2026-10-09T00:00:00Z' },
    ]
    const first = renderPage()
    const card = screen.getByRole('region', { name: 'My Health Goals' })
    const checkbox = await within(card).findByRole('checkbox', { name: 'Walk each day' })
    expect(checkbox).not.toBeChecked()
    expect(within(card).getAllByRole('checkbox').map(item => item.closest('label').textContent.trim())).toEqual(['Walk each day', 'Completed goal'])
    expect(within(card).getByText('Completed goal').closest('.patient-health-goal')).toHaveClass('is-completed')
    fireEvent.click(checkbox)
    expect(await within(card).findByRole('checkbox', { name: 'Walk each day' })).toBeChecked()
    expect(healthGoals.setCompletion).toHaveBeenCalledWith('71000000-0000-4000-8000-000000000001', true)
    expect(healthGoals.rows[0].completedAt).toBeTruthy()
    first.unmount()
    renderPage()
    const reloaded = screen.getByRole('region', { name: 'My Health Goals' })
    const reopened = await within(reloaded).findByRole('checkbox', { name: 'Walk each day' })
    expect(reopened).toBeChecked()
    fireEvent.click(reopened)
    expect(await within(reloaded).findByRole('checkbox', { name: 'Walk each day' })).not.toBeChecked()
    expect(healthGoals.setCompletion).toHaveBeenLastCalledWith('71000000-0000-4000-8000-000000000001', false)
    fireEvent.click(within(reloaded).getByRole('button', { name: 'Delete goal: Walk each day' }))
    await waitFor(() => expect(within(reloaded).queryByRole('checkbox', { name: 'Walk each day' })).not.toBeInTheDocument())
    expect(healthGoals.remove).toHaveBeenCalledWith('71000000-0000-4000-8000-000000000001')
  })
  it('renders today’s recorded times and uses the existing idempotent event update for Done', async () => {
    const medicationId = '33a00000-0000-4000-8000-000000000001'
    const eventId = '33a00000-0000-4000-8000-000000000002'
    api.medications.mockResolvedValue([{ id: medicationId, name: 'Baclofen', dosage: '5 mg', frequency: 'Once daily', status: 'active', schedules: [] }])
    api.today.mockResolvedValue([{ medication: { id: medicationId }, schedule: { id: 'schedule-1', timeOfDay: '20:00', timezone: 'Asia/Yangon' }, events: [{ id: eventId, status: 'pending', scheduledAt: '2026-10-10T13:30:00Z' }] }])
    renderPage()
    expect(await screen.findByText('Time: 8:00 PM')).toBeInTheDocument()
    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.click(done)
    fireEvent.click(done)
    expect(await screen.findByText(/Taken at/)).toBeInTheDocument()
    expect(api.markTaken).toHaveBeenCalledTimes(1)
    expect(api.markTaken).toHaveBeenCalledWith(eventId, 'taken')
    expect(screen.getByRole('heading', { name: 'My Care Plan' })).toBeInTheDocument()
    api.today.mockResolvedValue([{ medication: { id: medicationId }, schedule: { id: 'schedule-1', timeOfDay: '20:00', timezone: 'Asia/Yangon' }, events: [{ id: eventId, status: 'taken', scheduledAt: '2026-10-10T13:30:00Z', confirmedAt: '2026-10-10T13:35:00Z' }] }])
    cleanup(); renderPage()
    expect(await screen.findByText(/Taken at/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
  it('uses frequency without inventing a time when no schedule exists', async () => {
    api.medications.mockResolvedValue([{ id: 'med-report', name: 'Reported inhaler', dosage: '', frequency: 'As needed', status: 'active', schedules: [] }])
    renderPage()
    expect(await screen.findAllByText('As needed')).toHaveLength(1)
    expect(screen.queryByText(/Time:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
  it('keeps the medication list visible when optional schedule/event and reported reads fail', async () => {
    api.medications.mockResolvedValue([
      { id: 'paracetamol', name: 'Paracetamol', dosage: '1 tablet', frequency: 'Every 8 hours as needed for pain', instructions: 'Take as needed for pain.', status: 'active', schedules: [] },
      { id: 'diclofenac', name: 'Diclofenac Gel', dosage: 'Thin layer', frequency: '3 times daily', instructions: 'Apply a thin layer to the neck area.', status: 'active', schedules: [] },
      { id: 'vitamin-b', name: 'Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Take after food.', status: 'active', schedules: [] },
    ])
    api.today.mockRejectedValue(new Error('optional medication event read failed'))
    api.reported.mockRejectedValue(new Error('optional patient-reported read failed'))
    renderPage()
    const card = screen.getByRole('region', { name: 'My Medications' })
    expect(await within(card).findByText(/Paracetamol · 1 tablet/)).toBeInTheDocument()
    expect(within(card).getByText(/Diclofenac Gel · Thin layer/)).toBeInTheDocument()
    expect(within(card).getByText(/Vitamin B Complex · 1 tablet/)).toBeInTheDocument()
    expect(within(card).getByText('Every 8 hours as needed for pain')).toBeInTheDocument()
    expect(within(card).getByText('Apply a thin layer to the neck area.')).toBeInTheDocument()
    expect(within(card).getByText('Take after food.')).toBeInTheDocument()
    expect(within(card).getAllByText('Active')).toHaveLength(3)
    expect(within(card).queryByText("Couldn't load medications.")).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(within(card).queryByText(/Time:/)).not.toBeInTheDocument()
    expect(api.medications).toHaveBeenCalledWith('patient-a', { onRecords: expect.any(Function) })
    fireEvent.click(within(card).getByRole('link', { name: 'View All Medications' }))
    expect(await screen.findByText('Medication destination: list')).toBeInTheDocument()
  })
  it('persists a once-daily check-in, restores it after reload, and shows the current Yangon date', async () => {
    const medicationId = '44a00000-0000-4000-8000-000000000101'
    const saved = { id: 'daily-checkin', patientMedicationId: medicationId, localDate: todayYangon(), occurrenceIndex: 1, status: 'taken' }
    api.medications.mockResolvedValue([{ id: medicationId, name: 'Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Take after food.', status: 'active', schedules: [] }])
    api.checkins.mockImplementation(async () => api.recordCheckin.mock.calls.length ? [saved] : [])
    const { unmount } = renderPage()
    const card = screen.getByRole('region', { name: 'My Medications' })
    expect(await within(card).findByText(todayLabel())).toBeInTheDocument()
    const done = await within(card).findByRole('button', { name: 'Done' })
    fireEvent.click(done)
    expect(await within(card).findByText(/✓ Done/)).toBeInTheDocument()
    expect(api.recordCheckin).toHaveBeenCalledWith(expect.objectContaining({ medicationId, occurrenceIndex: 1 }))
    unmount()
    renderPage()
    expect(await screen.findByText(/✓ Done/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
  it('tracks three daily occurrences independently', async () => {
    const medicationId = '44a00000-0000-4000-8000-000000000102'
    api.medications.mockResolvedValue([{ id: medicationId, name: 'Diclofenac Gel', dosage: 'Thin layer', frequency: '3 times daily', status: 'active', schedules: [] }])
    renderPage()
    const first = await screen.findByText('Dose 1')
    const firstOccurrence = first.closest('.care-medication-occurrence')
    fireEvent.click(within(firstOccurrence).getByRole('button', { name: 'Done' }))
    expect(await within(firstOccurrence).findByText(/✓ Done/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(2)
    expect(api.recordCheckin).toHaveBeenCalledWith(expect.objectContaining({ medicationId, occurrenceIndex: 1 }))
  })
  it('offers PRN Mark as Taken without a mandatory daily dose', async () => {
    const medicationId = '44a00000-0000-4000-8000-000000000103'
    api.medications.mockResolvedValue([{ id: medicationId, name: 'Paracetamol', dosage: '500 mg', frequency: 'Every 8 hours as needed for pain', status: 'active', schedules: [] }])
    renderPage()
    expect(await screen.findByText('As needed')).toBeInTheDocument()
    expect(screen.queryByText('Dose 1')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as Taken' }))
    expect(await screen.findByText(/✓ Taken today/)).toBeInTheDocument()
    expect(api.recordCheckin).toHaveBeenCalledWith(expect.objectContaining({ medicationId, occurrenceIndex: null }))
  })
  it('shows multiple scheduled doses separately with their stored times and event states', async () => {
    const medicationId = '44a00000-0000-4000-8000-000000000001'
    api.medications.mockResolvedValue([{ id: medicationId, name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice daily', status: 'active', schedules: [] }])
    api.today.mockResolvedValue([
      { medication: { id: medicationId }, schedule: { id: 'morning', timeOfDay: '08:00:00', timezone: 'Asia/Yangon' }, events: [{ id: 'e1', status: 'taken', scheduledAt: '2099-01-01T01:30:00Z', confirmedAt: '2099-01-01T01:35:00Z' }] },
      { medication: { id: medicationId }, schedule: { id: 'evening', timeOfDay: '20:00:00', timezone: 'Asia/Yangon' }, events: [{ id: 'e2', status: 'pending', scheduledAt: '2099-01-01T13:30:00Z' }] },
    ])
    renderPage()
    expect(await screen.findByText('Time: 8:00 AM')).toBeInTheDocument()
    expect(screen.getByText('Time: 8:00 PM')).toBeInTheDocument()
    expect(screen.getByText(/Taken at/)).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })
  it('retries medication reads independently after an error', async () => {
    api.medications.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([{ id: 'med-1', name: 'Baclofen', dosage: '5 mg', frequency: 'Once daily', status: 'active', schedules: [] }])
    renderPage()
    const medicationCard = screen.getByRole('region', { name: 'My Medications' })
    fireEvent.click(await within(medicationCard).findByRole('button', { name: 'Retry' }))
    expect(await within(medicationCard).findByText('Baclofen · 5 mg')).toBeInTheDocument()
  })
  it('shows a compact retry when a card read fails', async () => {
    monitoring.listPlans.mockRejectedValueOnce(new Error('read failed'))
    renderPage()
    const error = await screen.findByRole('alert')
    expect(within(error).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

afterEach(() => medicationQueryClient.clear())
