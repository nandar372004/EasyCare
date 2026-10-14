import { withViewerRelationships } from '../../services/familyRelationship.js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FamilyHealthPage } from './FamilyHealthPage.jsx'
import { familyHealthService } from '../../services/familyHealthService.js'

const { auth, providerRepo } = vi.hoisted(() => ({ auth: { status: 'authenticated', user: { id: 'viewer-profile' }, patient: { id: 'viewer-patient', full_name: 'Nandar', date_of_birth: '1990-01-01' } }, providerRepo: { getDoctor: vi.fn() } }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: providerRepo }))
vi.mock('../../services/familyHealthService.js', () => ({ familyHealthService: {
  getGroups: vi.fn(), getMembers: vi.fn(), loadHealth: vi.fn(), createDocumentSignedUrl: vi.fn(),
} }))

const group = { id: 'group-1', display_name: 'Family' }
const mother = { member_id: 'mother-member', patient_id: 'mother-patient', display_name: 'Mother', relationship: 'mother', role: 'member', is_self: false, authorization: null }
const members = [{ member_id: 'owner-member', patient_id: 'viewer-patient', display_name: 'Nandar', relationship: 'self', role: 'owner', is_self: true }, mother]
const lockedSections = {
  appointments: { status: 'not_authorized', data: null }, medications: { status: 'not_authorized', data: null },
  alerts: { status: 'ready', data: [] }, vitals: { status: 'not_authorized', data: null },
  trends: { status: 'not_authorized', data: null }, records: { status: 'not_authorized', data: null },
  labs: { status: 'unsupported', data: null }, carePlan: { status: 'not_authorized', data: null },
  patientCarePlan: { status: 'not_authorized', data: null },
  documentIntelligence: { status: 'not_authorized', data: null },
}

function renderPage() { return render(<MemoryRouter><FamilyHealthPage /></MemoryRouter>) }

beforeEach(() => {
  vi.resetAllMocks()
  auth.status = 'authenticated'
  auth.user = { id: 'viewer-profile' }
  auth.patient = { id: 'viewer-patient', full_name: 'Nandar', date_of_birth: '1990-01-01' }
  familyHealthService.getGroups.mockResolvedValue([group])
  familyHealthService.getMembers.mockResolvedValue(members)
  familyHealthService.createDocumentSignedUrl.mockResolvedValue('https://signed.example/family-document?token=short')
  providerRepo.getDoctor.mockResolvedValue({ displayName: 'Dr. Example' })
  familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
    ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: { records: true, appointments: true, medications: true, alerts: true }, sections: lockedSections }
    : { member: mother, isSelf: false, permissions: { records: false, appointments: false, medications: false, alerts: false }, sections: lockedSections })
})

