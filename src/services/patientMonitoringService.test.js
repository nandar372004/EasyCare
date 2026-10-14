import { describe, expect, it, vi } from 'vitest'
import { analyzeMonitoringReadings, buildMonitoringWeeklySummaries, createPatientMonitoringService, isScheduledOn } from './patientMonitoringService.js'

const repository = () => ({ listMyPlans: vi.fn(), listMyCheckIns: vi.fn(), saveMyPlan: vi.fn(), deactivateMyPlan: vi.fn(), recordMyCheckIn: vi.fn(), recordMyMeasurement: vi.fn() })

describe('patient monitoring schedule behavior', () => {
  it('generates daily, selected weekday, one-time, and next-day occurrences from dates', () => {
    const daily = { isActive: true, recurrenceType: 'daily', startDate: '2026-10-12', endDate: null }
    const weekdays = { ...daily, recurrenceType: 'selected_days', daysOfWeek: [1, 3, 5] }
    const oneTime = { ...daily, recurrenceType: 'once' }
    expect(isScheduledOn(daily, '2026-10-13')).toBe(true)
    expect(isScheduledOn(weekdays, '2026-10-12')).toBe(true)
    expect(isScheduledOn(weekdays, '2026-10-13')).toBe(false)
    expect(isScheduledOn(oneTime, '2026-10-12')).toBe(true)
    expect(isScheduledOn(oneTime, '2026-10-13')).toBe(false)
    expect(isScheduledOn({ ...daily, endDate: '2026-10-12' }, '2026-10-13')).toBe(false)
    expect(isScheduledOn({ ...daily, isActive: false }, '2026-10-12')).toBe(false)
  })

  it('validates routine text, recurrence, dates, and optional multiple times', async () => {
    const repo = repository(); repo.saveMyPlan.mockResolvedValue({ id: 'plan-1' })
    const service = createPatientMonitoringService(repo)
    const result = await service.saveMyPlan({ title: '  Measure blood pressure ', recurrenceType: 'selected_days', daysOfWeek: [1, 3, 5], startDate: '2026-10-12', times: ['18:00', '09:00', '09:00'] })
    expect(result).toEqual({ id: 'plan-1' })
    expect(repo.saveMyPlan).toHaveBeenCalledWith(expect.objectContaining({ title: 'Measure blood pressure', daysOfWeek: [1, 3, 5], times: ['09:00', '18:00'] }))
    expect(() => service.saveMyPlan({ title: 'Walk', recurrenceType: 'selected_days', daysOfWeek: [], startDate: '2026-10-12' })).toThrow(/schedule/i)
    expect(() => service.saveMyPlan({ title: 'Walk', recurrenceType: 'daily', startDate: '2026-10-13', endDate: '2026-10-12' })).toThrow(/End date/i)
  })

  it('validates metric definitions and numeric occurrence values', async () => {
    const repo = repository(); const service = createPatientMonitoringService(repo)
    await service.saveMyPlan({ title: 'Blood Pressure', recurrenceType: 'selected_days', daysOfWeek: [1,3,5], startDate: '2026-10-12', measurementType: 'blood_pressure', measurementUnit: 'mmHg' })
    expect(repo.saveMyPlan).toHaveBeenCalledWith(expect.objectContaining({ measurementType: 'blood_pressure', measurementUnit: 'mmHg' }))
    expect(() => service.saveMyPlan({ title: 'Blood Pressure', recurrenceType: 'daily', startDate: '2026-10-12', measurementType: 'blood_pressure', measurementUnit: 'kg' })).toThrow(/unit/i)
    await service.recordMyMeasurement({ planId: '81000000-0000-4000-8000-000000000001', localDate: '2026-10-12', occurrenceKey: 'any', measurementType: 'blood_pressure', systolicValue: '125', diastolicValue: '80', measurementUnit: 'mmHg' })
    expect(repo.recordMyMeasurement).toHaveBeenCalledOnce()
    expect(() => service.recordMyMeasurement({ planId: '81000000-0000-4000-8000-000000000001', localDate: '2026-10-12', occurrenceKey: 'any', measurementType: 'blood_pressure', systolicValue: '', diastolicValue: '80', measurementUnit: 'mmHg' })).toThrow(/systolic/i)
  })

  it('returns separate date-scoped BP series and descriptive weekly summaries', () => {
    const plan = { id: 'bp', title: 'Blood Pressure', measurementType: 'blood_pressure', measurementUnit: 'mmHg', isActive: true, recurrenceType: 'selected_days', daysOfWeek: [1,3,5], startDate: '2026-10-01', times: [] }
    const checkIns = [
      { id: '1', monitoringPlanId: 'bp', localDate: '2026-10-12', status: 'done', systolicValue: 125, diastolicValue: 80, completedAt: '2026-10-12T02:00:00Z' },
      { id: '2', monitoringPlanId: 'bp', localDate: '2026-10-09', status: 'done', systolicValue: 128, diastolicValue: 82, completedAt: '2026-10-09T02:00:00Z' },
      { id: '3', monitoringPlanId: 'bp', localDate: '2026-10-07', status: 'done', systolicValue: 124, diastolicValue: 79, completedAt: '2026-10-07T02:00:00Z' },
    ]
    const analysis = analyzeMonitoringReadings({ plan, checkIns, asOfDate: '2026-10-12' })
    expect(analysis.count7Days).toBe(3)
    expect(analysis.latest).toMatchObject({ localDate: '2026-10-12', systolicValue: 125, diastolicValue: 80 })
    expect(analysis.average7Days).toEqual({ systolic: 125.67, diastolic: 80.33, unit: 'mmHg' })
    expect(analysis.series7Days.map(row => row.date)).toEqual(['2026-10-07','2026-10-09','2026-10-12'])
    expect(analyzeMonitoringReadings({ plan, checkIns, asOfDate: '2026-10-12' }).average30Days.systolic).toBe(125.67)
    const weekly = buildMonitoringWeeklySummaries({ plans: [plan], checkIns, asOfDate: '2026-10-12' })[0]
    expect(weekly).toMatchObject({ readingCount: 3, completedOccurrences: 3, scheduledOccurrences: 3 })
  })
})
