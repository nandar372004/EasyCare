import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProviderCarePlanDetailPage, ProviderCarePlansPlaceholder, ProviderCarePlanWizardPage } from './ProviderCarePlans.jsx'

const state = vi.hoisted(() => ({ auth: null, rows: [], plans: [], plan: null, rpc: {} }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => state.auth }))
vi.mock('../../services/providerWorkspaceService.js', () => ({ providerWorkspaceService: { listPatients: () => state.rpc.listPatients?.() ?? Promise.resolve(state.rows) } }))
vi.mock('../../services/carePlanService.js', () => ({ carePlanService: {
  listProviderPlans: (...args) => state.rpc.listProviderPlans?.(...args) ?? Promise.resolve(state.plans),
  getProviderPlan: (...args) => state.rpc.getProviderPlan?.(...args) ?? Promise.resolve(state.plan),
  listProviderSources: (...args) => state.rpc.listProviderSources?.(...args) ?? Promise.resolve([]),
  createDraft: (...args) => state.rpc.createDraft?.(...args) ?? Promise.resolve('plan-1'),
  createVersion: (...args) => state.rpc.createVersion?.(...args) ?? Promise.resolve('version-2'),
  addGoal: (...args) => state.rpc.addGoal?.(...args) ?? Promise.resolve('goal-1'),
  addTask: (...args) => state.rpc.addTask?.(...args) ?? Promise.resolve('task-1'),
  approveVersion: (...args) => state.rpc.approveVersion?.(...args) ?? Promise.resolve('version-1'),
  approveProviderVersion: (...args) => state.rpc.approveProviderVersion?.(...args) ?? Promise.resolve('version-2'),
  transition: (...args) => state.rpc.transition?.(...args) ?? Promise.resolve(),
} }))

const patientRows = [
  { id: 'patient-1', displayName: 'Authorized Patient', relationshipContext: 'appointment' },
  { id: 'patient-2', displayName: 'Assigned Patient', relationshipContext: 'care_assignment' },
]
const planData = (status = 'active', overrides = {}) => ({
  patient: { id: 'patient-1', full_name: 'Authorized Patient' },
  plan: { id: 'plan-1', patient_id: 'patient-1', status, current_version_id: 'version-1', starts_at: '2026-10-04T02:30:00Z', target_end_at: null, timezone: 'Asia/Yangon', ...overrides.plan },
  versions: overrides.versions ?? [
    { id: 'version-1', version_no: 1, status: 'published', title: 'Current plan', summary: 'Summary', instructions: 'Instructions', change_reason: null },
  ],
  goals: overrides.goals ?? [{ id: 'goal-1', version_id: 'version-1', title: 'Existing goal', description: 'Goal detail', target_text: 'Target' }],
  tasks: overrides.tasks ?? [{ id: 'task-1', version_id: 'version-1', task_type: 'instruction', title: 'Existing task', recurrence: 'daily', instructions: 'Task note' }],
})

beforeEach(() => {
  state.auth = { provider: { id: 'provider-1', type: 'doctor' } }
  state.rows = patientRows
  state.plans = []
  state.plan = planData()
  state.rpc = {}
})
afterEach(() => cleanup())

function renderList() {
  return render(<MemoryRouter><ProviderCarePlansPlaceholder /></MemoryRouter>)
}
function renderDetail(path = '/provider/care-plans/plan-1') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/provider/care-plans/:planId" element={<ProviderCarePlanDetailPage />} />
    <Route path="/provider/care-plans/:planId/activate" element={<ProviderCarePlanWizardPage />} />
    <Route path="/provider/care-plans/:planId/edit" element={<ProviderCarePlanWizardPage />} />
  </Routes></MemoryRouter>)
}
async function beginWizard(user) {
  render(<MemoryRouter initialEntries={['/provider/care-plans/new']}><Routes>
    <Route path="/provider/care-plans/new" element={<ProviderCarePlanWizardPage />} />
    <Route path="/provider/care-plans/:planId" element={<ProviderCarePlanDetailPage />} />
    <Route path="/provider/care-plans/:planId/activate" element={<ProviderCarePlanWizardPage />} />
  </Routes></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: /authorized patient/i }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}