describe('Family Health Command Center', () => {
  it.each(['revoked', 'expired'])('denies a direct member route with %s authorization', async status => {
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { patient_id: 'viewer-patient' }, permissions: {}, sections: lockedSections }
      : { member: mother, authorizationStatus: status, permissions: {}, sections: Object.fromEntries(Object.keys(lockedSections).map(name => [name, { status, data: null }])) })
    render(<MemoryRouter initialEntries={['/family/health?groupId=group-1&memberId=mother-member']}><FamilyHealthPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Shared care is no longer available.')
    expect(screen.queryByRole('button', { name: /View Care Plan/ })).not.toBeInTheDocument()
  })
  it('denies unrelated group and removed membership deep links', async () => {
    render(<MemoryRouter initialEntries={['/family/health?groupId=foreign-group&memberId=foreign-member']}><FamilyHealthPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Shared care is no longer available.')
    expect(familyHealthService.loadHealth.mock.calls.some(([input]) => input.memberId === 'foreign-member')).toBe(false)
  })
  it('does not let an older refresh overwrite a newer denied result', async () => {
    let resolveOld
    const pending = new Promise(resolve => { resolveOld = resolve })
    let familyReads = 0
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { patient_id: 'viewer-patient' }, permissions: {}, sections: lockedSections }
      : ++familyReads === 1 ? pending : { member: mother, permissions: {}, sections: lockedSections })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    await waitFor(() => expect(familyReads).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh health information' }))
    await waitFor(() => expect(familyReads).toBeGreaterThan(1))
    await act(async () => resolveOld({ member: mother, permissions: { medications: true }, sections: { ...lockedSections, medications: { status: 'ready', data: [{ id: 'old', medication_name: 'STALE PRIVATE MEDICATION' }] } } }))
    await waitFor(() => expect(screen.queryByText('STALE PRIVATE MEDICATION')).not.toBeInTheDocument())
  })
  it('loads self and accepted members from family APIs, and sends only membership IDs for a family selection', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Family Health' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Mother/ })).toBeInTheDocument()
    expect(familyHealthService.loadHealth).toHaveBeenCalledWith({ selfPatient: auth.patient })
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    await waitFor(() => expect(familyHealthService.loadHealth).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1', memberId: 'mother-member' })))
    expect(familyHealthService.loadHealth.mock.calls.some(([input]) => 'patientId' in input)).toBe(false)
  })

  it('shows only granted detail modules, removes analytics cards, and reuses appointment join eligibility', async () => {
    const appointment = { id: 'shared-appt', providerId: 'provider-1', appointmentType: 'teleconsultation', consultationChannel: 'video', scheduledAt: '2099-04-24T03:30:00Z', scheduledEnd: '2099-04-24T04:00:00Z', status: 'confirmed' }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, permissions: {}, sections: lockedSections }
      : { member: mother, permissions: { appointments: true, care_plans: false, medications: false, records: false }, sections: { appointments: { status: 'ready', data: [appointment] } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('Dr. Example')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join Consultation' })).toHaveAttribute('href', '/consultations/shared-appt')
    expect(screen.getByRole('button', { name: 'View Appointment' })).toBeInTheDocument()
    for (const title of ['Health Intelligence', 'Latest Vitals', 'Vital Trends', 'Active Alerts', 'Recent Lab Results']) {
      expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('heading', { name: 'Medications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Health Records' })).not.toBeInTheDocument()
    expect(providerRepo.getDoctor).toHaveBeenCalledWith('provider-1')
  })

  it('opens a family medical document only from the authorized records section using short-lived signed access', async () => {
    const document = { id: 'medical-doc-1', title: 'Discharge Summary', storage_path: 'private/path', document_date: '2026-08-12' }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar', patient_id: 'viewer-patient' }, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: [] } } }
      : { member: { ...mother, patient_id: 'mother-patient' }, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: [] }, medicalDocuments: { status: 'ready', data: [{ kind: 'document', recordedAt: '2026-08-15T12:00:00Z', record: document }] } } })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'View document' }))
    await waitFor(() => expect(familyHealthService.createDocumentSignedUrl).toHaveBeenCalledWith('mother-patient', 'medical-doc-1'))
    expect(opened).toHaveBeenCalledWith('https://signed.example/family-document?token=short', '_blank', 'noopener,noreferrer')
    opened.mockRestore()
  })

  it('shows the selected member patient-reported Health Records in read-only View all and clears them on member switch', async () => {
    const sister = { ...mother, member_id: 'sister-member', patient_id: 'sister-patient', display_name: 'Sister' }
    familyHealthService.getMembers.mockResolvedValue([members[0], mother, sister])
    const memberRecords = ['Pollen allergy', 'Asthma', 'Flu vaccine', 'Peanut allergy'].map((title, index) => ({
      kind: 'reported', recordedAt: `2026-10-0${index + 1}T00:00:00Z`,
      record: { id: `member-record-${index}`, title, type: index === 2 ? 'Vaccination' : index === 1 ? 'Condition' : 'Allergy', details: { note: `member detail ${index}` } },
    }))
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar', patient_id: 'viewer-patient' }, isSelf: true, permissions: {}, sections: lockedSections }
      : input.memberId === 'mother-member'
        ? { member: { ...mother, patient_id: 'mother-patient' }, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: memberRecords }, medicalDocuments: { status: 'ready', data: [] } } }
        : { member: sister, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: [] }, medicalDocuments: { status: 'ready', data: [] } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('Pollen allergy')).toBeInTheDocument()
    expect(screen.queryByText('No health records have been shared yet.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View all →' }))
    expect(await screen.findByText('Peanut allergy')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sister/ }))
    expect(await screen.findByText('No health records have been shared yet.')).toBeInTheDocument()
    expect(screen.queryByText('Pollen allergy')).not.toBeInTheDocument()
    expect(screen.queryByText('Peanut allergy')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add|Edit|Delete|Archive/i })).not.toBeInTheDocument()
  })

  it('shows isolated presentation Health Records for the three configured members and expands them read-only', async () => {
    const father = { member_id: 'father-member', patient_id: 'father-patient', display_name: 'Kyaw Aung Moe', relationship: 'father', relationshipLabel: 'Father', role: 'member' }
    const shwe = { ...mother, member_id: 'shwe-member', patient_id: 'shwe-patient', display_name: 'Shwe Hnin San', relationship: 'mother', relationshipLabel: 'Mother' }
    const sister = { member_id: 'sister-member', patient_id: 'sister-patient', display_name: 'Eaindray Kyaw', relationship: 'sibling', relationshipLabel: 'Sibling', role: 'member' }
    const unrelated = { member_id: 'unrelated-member', patient_id: 'other-patient', display_name: 'Unrelated Member', relationship: 'friend', role: 'member' }
    familyHealthService.getMembers.mockResolvedValue([members[0], father, shwe, sister, unrelated])
    familyHealthService.loadHealth.mockImplementation(async input => {
      if (input.selfPatient) return {
        member: { member_id: 'owner-member', patient_id: 'viewer-patient', display_name: 'Nandar Kyaw', is_self: true },
        permissions: { records: true },
        sections: { ...lockedSections, records: { status: 'ready', data: [{ kind: 'reported', recordedAt: '2026-10-01T00:00:00Z', record: { id: 'nandar-private-record', title: 'Nandar Private Allergy', type: 'Allergy' } }] } },
      }
      const member = [father, shwe, sister, unrelated].find(row => row.member_id === input.memberId)
      const records = input.memberId === 'father-member' ? { status: 'error', data: null } : { status: 'ready', data: [] }
      return { member, permissions: { records: true }, sections: { ...lockedSections, records, medicalDocuments: { status: 'ready', data: [] } } }
    })
    renderPage()
    expect(await screen.findByText('Nandar Private Allergy')).toBeInTheDocument()
    expect(screen.queryByText('Blood Pressure Monitoring')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /Kyaw Aung Moe/ }))
    const healthRecords = await screen.findByRole('article', { name: 'Health Records' })
    expect(within(healthRecords).getByText('Blood Pressure Monitoring')).toBeInTheDocument()
    expect(within(healthRecords).getByText('145 / 92 mmHg')).toBeInTheDocument()
    expect(within(healthRecords).getByText('Oct 12, 2026')).toBeInTheDocument()
    expect(within(healthRecords).queryByText('Health records are temporarily unavailable.')).not.toBeInTheDocument()
    expect(within(healthRecords).queryByText(/hypertension/i)).not.toBeInTheDocument()
    fireEvent.click(within(healthRecords).getByRole('button', { name: 'View Details' }))
    expect(within(healthRecords).getByText('Oct 10, 2026')).toBeInTheDocument()
    expect(within(healthRecords).queryByText('Nandar Private Allergy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Shwe Hnin San/ }))
    const shweRecords = await screen.findByRole('article', { name: 'Health Records' })
    expect(within(shweRecords).getByText('Blood Sugar Monitoring')).toBeInTheDocument()
    expect(within(shweRecords).getByText('128 mg/dL')).toBeInTheDocument()
    expect(within(shweRecords).queryByText(/diabetes/i)).not.toBeInTheDocument()
    expect(within(shweRecords).queryByText('145 / 92 mmHg')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Eaindray Kyaw/ }))
    const kneeRecords = await screen.findByRole('article', { name: 'Health Records' })
    expect(within(kneeRecords).getByText('Right Knee Follow-up')).toBeInTheDocument()
    expect(within(kneeRecords).getByText('Musculoskeletal Health Record')).toBeInTheDocument()
    expect(within(kneeRecords).queryByText('128 mg/dL')).not.toBeInTheDocument()
    fireEvent.click(within(kneeRecords).getByRole('button', { name: 'View Details' }))
    expect(within(kneeRecords).getByText('Pain during activity')).toBeInTheDocument()
    expect(within(kneeRecords).getByText('Activity modification and follow-up monitoring')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Unrelated Member/ }))
    expect(await screen.findByText('No health records have been shared yet.')).toBeInTheDocument()
    expect(screen.queryByText('Right Knee Follow-up')).not.toBeInTheDocument()
    expect(screen.queryByText('Blood Sugar Monitoring')).not.toBeInTheDocument()
    expect(screen.queryByText('Blood Pressure Monitoring')).not.toBeInTheDocument()
  })

  it('prefers real authorized Health Records over a presentation fallback', async () => {
    const father = { member_id: 'father-member', patient_id: 'father-patient', display_name: 'Kyaw Aung Moe', relationship: 'father', relationshipLabel: 'Father', role: 'member' }
    familyHealthService.getMembers.mockResolvedValue([members[0], father])
    const realRecord = { kind: 'reported', recordedAt: '2026-10-11T00:00:00Z', record: { id: 'real-bp-record', title: 'Shared patient-reported reading', type: 'Vital' } }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { ...members[0], patient_id: 'viewer-patient' }, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: [] } } }
      : { member: father, permissions: { records: true }, sections: { ...lockedSections, records: { status: 'ready', data: [realRecord] } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Kyaw Aung Moe/ }))
    const healthRecords = await screen.findByRole('article', { name: 'Health Records' })
    expect(await within(healthRecords).findByText('Shared patient-reported reading')).toBeInTheDocument()
    expect(within(healthRecords).queryByText('Blood Pressure Monitoring')).not.toBeInTheDocument()
  })

  it('shows no-permission states without leaking hidden clinical details or counts', async () => {
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: { records: true, appointments: true, medications: true, alerts: true }, sections: lockedSections }
      : { member: mother, isSelf: false, permissions: { records: false, appointments: false, medications: false, alerts: false }, sections: {
        ...lockedSections,
        medications: { status: 'not_authorized', data: [{ id: 'hidden', medication_name: 'PRIVATE MEDICATION' }] },
      } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('Health information has not been shared with you.')).toBeInTheDocument()
    const accessSummary = screen.getByRole('region', { name: 'Shared information for Mother' })
    expect(within(accessSummary).getAllByText('Medications').length).toBeGreaterThan(0)
    expect(within(accessSummary).getAllByText('Not shared').length).toBeGreaterThan(0)
    expect(screen.queryByText('PRIVATE MEDICATION')).not.toBeInTheDocument()
    expect(screen.queryByText(/hidden|\d+ medications/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Manage Care Circle' }).every(link => link.getAttribute('href') === '/family')).toBe(true)
    expect(screen.queryByText('Care Plan access not shared')).not.toBeInTheDocument()
    expect(screen.queryByText('No current care actions.')).not.toBeInTheDocument()
  })

  it('shows an authorized family Care Plan as read-only inside Family Health', async () => {
    const familyPlan = {
      plan: { id: 'plan-internal', current_version_id: 'version-internal', status: 'active', timezone: 'Asia/Yangon', starts_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
      versions: [{ id: 'version-internal', version_no: 2, title: 'Recovery Care Plan', instructions: 'Follow the clinician instructions.' }],
      goals: [{ id: 'goal-internal', title: 'Build a regular routine' }],
      tasks: [{ id: 'task-internal', task_type: 'activity', title: 'Gentle movement', instructions: 'Walk as directed.', manual_acknowledgement: true }],
      progress: { today: { state: 'tasks_due', completed: 2, total: 4 } },
      occurrences: [{ id: 'occurrence-internal', task_id: 'task-internal', scheduled_at: new Date(Date.now() - 60000).toISOString(), local_due_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), timezone: 'Asia/Yangon', status: 'pending', required: true, completed: false }],
    }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: { records: true, appointments: true, medications: true, alerts: true }, sections: { ...lockedSections, carePlan: { status: 'self', data: { self: true } } } }
      : { member: mother, isSelf: false, permissions: { care_plans: true }, sections: { ...lockedSections, carePlan: { status: 'ready', data: [familyPlan] } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'View Care Plan for Mother' }))[0])
    expect(await screen.findByRole('heading', { name: 'Recovery Care Plan' })).toBeInTheDocument()
    expect(screen.getByText(/2 of 4 completed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as done|Complete|Taken|Activate|Pause|Reconcile/i })).not.toBeInTheDocument()
    expect(screen.getByText('Today’s Care')).toBeInTheDocument()
    expect(screen.getByText('Actions remaining')).toBeInTheDocument()
    expect(screen.queryByText(/plan-internal|task-internal|occurrence-internal/)).not.toBeInTheDocument()
    expect(familyHealthService.loadHealth.mock.calls.some(([input]) => input.memberId === 'mother-member' && !('patientId' in input))).toBe(true)
  })

  it('distinguishes an authorized no-plan result and keeps Self on the patient route', async () => {
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: {}, sections: { ...lockedSections, carePlan: { status: 'self', data: { self: true } } } }
      : { member: mother, isSelf: false, permissions: { care_plans: true }, sections: { ...lockedSections, carePlan: { status: 'ready', data: [] }, patientCarePlan: { status: 'ready', data: { health_goals: [], medications: [], monitoring_plans: [], lifestyle_plans: [], appointments: [], access: { medications: true, appointments: true, records: false } } } } })
    renderPage()
    expect(screen.getByRole('link', { name: 'Open My Care Plan' })).toHaveAttribute('href', '/my-care-plan')
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('No current care plan information has been shared.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Home Care|pricing/i })).not.toBeInTheDocument()
  })

  it('shows selected member patient-owned care-plan data read-only and never renders viewer data', async () => {
    const ownPlan = { health_goals: [{ id: 'goal-m', title: 'Walk every day', is_completed: false }], medications: [{ id: 'med-m', source: 'prescribed', status: 'active', medication_name: 'Member medicine', dose: '1 tablet', frequency: 'Once daily', today_check_ins: [{ status: 'taken', occurrence_index: 1 }], medication_schedules: [] }], monitoring_plans: [], lifestyle_plans: [], appointments: [], access: { medications: true, appointments: true, records: false }, as_of_date: '2026-10-13' }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: {}, sections: lockedSections }
      : { member: mother, permissions: { care_plans: true }, sections: { ...lockedSections, carePlan: { status: 'ready', data: [] }, patientCarePlan: { status: 'ready', data: ownPlan } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'View Care Plan for Mother' }))
    expect(await screen.findByText('Member medicine')).toBeInTheDocument()
    expect(screen.getByText('Walk every day')).toBeInTheDocument()
    expect(screen.queryByText('Nandar’s private goal')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'My Health Goals' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add Goal|Delete Goal|Done|Reopen|Check in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open My Care Plan' })).not.toBeInTheDocument()
  })

  it('keeps multiple active family plans separate', async () => {
    const plan = (id, title, completed) => ({
      plan: { id, current_version_id: `${id}-version`, status: 'active', timezone: 'Asia/Yangon', starts_at: '2026-01-01T00:00:00Z' },
      versions: [{ id: `${id}-version`, version_no: 1, title }], goals: [], tasks: [], occurrences: [],
      progress: { today: { state: 'tasks_due', completed, total: 2 } },
    })
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: {}, sections: lockedSections }
      : { member: mother, isSelf: false, permissions: { care_plans: true }, sections: { ...lockedSections, carePlan: { status: 'ready', data: [plan('one', 'Recovery Plan', 1), plan('two', 'Mobility Plan', 2)] } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'View Care Plan for Mother' }))[0])
    expect(await screen.findByRole('heading', { name: 'Recovery Plan' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mobility Plan' })).toBeInTheDocument()
    expect(screen.getAllByText('Today’s Care')).toHaveLength(2)
  })

  it('clears expanded shared plan details when switching members and blocks details without permission', async () => {
    const memberRows = [mother, { ...mother, member_id: 'sister-member', patient_id: 'sister-patient', display_name: 'Sister' }]
    familyHealthService.getMembers.mockResolvedValue([members[0], ...memberRows])
    const sharedPlan = { plan: { id: 'shared-plan', current_version_id: 'shared-version', status: 'active' }, versions: [{ id: 'shared-version', title: 'Mother shared plan' }], tasks: [], goals: [], occurrences: [] }
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: members[0], permissions: {}, sections: lockedSections }
      : input.memberId === 'mother-member'
        ? { member: mother, permissions: { care_plans: true }, sections: { ...lockedSections, carePlan: { status: 'ready', data: [sharedPlan] } } }
        : { member: memberRows[1], permissions: { care_plans: false }, sections: { ...lockedSections, carePlan: { status: 'not_authorized', data: null } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'View Care Plan for Mother' }))
    expect(await screen.findByRole('heading', { name: 'Mother shared plan' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sister/ }))
    expect(await screen.findByText('This family member has not shared their Care Plan with you.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mother shared plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View Care Plan for Sister/ })).not.toBeInTheDocument()
  })

  it('isolates load errors while rendering other authorized sections', async () => {
    familyHealthService.loadHealth.mockResolvedValue({
      member: mother, isSelf: false, permissions: { records: true, appointments: false, medications: true },
      sections: { ...lockedSections, records: { status: 'error', data: null }, medications: { status: 'ready', data: [{ id: 'med', medication_name: 'Shared medication', status: 'active' }] } },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('Health records are temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Shared medication')).toBeInTheDocument()
  })

  it('hides the prior account family data immediately on account switch and logout', async () => {
    familyHealthService.loadHealth.mockImplementation(async input => input.selfPatient
      ? { member: { display_name: 'Nandar' }, isSelf: true, permissions: {}, sections: lockedSections }
      : { member: mother, isSelf: false, permissions: { medications: true }, sections: { ...lockedSections, medications: { status: 'ready', data: [{ id: 'med', medication_name: 'PRIVATE MOTHER MEDICATION', status: 'active' }] } } })
    const page = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Mother/ }))
    expect(await screen.findByText('PRIVATE MOTHER MEDICATION')).toBeInTheDocument()
    auth.user = { id: 'mother-own-profile' }
    auth.patient = { id: 'mother-own-patient', full_name: 'Mother', date_of_birth: '1970-01-01' }
    page.rerender(<MemoryRouter><FamilyHealthPage /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByText('PRIVATE MOTHER MEDICATION')).not.toBeInTheDocument())
    auth.user = null
    auth.patient = null
    page.rerender(<MemoryRouter><FamilyHealthPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in with an EasyCare patient account')
    expect(screen.queryByText('PRIVATE MOTHER MEDICATION')).not.toBeInTheDocument()
  })

  it('keeps family management adult-only and does not call family APIs for a minor', () => {
    auth.patient = { id: 'minor', full_name: 'Minor', date_of_birth: '2015-01-01' }
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Family Health is available to active accounts aged 18 or older')
    expect(familyHealthService.getGroups).not.toHaveBeenCalled()
    expect(familyHealthService.loadHealth).not.toHaveBeenCalled()
  })
})

