import { describe, expect, it, vi } from 'vitest'
import { buildCarePlanMedicationRows, loadCarePlanMedications, medicationCheckinOccurrences, medicationDoseTime, summarizeCarePlanMedicationActions } from './carePlanMedicationService.js'

const id = '81000000-0000-4000-8000-000000000010'
const medication = { id, name: 'Tracked clinical medicine', dosage: 'Recorded dose', frequency: 'three times daily', status: 'active', schedules: [], todaySchedules: [] }
const now = new Date('2026-10-12T05:00:00Z')
const data = () => ({ medications: [medication], checkIns: [{ id: 'c1', patientMedicationId: id, occurrenceIndex: 1, isPrn: false, status: 'taken' }, { id: 'c3', patientMedicationId: id, occurrenceIndex: 3, isPrn: false, status: 'taken' }], checkInsAvailable: true })
describe('My Care Plan shared medication contract', () => {
  it('retains the exact loader contract and tolerates optional source failures', async () => {
    const repository = { metadata: { isSynthetic: false }, listMedications: vi.fn().mockResolvedValue([medication, { id: 'past', status: 'stopped' }]) }
    const todayLoader = vi.fn().mockRejectedValue(new Error('Optional schedule error'))
    const checkInsLoader = vi.fn().mockResolvedValue(data().checkIns)
    const reportedLoader = vi.fn().mockRejectedValue(new Error('Optional reported error'))
    const result = await loadCarePlanMedications('patient', { repository, todayLoader, checkInsLoader, reportedLoader })
    expect(result).toEqual({ medications: [medication], checkIns: data().checkIns, checkInsAvailable: true })
    expect(repository.listMedications).toHaveBeenCalledTimes(1)
    expect(todayLoader).toHaveBeenCalledWith('patient', [medication])
    expect(checkInsLoader).toHaveBeenCalledTimes(1)
  })
  it('generates the same daily occurrence identities and respects removed/reverted check-ins', () => {
    const result = summarizeCarePlanMedicationActions(data(), now)
    expect(result.required).toBe(3)
    expect(result.done).toBe(2)
    expect(result.actions.map(row => [row.occurrenceIndex, row.completed])).toEqual([[1,true],[2,false],[3,true]])
    expect(medicationCheckinOccurrences(medication, data().checkIns).occurrences.map(row => row.index)).toEqual(result.actions.map(row => row.occurrenceIndex))
    const reverted = data(); reverted.checkIns = reverted.checkIns.filter(row => row.occurrenceIndex !== 1)
    expect(summarizeCarePlanMedicationActions(reverted, now).actions[0].completed).toBe(false)
    expect(summarizeCarePlanMedicationActions(reverted, now).done).toBe(1)
  })
  it('uses scheduled event states rather than frequency check-ins and preserves separate scheduled occurrences', () => {
    const scheduled = { ...medication, schedules: [{ id: 's1' }, { id: 's2' }], todaySchedules: [
      { schedule: { id: 's1', timeOfDay: '08:00' }, events: [{ id: 'e1', status: 'taken', scheduledAt: '2026-10-12T01:30:00Z' }] },
      { schedule: { id: 's2', timeOfDay: '20:00' }, events: [{ id: 'e2', status: 'pending', scheduledAt: '2026-10-12T13:30:00Z' }] },
    ] }
    const source = { ...data(), medications: [scheduled] }
    const expectedRows = buildCarePlanMedicationRows(source, now)
    const result = summarizeCarePlanMedicationActions(source, now)
    expect(result).toMatchObject({ required: 2, done: 1 })
    expect(result.rows).toEqual(expectedRows)
    expect(result.actions.find(row => row.event.id === 'e2')).toMatchObject({ completed: false, occurrenceIndex: 2, status: 'Upcoming' })
    scheduled.todaySchedules[0].events[0].status = 'pending'
    expect(summarizeCarePlanMedicationActions(source, now).done).toBe(0)
  })
  it('shares the exact PRN rule and excludes those occurrences from required completion', () => {
    const prn = { ...medication, frequency: 'PRN / as needed' }
    const source = { medications: [prn], checkInsAvailable: true, checkIns: [{ patientMedicationId: id, occurrenceIndex: 1, isPrn: true, status: 'taken' }] }
    expect(medicationCheckinOccurrences(prn, source.checkIns).occurrences).toEqual([{ index: null, completed: true }])
    const result = summarizeCarePlanMedicationActions(source, now)
    expect(result).toMatchObject({ required: 0, done: 0 })
    expect(result.actions[0]).toMatchObject({ prn: true, required: false })
  })
  it('does not generate daily actions for reported-only, unsupported, or off-schedule entries', () => {
    const source = { medications: [
      { ...medication, id: 'reported:r', isPatientReported: true },
      { ...medication, id: '81000000-0000-4000-8000-000000000012', schedules: [{ id: 'off-day' }] },
      { ...medication, id: '81000000-0000-4000-8000-000000000013', frequency: 'Weekly' },
    ], checkIns: [], checkInsAvailable: true }
    expect(buildCarePlanMedicationRows(source, now)).toHaveLength(3)
    expect(summarizeCarePlanMedicationActions(source, now)).toMatchObject({ rows: [], actions: [], required: 0, done: 0 })
  })
  it('retains check-in availability instead of fabricating a Not done state', () => {
    const result = summarizeCarePlanMedicationActions({ ...data(), checkIns: [], checkInsAvailable: false }, now)
    expect(result.incompleteTracking).toBe(true)
    expect(result.actions.every(row => !row.trackingAvailable)).toBe(true)
  })
})


it('shares the My Care Plan time display and prefers actual event time over the schedule clock', () => {
  expect(medicationDoseTime({ schedule: { timeOfDay: '08:00', timezone: 'Asia/Yangon' }, event: { scheduledAt: '2026-10-12T05:00:00Z' } })).toBe('11:30 AM')
  expect(medicationDoseTime({ schedule: { timeOfDay: '08:00', timezone: 'Asia/Yangon' } })).toBe('8:00 AM')
  expect(medicationDoseTime({})).toBeNull()
})