async function enterGoals(user) {
  await user.type(screen.getByLabelText('Plan title'), 'Clinician plan')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(screen.getByLabelText('Goal title'), 'Clinician goal')
  await user.click(screen.getByRole('button', { name: 'Add goal' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}
async function selectTaskType(user, type) {
  await user.selectOptions(screen.getByLabelText('Task type'), type)
  await screen.findByLabelText(type === 'medication' ? 'Existing medication and schedule' : type === 'appointment' ? 'Existing appointment' : type === 'follow_up' ? 'Existing follow-up' : 'Task type')
}

describe('Phase 5A.1 provider Care Plan UI verification', () => {
  it('1. lists only plans returned by the provider-scoped contract', async () => {
    state.plans = [{ plan_id: 'plan-1', patient_id: 'patient-1', patient_name: 'Authorized Patient', status: 'active', title: 'Plan for this patient', version_no: 1, starts_at: '2026-10-04T02:30:00Z', updated_at: '2026-10-04T02:30:00Z' }]
    renderList()
    expect(await screen.findByText('Plan for this patient')).toBeInTheDocument()
    expect(screen.getByText('Authorized Patient')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated Patient')).not.toBeInTheDocument()
  })
  it('2. gives an honest empty state', async () => {
    renderList()
    expect(await screen.findByRole('heading', { name: 'No Care Plans' })).toBeInTheDocument()
  })
  it('3. shows a network or authorization failure separately from empty state', async () => {
    state.rpc.listProviderPlans = vi.fn().mockRejectedValue(new Error('network down'))
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent('Care Plan could not be saved')
    expect(screen.queryByRole('heading', { name: 'No Care Plans' })).not.toBeInTheDocument()
  })
  it('4. selects only patients returned by the relationship-scoped patient service', async () => {
    const user = userEvent.setup()
    await beginWizard(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: /assigned patient/i })).toBeInTheDocument()
    expect(screen.queryByText('Unrelated Patient')).not.toBeInTheDocument()
  })
  it('5. has no patient UUID textbox or global search', async () => {
    const user = userEvent.setup()
    await beginWizard(user)
    expect(screen.queryByRole('textbox', { name: /patient|search/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/uuid|search/i)).not.toBeInTheDocument()
  })
  it('6. creates a draft for the selected patient through the service contract', async () => {
    const user = userEvent.setup()
    state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new')
    state.rpc.addGoal = vi.fn().mockResolvedValue('goal-new')
    state.rpc.addTask = vi.fn().mockResolvedValue('task-new')
    state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new')
    state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user)
    await user.type(screen.getByLabelText('Task title'), 'Record a note')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue to Activation' }))
    await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i }))
    await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByText(/Care Plan activated/)).toBeInTheDocument()
    expect(state.rpc.createDraft).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'patient-1', title: 'Clinician plan' }))
  })
  it('7. shows draft creation failure without a success state', async () => {
    const user = userEvent.setup()
    state.rpc.createDraft = vi.fn().mockRejectedValue(new Error('network down'))
    await beginWizard(user); await enterGoals(user)
    await user.type(screen.getByLabelText('Task title'), 'Record a note'); await user.click(screen.getByRole('button', { name: 'Add task' }))
    await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' }))
    await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.queryByText('Provider plan detail route')).not.toBeInTheDocument()
  })
  it('8. requires title/start and rejects a target date before the start date', async () => {
    const user = userEvent.setup(); await beginWizard(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent('plan title and start date')
    await user.type(screen.getByLabelText('Plan title'), 'Plan')
    await user.type(screen.getByLabelText('Target end date (optional)'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Target end date must be on or after')
  })
  it('9. submits timezone-aware plan dates and displays the selected timezone', async () => {
    const user = userEvent.setup(); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-new'); state.rpc.addTask = vi.fn().mockResolvedValue('task-new'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user)
    await user.type(screen.getByLabelText('Plan title'), 'Timezone plan')
    await user.selectOptions(screen.getByLabelText('Timezone'), 'UTC')
    expect(screen.getByLabelText('Timezone')).toHaveValue('UTC')
    expect(screen.getByLabelText('Start date and time').value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    await user.click(screen.getByRole('button', { name: 'Continue' })); await user.type(screen.getByLabelText('Goal title'), 'Goal'); await user.click(screen.getByRole('button', { name: 'Add goal' })); await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    await waitFor(() => expect(state.rpc.createDraft).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'UTC', startsAt: expect.stringMatching(/Z$/) })))
  })
  it('10. adds and removes unsaved goals', async () => {
    const user = userEvent.setup(); await beginWizard(user)
    await user.type(screen.getByLabelText('Plan title'), 'Plan'); await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Goal title'), 'Draft goal'); await user.click(screen.getByRole('button', { name: 'Add goal' }))
    expect(screen.getByText(/Draft goal/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText(/Draft goal/)).not.toBeInTheDocument()
  })
  it('11. marks saved goals as read-only while allowing append-only additions', async () => {
    state.plan = planData('active', { plan: { current_version_id: 'version-1' }, versions: [
      { id: 'version-1', version_no: 1, status: 'published', title: 'Current plan' },
      { id: 'version-2', version_no: 2, status: 'draft', title: 'Draft plan' },
    ], goals: [{ id: 'goal-saved', version_id: 'version-2', title: 'Saved draft goal' }], tasks: [] })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/provider/care-plans/plan-1/edit']}><Routes><Route path="/provider/care-plans/:planId/edit" element={<ProviderCarePlanWizardPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/Saved in this draft/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText(/do not allow editing saved draft metadata/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Goal title'), 'Appended goal')
    await user.click(screen.getByRole('button', { name: 'Add goal' }))
    expect(screen.getByText(/Appended goal/)).toBeInTheDocument()
  })
  it('12. loads medication schedules from the authorized same-patient source service', async () => {
    const user = userEvent.setup()
    state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ medication_id: 'med-1', schedule_id: 'schedule-1', name: 'Source medicine', dose: '10 mg', time_of_day: '08:00', timezone: 'Asia/Yangon' }])
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'medication')
    expect(await screen.findByRole('option', { name: /Source medicine.*10 mg/ })).toBeInTheDocument()
    expect(state.rpc.listProviderSources).toHaveBeenCalledWith('patient-1', 'medication')
  })
  it('12a. changing patient clears stale source rows and source identifiers', async () => {
    const user = userEvent.setup()
    state.rpc.listProviderSources = vi.fn(async (patientId, kind) => patientId === 'patient-1' && kind === 'medication'
      ? [{ medication_id: 'med-1', schedule_id: 'schedule-1', name: 'Patient one medicine', time_of_day: '08:00', timezone: 'Asia/Yangon' }]
      : [])
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'medication')
    await screen.findByRole('option', { name: /Patient one medicine/ })
    await user.click(screen.getByRole('button', { name: 'Back' })); await user.click(screen.getByRole('button', { name: 'Back' })); await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: /assigned patient/i }))
    await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(state.rpc.listProviderSources).toHaveBeenLastCalledWith('patient-2', 'medication'))
    expect(screen.queryByRole('option', { name: /Patient one medicine/ })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Task title'), 'Dose')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Select an existing medication and schedule')
  })
  it('13. medication task has no free-text medication fallback', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'medication')
    expect(screen.queryByLabelText(/medication name/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Existing medication and schedule').tagName).toBe('SELECT')
  })
  it('14. exposes only backend-supported vital types', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'vital_check')
    expect(Array.from(screen.getByLabelText('Vital type').options, option => option.textContent)).toEqual(['blood_pressure','heart_rate','spo2','temperature','glucose','weight'])
  })
  it('15. vital form contains no thresholds or fabricated readings', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'vital_check')
    expect(screen.queryByLabelText(/threshold|target reading|reading value/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/diagnos/i)).not.toBeInTheDocument()
  })
  it('16. appointment selector displays only safe returned source rows', async () => {
    const user = userEvent.setup()
    state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ id: 'appt-1', appointment_type: 'Consultation', scheduled_start: '2026-10-05T04:00:00Z', status: 'confirmed' }])
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'appointment')
    expect(await screen.findByRole('option', { name: /Consultation.*confirmed/ })).toBeInTheDocument()
    expect(screen.queryByText('Unrelated appointment')).not.toBeInTheDocument()
  })
  it('17. appointment authoring calls only the Care Plan task service', async () => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ id: 'appt-1', appointment_type: 'Consultation', scheduled_start: '2026-10-05T04:00:00Z', status: 'confirmed' }])
    state.rpc.addTask = vi.fn().mockResolvedValue('task-1')
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'appointment')
    await user.type(screen.getByLabelText('Task title'), 'Visit')
    await user.selectOptions(screen.getByLabelText('Existing appointment'), 'appt-1')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(state.rpc.addTask).not.toHaveBeenCalled()
    expect(screen.getByText(/appointment · one_time/)).toBeInTheDocument()
  })
  it('18. follow-up selector displays pending source rows returned by backend', async () => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ id: 'follow-1', follow_up_type: 'Review', due_at: '2026-10-05T04:00:00Z', status: 'pending' }])
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'follow_up')
    expect(await screen.findByRole('option', { name: /Review/ })).toBeInTheDocument()
    expect(state.rpc.listProviderSources).toHaveBeenCalledWith('patient-1', 'follow_up')
  })
  it('19. follow-up authoring does not invoke a follow-up lifecycle service', async () => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ id: 'follow-1', follow_up_type: 'Review', due_at: '2026-10-05T04:00:00Z', status: 'pending' }])
    state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'follow_up')
    await user.type(screen.getByLabelText('Task title'), 'Review'); await user.selectOptions(screen.getByLabelText('Existing follow-up'), 'follow-1'); await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(state.rpc.addTask).not.toHaveBeenCalled()
    expect(screen.getByText(/follow_up · one_time/)).toBeInTheDocument()
  })
  it('20. activity permits existing manual acknowledgement', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'activity')
    expect(screen.getByRole('checkbox', { name: /Allow manual acknowledgement/ })).toBeChecked()
  })
  it('21a. instruction permits existing manual acknowledgement', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'instruction')
    expect(screen.getByRole('checkbox', { name: /Allow manual acknowledgement/ })).toBeChecked()
  })
  it('21b. custom permits existing manual acknowledgement', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'custom')
    expect(screen.getByRole('checkbox', { name: /Allow manual acknowledgement/ })).toBeChecked()
  })
  it.each(['medication','vital_check','appointment','follow_up'])('22. %s cannot expose generic manual acknowledgement', async type => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, type)
    expect(screen.queryByRole('checkbox', { name: /Allow manual acknowledgement/ })).not.toBeInTheDocument()
  })
  it('23. one-time recurrence renders and is submitted to task creation', async () => {
    const user = userEvent.setup(); state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'One-time task'); await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByText(/instruction · one_time/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    await waitFor(() => expect(state.rpc.addTask).toHaveBeenCalledWith(expect.objectContaining({ recurrence: 'one_time' })))
  })
  it('24. daily recurrence is selectable', async () => {
    const user = userEvent.setup(); state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user)
    await user.selectOptions(screen.getByLabelText('Recurrence'), 'daily')
    expect(screen.getByLabelText('Recurrence')).toHaveValue('daily')
    await user.type(screen.getByLabelText('Task title'), 'Daily task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    await waitFor(() => expect(state.rpc.addTask).toHaveBeenCalledWith(expect.objectContaining({ recurrence: 'daily' })))
  })
  it('25. selected weekdays requires at least one weekday', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user)
    await user.selectOptions(screen.getByLabelText('Recurrence'), 'selected_weekdays')
    await user.type(screen.getByLabelText('Task title'), 'Weekday task'); await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one weekday')
    await user.click(screen.getByRole('checkbox', { name: 'Mon' })); await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByText(/instruction · selected_weekdays/)).toBeInTheDocument()
  })
  it('26. multiple daily slots enforces valid local times and the eight-slot limit', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user)
    await user.selectOptions(screen.getByLabelText('Recurrence'), 'multiple_daily_slots')
    await user.type(screen.getByLabelText('Task title'), 'Slots')
    const input = screen.getByLabelText('Local times (comma separated, max 8)')
    await user.clear(input); await user.type(input, '07:00,08:00,09:00,10:00,11:00,12:00,13:00,14:00,15:00')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent('2–8 valid local times')
    await user.clear(input); await user.type(input, '07:00,08:00'); await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByText(/instruction · multiple_daily_slots/)).toBeInTheDocument()
  })
  it('27. medication source_schedule recurrence is offered only for medication and preserves source link', async () => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ medication_id: 'med-1', schedule_id: 'schedule-1', name: 'Medicine', time_of_day: '08:00', timezone: 'Asia/Yangon' }])
    state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-new'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'medication')
    await screen.findByRole('option', { name: /Medicine/ })
    await user.selectOptions(screen.getByLabelText('Existing medication and schedule'), 'schedule-1')
    const recurrence = screen.getAllByLabelText('Recurrence')[0]
    await user.selectOptions(recurrence, 'source_schedule')
    expect(recurrence).toHaveValue('source_schedule')
    expect(screen.queryByLabelText('Local times (comma separated, max 8)')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Task title'), 'Dose task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    await waitFor(() => expect(state.rpc.addTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'medication', medicationId: 'med-1', medicationScheduleId: 'schedule-1', recurrence: 'source_schedule' })))
  })
  it.each(['appointment','follow_up'])('28. %s is constrained to one-time recurrence', async type => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await selectTaskType(user, type)
    expect(screen.queryByLabelText('Recurrence')).not.toBeInTheDocument()
  })
  it('29. review displays patient, plan details, goal, task, schedule and timezone', async () => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockResolvedValue([{ medication_id: 'med-1', schedule_id: 'schedule-1', name: 'Medicine', time_of_day: '08:00', timezone: 'Asia/Yangon' }])
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, 'medication'); await user.selectOptions(screen.getByLabelText('Existing medication and schedule'), 'schedule-1')
    await user.type(screen.getByLabelText('Task title'), 'Medicine task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Authorized Patient')).toBeInTheDocument(); expect(screen.getByText('Clinician plan')).toBeInTheDocument(); expect(screen.getByText('Clinician goal')).toBeInTheDocument()
    expect(screen.getByText('Medicine task').closest('li')).toHaveTextContent('Medicine')
  })
  it('30. activation requires explicit confirmation', async () => {
    const user = userEvent.setup(); await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' }))
    expect(screen.getByRole('button', { name: 'Confirm and Activate' })).toBeDisabled()
  })
  it('31. successful activation approves, transitions, and navigates to provider detail', async () => {
    const user = userEvent.setup(); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-new'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-new'); state.rpc.addTask = vi.fn().mockResolvedValue('task-new'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-new'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByText(/Care Plan activated/)).toBeInTheDocument(); expect(state.rpc.approveVersion).toHaveBeenCalledWith('plan-new'); expect(state.rpc.transition).toHaveBeenCalledWith('plan-new', 'activate')
  })
  it('32. activation failure displays error and never presents success', async () => {
    const user = userEvent.setup(); state.rpc.createDraft = vi.fn().mockRejectedValue(new Error('network down'))
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved'); expect(screen.queryByText(/Care Plan activated/)).not.toBeInTheDocument()
  })
  it('33. provider detail displays authorized plan, current version, goals and tasks', async () => {
    renderDetail(); expect(await screen.findByRole('heading', { name: 'Current plan' })).toBeInTheDocument()
    expect(screen.getByText('Authorized Patient')).toBeInTheDocument(); expect(screen.getByText('Existing goal')).toBeInTheDocument(); expect(screen.getByText('Existing task')).toBeInTheDocument()
  })
  it('34. inaccessible detail shows unavailable without revealing unrelated plan data', async () => {
    state.rpc.getProviderPlan = vi.fn().mockResolvedValue(null); renderDetail()
    expect(await screen.findByRole('heading', { name: 'Care Plan unavailable' })).toBeInTheDocument()
    expect(screen.queryByText('Unrelated Patient')).not.toBeInTheDocument()
  })
  it('35. published content is displayed without inline edit/delete controls', async () => {
    renderDetail(); await screen.findByRole('heading', { name: 'Current plan' })
    expect(screen.queryByRole('button', { name: /edit goal|delete goal|edit task|delete task/i })).not.toBeInTheDocument()
  })
  it('36. Create New Version calls the existing version service contract', async () => {
    const user = userEvent.setup(); state.rpc.createVersion = vi.fn().mockResolvedValue('version-2'); renderDetail()
    await user.click(await screen.findByRole('button', { name: 'Create New Version' }))
    await user.clear(screen.getByLabelText('Version title')); await user.type(screen.getByLabelText('Version title'), 'Updated plan'); await user.type(screen.getByLabelText('Change reason'), 'Follow-up review'); await user.click(screen.getByRole('button', { name: 'Start Draft Version' }))
    expect(state.rpc.createVersion).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', title: 'Updated plan', changeReason: 'Follow-up review' }))
  })
  it('36a. Create New Version failure is visible and does not add a draft version locally', async () => {
    const user = userEvent.setup(); state.rpc.createVersion = vi.fn().mockRejectedValue(new Error('version conflict')); renderDetail()
    await user.click(await screen.findByRole('button', { name: 'Create New Version' }))
    await user.clear(screen.getByLabelText('Version title')); await user.type(screen.getByLabelText('Version title'), 'Updated plan'); await user.type(screen.getByLabelText('Change reason'), 'Review')
    await user.click(screen.getByRole('button', { name: 'Start Draft Version' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('version conflict')
    expect(state.rpc.createVersion).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Draft version 2 is being authored/)).not.toBeInTheDocument()
  })
  it('37. version history preserves previously published version entries', async () => {
    state.plan = planData('active', { versions: [
      { id: 'version-1', version_no: 1, status: 'published', title: 'Original plan' },
      { id: 'version-2', version_no: 2, status: 'published', title: 'Revised plan', change_reason: 'Review' },
    ], plan: { current_version_id: 'version-2' } })
    renderDetail(); expect(await screen.findByText(/Version 1: Original plan \(published\)/)).toBeInTheDocument(); expect(screen.getByText(/Version 2: Revised plan/)).toBeInTheDocument()
  })
  it('38. active lifecycle exposes pause, complete and discontinue only', async () => {
    renderDetail(); await screen.findByRole('heading', { name: 'Current plan' })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Discontinue' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
  })
  it('39. paused lifecycle exposes resume, complete and discontinue only', async () => {
    state.plan = planData('paused'); renderDetail(); await screen.findByRole('heading', { name: 'Current plan' })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Discontinue' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })
  it.each(['completed','discontinued','cancelled'])('40. terminal %s plan has no reopen controls', async status => {
    state.plan = planData(status); renderDetail(); await screen.findByRole('heading', { name: 'Current plan' })
    expect(screen.queryByRole('button', { name: /activate|resume|reopen|pause/i })).not.toBeInTheDocument()
  })
  it('41. lifecycle failure reloads authoritative state and shows the error', async () => {
    const user = userEvent.setup(); state.rpc.transition = vi.fn().mockRejectedValue(new Error('network down')); state.rpc.getProviderPlan = vi.fn().mockResolvedValue(planData('active'))
    renderDetail(); await user.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved'); expect(state.rpc.getProviderPlan).toHaveBeenCalledTimes(2); expect(screen.getByText('active')).toBeInTheDocument()
  })
  it('42. authoring UI does not expose AI controls', async () => {
    const user = userEvent.setup(); await beginWizard(user)
    expect(screen.queryByRole('button', { name: /AI|generate|recommend/i })).not.toBeInTheDocument()
  })
  it('50. switching provider identity clears prior authoring patient data in place', async () => {
    const page = <MemoryRouter initialEntries={['/provider/care-plans/new']}><ProviderCarePlanWizardPage /></MemoryRouter>
    const ui = render(page)
    expect(await screen.findByRole('button', { name: /authorized patient/i })).toBeInTheDocument()
    state.auth = { provider: { id: 'provider-2', type: 'doctor' } }; state.rows = [{ id: 'patient-2', displayName: 'New Provider Patient', relationshipContext: 'care_assignment' }]
    ui.rerender(<MemoryRouter initialEntries={['/provider/care-plans/new']}><ProviderCarePlanWizardPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /new provider patient/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new provider patient/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /authorized patient/i })).not.toBeInTheDocument()
  })
  it.each(['medication','appointment','follow_up'])('51. %s source-load failure is visible and does not permit an unsafe fallback', async type => {
    const user = userEvent.setup(); state.rpc.listProviderSources = vi.fn().mockRejectedValue(new Error('denied')); state.rpc.addTask = vi.fn().mockResolvedValue('task-1')
    await beginWizard(user); await enterGoals(user); await selectTaskType(user, type)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load same-patient source records')
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/medication name/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Task title'), 'Source task')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByRole('alert')).toHaveTextContent(type === 'medication' ? 'Select an existing medication' : type === 'appointment' ? 'Select an existing appointment' : 'Select an existing follow-up')
    expect(state.rpc.addTask).not.toHaveBeenCalled()
  })
  it.each(['createDraft','addGoal','addTask','approveVersion'])('52. %s failure remains visible and does not claim success', async mutation => {
    const user = userEvent.setup()
    state.rpc.createDraft = vi.fn().mockResolvedValue('plan-partial'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-1'); state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-1'); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    state.rpc[mutation] = vi.fn().mockRejectedValue(new Error('network down'))
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(state.rpc[mutation]).toHaveBeenCalledOnce()
    expect(screen.queryByText(/Care Plan activated/)).not.toBeInTheDocument()
  })
  it.each(['pause','resume','complete','discontinue'])('53. %s mutation failure preserves authoritative detail state', async intent => {
    const user = userEvent.setup(); state.plan = planData(intent === 'resume' ? 'paused' : 'active'); state.rpc.transition = vi.fn().mockRejectedValue(new Error('network down')); state.rpc.getProviderPlan = vi.fn().mockResolvedValue(state.plan)
    renderDetail(); await user.click(await screen.findByRole('button', { name: intent[0].toUpperCase() + intent.slice(1) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved'); expect(state.rpc.getProviderPlan).toHaveBeenCalledTimes(2)
    expect(state.rpc.transition).toHaveBeenCalledOnce()
  })
  it('54. approval failure after a saved draft leaves a recoverable detail state', async () => {
    const user = userEvent.setup(); state.rpc.createDraft = vi.fn().mockResolvedValue('plan-partial'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-1'); state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.approveVersion = vi.fn().mockRejectedValue(new Error('version conflict'))
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('version conflict')
  })
  it('54a. activation transition failure stays honest and permits a safe retry', async () => {
    const user = userEvent.setup()
    state.plan = planData('draft', { plan: { current_version_id: 'version-1' } })
    state.rpc.createDraft = vi.fn().mockResolvedValue('plan-partial'); state.rpc.addGoal = vi.fn().mockResolvedValue('goal-1'); state.rpc.addTask = vi.fn().mockResolvedValue('task-1'); state.rpc.approveVersion = vi.fn().mockResolvedValue('version-1'); state.rpc.transition = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValue(undefined)
    await beginWizard(user); await enterGoals(user); await user.type(screen.getByLabelText('Task title'), 'Task'); await user.click(screen.getByRole('button', { name: 'Add task' })); await user.click(screen.getByRole('button', { name: 'Continue' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' })); await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.queryByText(/Care Plan activated/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review and Activate' })); await user.click(screen.getByRole('button', { name: 'Continue to Activation' }))
    await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(state.rpc.transition).toHaveBeenCalledTimes(2)
  })
  it('55. activation can be retried when version publication succeeded but transition failed', async () => {
    const user = userEvent.setup(); state.plan = planData('draft', { plan: { current_version_id: 'version-1' } }); state.rpc.transition = vi.fn().mockResolvedValue(undefined)
    renderDetail('/provider/care-plans/plan-1/activate')
    await user.click(await screen.findByRole('button', { name: 'Continue to Activation' }))
    expect(await screen.findByText(/version is already published/i)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /confirm activating it/i })); await user.click(screen.getByRole('button', { name: 'Confirm and Activate' }))
    expect(state.rpc.transition).toHaveBeenCalledWith('plan-1', 'activate')
  })
})
