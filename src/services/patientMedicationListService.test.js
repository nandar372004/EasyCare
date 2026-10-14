import { describe, expect, it, vi } from 'vitest'
import { loadPatientMedicationList, activePatientMedications } from './patientMedicationListService.js'


const clinical = [{ id: 'a', name: 'Clinical A', dosage: '1 tablet', frequency: 'three times daily', status: 'active', source: 'Existing origin', schedules: [] }, { id: 'past', name: 'Past', status: 'stopped' }]
const reported = { items: [{ id: 'b', itemType: 'medication', entryKind: 'item', source: 'patient_reported', name: 'Reported B', details: { dose: '2 tablets', frequency: 'daily' } }, { id: 'not-med', itemType: 'condition' }] }
describe('shared Medications tab active contract', () => {
  it('preserves clinical and reported origins and applies the same active filter', async () => {
    const repository = { metadata: { isSynthetic: false }, listMedications: vi.fn().mockResolvedValue(clinical) }
    const intake = vi.fn().mockResolvedValue(reported)
    const list = await loadPatientMedicationList('patient', repository, intake)
    const active = activePatientMedications(list)
    expect(active.map(row => row.name)).toEqual(['Clinical A','Reported B'])
    expect(active[0].source).toBe('Existing origin')
    expect(active[1]).toMatchObject({ id: 'reported:b', dosage: '2 tablets', isPatientReported: true, source: 'Patient-reported' })
    expect(repository.listMedications).toHaveBeenCalledTimes(1)
    expect(intake).toHaveBeenCalledTimes(1)

  })
})