it.each([['father','Wife','Shwe Hnin San'],['mother','Husband','Kyaw Aung Moe']])('shared-care card and header use the same parent-pair label for %s',async (viewer,label,targetName)=>{
  auth.patient={id:viewer,full_name:viewer==='father'?'Kyaw Aung Moe':'Shwe Hnin San',date_of_birth:'1990-01-01'}
  const rows=withViewerRelationships([
    {member_id:'owner',patient_id:'owner',display_name:'Nandar',role:'owner',relationship:'self'},
    {member_id:'father',patient_id:'father',display_name:'Kyaw Aung Moe',role:'member',relationship:'father',is_self:viewer==='father'},
    {member_id:'mother',patient_id:'mother',display_name:'Shwe Hnin San',role:'member',relationship:'mother',is_self:viewer==='mother'},
  ],{groupId:group.id})
  familyHealthService.getMembers.mockResolvedValue(rows)
  familyHealthService.loadHealth.mockImplementation(async input=>({member:input.selfPatient?rows.find(row=>row.is_self):rows.find(row=>row.member_id===input.memberId),permissions:{},sections:lockedSections}))
  renderPage()
  const target=await screen.findByRole('button',{name:new RegExp(targetName)})
  expect(within(target).getByText(label)).toBeInTheDocument()
  fireEvent.click(target)
  expect(await screen.findByRole('heading',{name:targetName})).toBeInTheDocument()
})

