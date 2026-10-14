import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPatientMedicationList } from './patientMedicationListService.js'
vi.mock('./patientMedicationListService.js', () => ({ loadPatientMedicationList: vi.fn().mockResolvedValue([]), activePatientMedications: rows => rows.filter(row => row.status === 'active') }))
import { loadCarePlanMedications } from './carePlanMedicationService.js'
vi.mock('./carePlanMedicationService.js', () => ({ loadCarePlanMedications: vi.fn().mockResolvedValue({ medications: [], checkIns: [], checkInsAvailable: true }) }))
beforeEach(() => vi.clearAllMocks())
import { loadDashboardPage } from './dashboardPageService.js'
function repository() {
  return Object.fromEntries(['getDashboardOverview', 'getLatestVitals', 'getActiveAlerts', 'getRecentHealthRecords', 'getRecentLabResults', 'getRecentPrescriptions', 'getNextAppointment', 'getDashboardAppointmentProvider', 'getMedicationDashboardData', 'getActiveCarePlans'].map(name => [name, vi.fn().mockResolvedValue([])]))
}
describe('dashboard section loading', () => {
  it('scopes each health call to the authorized patient and never requests appointment events', async () => {
    const repo = repository()
    repo.getNextAppointment.mockResolvedValue({ id: 'a', providerId: 'provider' })
    repo.getDashboardAppointmentProvider.mockRejectedValue(new Error('unavailable'))
    loadCarePlanMedications.mockRejectedValueOnce(new Error('denied'))
    repo.listAppointmentEvents = vi.fn(() => { throw new Error('Missing table') })
    const rows = await loadDashboardPage('patient', repo)
    expect(rows.overview.status).toBe('ready')
    expect(rows.medications.status).toBe('error')
    expect(rows.appointment.data).toMatchObject({ next: { id: 'a' }, doctor: null, providerError: true })
    for (const [name, method] of Object.entries(repo)) if (!['getDashboardAppointmentProvider', 'listAppointmentEvents', 'getMedicationDashboardData', 'getActiveCarePlans'].includes(name)) expect(method).toHaveBeenCalledWith('patient')
    expect(repo.getActiveCarePlans).not.toHaveBeenCalled()
    expect(repo.getDashboardAppointmentProvider).toHaveBeenCalledWith('provider')
    expect(repo.getMedicationDashboardData).not.toHaveBeenCalled()

    expect(loadCarePlanMedications).toHaveBeenCalledWith('patient')
    expect(loadPatientMedicationList).not.toHaveBeenCalled()
    expect(repo.listAppointmentEvents).not.toHaveBeenCalled()
  })
  it.each(['getLatestVitals', 'getActiveAlerts', 'getRecentHealthRecords', 'getRecentLabResults'])('isolates %s errors and preserves other sections', async name => {
    const repo = repository(); repo.getNextAppointment.mockResolvedValue(null)
    repo[name].mockRejectedValue(new Error('denied'))
    const result = await loadDashboardPage('patient', repo)
    expect(Object.values(result).filter(section => section.status === 'error')).toHaveLength(1)
    expect(result.medications.status).toBe('ready')
    expect(result.appointment.data.next).toBeNull()
  })
  it('isolates synchronous failures as well as rejected queries', async () => {
    const repo = repository(); repo.getNextAppointment.mockResolvedValue(null)
    repo.getRecentLabResults.mockImplementation(() => { throw new Error('unavailable') })
    expect((await loadDashboardPage('patient', repo)).labs.status).toBe('error')
  })
  it('publishes completed sections without waiting for a slower section', async () => {
    const repo = repository()
    let finishOverview
    repo.getDashboardOverview.mockReturnValue(new Promise(resolve => { finishOverview = resolve }))
    const completed = []
    const loading = loadDashboardPage('patient', repo, name => completed.push(name))
    await vi.waitFor(() => expect(completed).toContain('vitals'))
    expect(completed).not.toContain('overview')
    finishOverview({ profile: {} })
    await loading
    expect(completed).toContain('overview')
  })
})
