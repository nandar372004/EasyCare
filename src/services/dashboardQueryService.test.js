import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { createDashboardQueryResources, projectFamilyOwnAlerts, projectFamilyOwnMedications } from './dashboardQueryService.js'
vi.mock('./patientReportedHealthService.js', () => ({ getMyReportedHealthIntake: vi.fn().mockResolvedValue({ items: [] }) }))

it('preserves command-center clinical-only membership, date ordering, limits, and alert metadata', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: `m${index}`, name: `Medication ${index}`, dosage: 'Recorded dose', status: 'active', startDate: `2026-10-${String(index + 1).padStart(2,'0')}`, endDate: '2026-09-01', schedules: [{ id: 's', timeOfDay: '09:30' }] }))
  const result = projectFamilyOwnMedications([...rows, { id: 'past', status: 'stopped' }])
  expect(result).toHaveLength(20)
  expect(result[0]).toMatchObject({ id: 'm24', medication_name: 'Medication 24', end_date: '2026-09-01', medication_schedules: [{ id: 's', time_of_day: '09:30' }] })
  const alerts = projectFamilyOwnAlerts(Array.from({ length: 12 }, (_, index) => ({ id: `a${index}`, status: 'escalated', severity: 'source severity', detectedAt: '2026-10-12T00:00:00Z' })))
  expect(alerts).toHaveLength(10)
  expect(alerts[0]).toMatchObject({ status: 'escalated', severity: 'source severity', detected_at: '2026-10-12T00:00:00Z' })
})
describe('request-scoped shared self sources', () => {
  it('uses one clinical, alert and appointment read for Dashboard plus family and preserves next-appointment rules', async () => {
    const client = new QueryClient()
    const nextTime = new Date(Date.now() + 86400000).toISOString()
    const medRepo = { metadata: { isSynthetic: false }, listMedications: vi.fn().mockResolvedValue([{ id: 'clinical', name: 'Clinical', status: 'active' }, { id: 'past', status: 'stopped' }]) }
    const familyRepo = { getCommandAppointments: vi.fn().mockResolvedValue([{ id: 'rescheduled', status: 'rescheduled', scheduledStart: new Date(Date.now()+10000).toISOString() }, { id: 'next', status: 'confirmed', scheduledStart: nextTime, providerId: 'doctor' }, { id: 'old', status: 'pending', scheduledStart: '2000-01-01T00:00:00Z' }]) }
    const repo = { getActiveAlerts: vi.fn().mockResolvedValue([{ id: 'alert', status: 'open', detectedAt: '2026-10-12' }]), getDashboardAppointmentProvider: vi.fn().mockResolvedValue({ displayName: 'Recorded doctor' }), getTodayMedications: vi.fn().mockResolvedValue([]), getTodayMedicationCheckIns: vi.fn().mockResolvedValue([]) }
    const resources = createDashboardQueryResources({ queryClient: client, patient: { id: 'owner' }, viewerId: 'viewer', day: '2026-10-12', repository: repo, familyRepository: familyRepo, medicationRepository: medRepo })
    const [medication, appointment, , familyMeds, familyAlerts, familyAppointments] = await Promise.all([resources.tasks.medications(), resources.tasks.appointment(), resources.tasks.alerts(), resources.sharedOwnSections.medications(), resources.sharedOwnSections.alerts(), resources.sharedOwnSections.appointments()])
    expect(medication.medications.map(row => row.id)).toEqual(['clinical'])
    expect(familyMeds.map(row => row.id)).toEqual(['clinical'])
    expect(appointment.next.id).toBe('next')
    expect(appointment.doctor.displayName).toBe('Recorded doctor')
    expect(familyAppointments).toHaveLength(3)
    expect(familyAlerts[0].detected_at).toBe('2026-10-12')
    expect(medRepo.listMedications).toHaveBeenCalledTimes(1)
    expect(repo.getActiveAlerts).toHaveBeenCalledTimes(1)
    expect(familyRepo.getCommandAppointments).toHaveBeenCalledTimes(1)
    client.clear()
  })
})

it('retains the original family medication visibility contract when sharing the tab read', () => {
  const original = [{ id: 'original', medication_name: 'Original family row', dose: 'Recorded dose', status: 'active', medication_schedules: [{ id: 's', time_of_day: '10:00' }] }]
  expect(projectFamilyOwnMedications([], original)).toEqual([{ id: 'original', medication_name: 'Original family row', dose: 'Recorded dose', instructions: undefined, status: 'active', start_date: undefined, end_date: undefined, medication_schedules: [{ id: 's', time_of_day: '10:00', days_of_week: undefined, timezone: undefined, valid_from: undefined, valid_until: undefined }] }])
})