it('shows the isolated Shwe Hnin San sample only for her selected membership when no real upcoming appointment exists', async () => {
  auth.patient = { id: 'nandar', full_name: 'Nandar Kyaw', date_of_birth: '1990-01-01' }
  const rows = [
    { member_id: 'nandar-member', patient_id: 'nandar', display_name: 'Nandar Kyaw', role: 'owner', relationship: 'self', is_self: true },
    { member_id: 'shwe-member', patient_id: 'shwe-patient', display_name: 'Shwe Hnin San', role: 'mother', relationship: 'mother' },
    { member_id: 'eaindray-member', patient_id: 'eaindray-patient', display_name: 'Eaindray Kyaw', role: 'member', relationship: 'sibling' },
    { member_id: 'kyaw-member', patient_id: 'kyaw-patient', display_name: 'Kyaw Aung Moe', role: 'member', relationship: 'father' },
    { member_id: 'unrelated-member', patient_id: 'other-patient', display_name: 'Unrelated Member', role: 'member', relationship: 'friend' },
  ]
  familyHealthService.getMembers.mockResolvedValue(rows)
  familyHealthService.loadHealth.mockImplementation(async input => {
    const member = input.selfPatient ? rows[0] : rows.find(row => row.member_id === input.memberId)
    const legacyProjection = input.memberId === 'shwe-member' ? [{ id: 'legacy-incomplete', provider_id: 'provider-legacy', appointment_type: 'teleconsultation', consultation_channel: 'video', scheduled_start: '2026-10-20T02:30:00Z', status: 'pending' }] : []
    return { member, permissions: { appointments: true }, sections: { appointments: { status: 'ready', data: legacyProjection } } }
  })
  renderPage()
  await screen.findByRole('button', { name: /Shwe Hnin San/ })
  expect(screen.queryByText('Dr. Su Myat Noe')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: /Shwe Hnin San/ }))
  expect(await screen.findByText('Dr. Su Myat Noe')).toBeInTheDocument()
  expect(screen.getByText('Pediatrics')).toBeInTheDocument()
  expect(screen.getByLabelText('Rating 4.9 out of 5')).toHaveTextContent('4.9')
  expect(screen.getByText('Tue, Oct 20, 2026 · 09:00 AM (Asia/Yangon)')).toBeInTheDocument()
  expect(screen.getByText('Video consultation')).toBeInTheDocument()
  expect(screen.getByText('Pending')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Join Consultation' })).toHaveAttribute('href', '/consultations/b60ae0e4-1405-4430-ba33-7603cf87ff0a')
  const appointmentCard = screen.getByRole('article', { name: 'Appointments' })
  expect(within(appointmentCard).queryByText('Provider details unavailable')).not.toBeInTheDocument()
  expect(within(appointmentCard).queryByText('Not recorded')).not.toBeInTheDocument()
  expect(within(appointmentCard).queryByText('legacy-incomplete')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View Appointment' }))
  expect(appointmentCard.querySelector('.family-appointment-detail')).toHaveTextContent('Rating: 4.9')

  for (const name of ['Eaindray Kyaw', 'Kyaw Aung Moe', 'Unrelated Member']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    if (name === 'Kyaw Aung Moe') expect(await screen.findByText('Dr. Ei Mon Hlaing')).toBeInTheDocument()
    else expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument()
    expect(screen.queryByText('Dr. Su Myat Noe')).not.toBeInTheDocument()
    if (name !== 'Kyaw Aung Moe') expect(screen.queryByText('Dr. Ei Mon Hlaing')).not.toBeInTheDocument()
  }
})

it('shows the isolated Kyaw Aung Moe sample for the father membership despite incomplete rows', async () => {
  auth.patient = { id: 'nandar', full_name: 'Nandar Kyaw', date_of_birth: '1990-01-01' }
  const rows = [
    { member_id: 'nandar-member', patient_id: 'nandar', display_name: 'Nandar Kyaw', role: 'owner', relationship: 'self', is_self: true },
    { member_id: 'kyaw-member', patient_id: 'kyaw-patient', display_name: 'Kyaw Aung Moe', role: 'member', relationship: 'father' },
    { member_id: 'eaindray-member', patient_id: 'eaindray-patient', display_name: 'Eaindray Kyaw', role: 'member', relationship: 'sibling' },
    { member_id: 'unrelated-member', patient_id: 'other-patient', display_name: 'Unrelated Member', role: 'member', relationship: 'friend' },
  ]
  familyHealthService.getMembers.mockResolvedValue(rows)
  familyHealthService.loadHealth.mockImplementation(async input => {
    const member = input.selfPatient ? rows[0] : rows.find(row => row.member_id === input.memberId)
    const incompleteRow = input.memberId === 'kyaw-member' ? [{ id: 'kyaw-incomplete', providerId: 'missing-provider', status: 'pending' }] : []
    return { member, permissions: { appointments: true }, sections: { appointments: { status: 'ready', data: incompleteRow } } }
  })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Kyaw Aung Moe/ }))
  expect(await screen.findByText('Dr. Ei Mon Hlaing')).toBeInTheDocument()
  expect(screen.getByText('Dermatology')).toBeInTheDocument()
  expect(screen.getByLabelText('Rating 4.7 out of 5')).toHaveTextContent('4.7')
  expect(screen.getByText('Tue, Oct 20, 2026 · 11:00 AM (Asia/Yangon)')).toBeInTheDocument()
  expect(screen.getByText('Video consultation')).toBeInTheDocument()
  expect(screen.getByText('Pending')).toBeInTheDocument()
  expect(screen.getByText('Fee: 0 MMK')).toBeInTheDocument()
  expect(screen.getByText('Reference: MBA-3667FFB290')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Join Consultation' })).toHaveAttribute('href', '/consultations/e4195430-d6bb-475b-bd3b-354d7439a995')
  expect(screen.queryByText('Provider details unavailable')).not.toBeInTheDocument()
  expect(screen.queryByText('kyaw-incomplete')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View Details' }))
  expect(screen.getByRole('button', { name: 'Hide Details' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByText(/MBA-3667FFB290/)).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: /Eaindray Kyaw/ }))
  expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument()
  expect(screen.queryByText('Dr. Ei Mon Hlaing')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Unrelated Member/ }))
  expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument()
  expect(screen.queryByText('Dr. Ei Mon Hlaing')).not.toBeInTheDocument()
})

it('prefers Kyaw Aung Moe complete real appointments over his presentation sample', async () => {
  auth.patient = { id: 'nandar', full_name: 'Nandar Kyaw', date_of_birth: '1990-01-01' }
  const self = { member_id: 'nandar-member', patient_id: 'nandar', display_name: 'Nandar Kyaw', is_self: true, role: 'owner', relationship: 'self' }
  const father = { member_id: 'kyaw-member', patient_id: 'kyaw-patient', display_name: 'Kyaw Aung Moe', role: 'member', relationship: 'father' }
  familyHealthService.getMembers.mockResolvedValue([self, father])
  familyHealthService.loadHealth.mockImplementation(async input => ({ member: input.selfPatient ? self : father, permissions: { appointments: true }, sections: { appointments: { status: 'ready', data: input.selfPatient ? [] : [{ id: 'kyaw-real-appt', providerId: 'real-provider', appointmentType: 'teleconsultation', consultationChannel: 'video', scheduledAt: '2026-10-22T04:30:00Z', status: 'confirmed' }] } } }))
  providerRepo.getDoctor.mockResolvedValue({ displayName: 'Dr. Real Provider', specialty: 'Cardiology' })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Kyaw Aung Moe/ }))
  expect(await screen.findByText('Dr. Real Provider')).toBeInTheDocument()
  expect(screen.queryByText('Dr. Ei Mon Hlaing')).not.toBeInTheDocument()
  expect(screen.queryByText('MBA-3667FFB290')).not.toBeInTheDocument()
})

it('prefers a real authorized Shwe Hnin San appointment over the presentation sample', async () => {
  auth.patient = { id: 'nandar', full_name: 'Nandar Kyaw', date_of_birth: '1990-01-01' }
  const self = { member_id: 'nandar-member', patient_id: 'nandar', display_name: 'Nandar Kyaw', is_self: true, role: 'owner', relationship: 'self' }
  const mother = { member_id: 'shwe-member', patient_id: 'shwe-patient', display_name: 'Shwe Hnin San', role: 'mother', relationship: 'mother' }
  familyHealthService.getMembers.mockResolvedValue([self, mother])
  familyHealthService.loadHealth.mockImplementation(async input => ({ member: input.selfPatient ? self : mother, permissions: { appointments: true }, sections: { appointments: { status: 'ready', data: input.selfPatient ? [] : [{ id: 'real-appt', providerId: 'real-provider', appointmentType: 'teleconsultation', consultationChannel: 'video', scheduledAt: '2026-10-22T02:30:00Z', status: 'confirmed' }] } } }))
  providerRepo.getDoctor.mockResolvedValue({ displayName: 'Dr. Real Provider', specialty: 'Cardiology' })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Shwe Hnin San/ }))
  expect(await screen.findByText('Dr. Real Provider')).toBeInTheDocument()
  expect(screen.queryByText('Dr. Su Myat Noe')).not.toBeInTheDocument()
})
