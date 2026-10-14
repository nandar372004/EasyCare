import { describe, expect, it, vi } from 'vitest'
import { createPatientMonitoringRepository } from './patientMonitoringRepository.js'

function mockClient() {
  const requests = []
  const client = {
    from: vi.fn(table => {
      const request = { table, select: vi.fn(function (columns) { this.columns = columns; return this }), order: vi.fn(function (...args) { (this.orderBy ||= []).push(args); return this }), then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) } }
      requests.push(request); return request
    }),
    rpc: vi.fn(async () => ({ data: { id: 'plan-id', title: 'Walk', recurrence_type: 'daily', days_of_week: [], start_date: '2026-10-12', is_active: true }, error: null })),
  }
  return { client, requests }
}

describe('patient monitoring repository ownership contract', () => {
  it('reads through the authenticated session without a browser patient_id filter', async () => {
    const { client, requests } = mockClient()
    const repo = createPatientMonitoringRepository(client)
    expect(await repo.listMyPlans()).toEqual([])
    expect(await repo.listMyCheckIns()).toEqual([])
    expect(requests.map(request => request.table)).toEqual(['patient_monitoring_plans', 'patient_monitoring_plan_times', 'patient_monitoring_check_ins'])
    expect(requests.every(request => !('eq' in request))).toBe(true)
  })

  it('saves and checks in through owner-resolving RPCs without a patient id argument', async () => {
    const { client } = mockClient()
    const repo = createPatientMonitoringRepository(client)
    await repo.saveMyPlan({ title: 'Walk', recurrenceType: 'daily', daysOfWeek: [], startDate: '2026-10-12', times: ['09:00'] })
    await repo.recordMyCheckIn({ planId: 'plan-id', localDate: '2026-10-12', occurrenceKey: 'any', isDone: true })
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'save_my_patient_monitoring_plan_v2', expect.any(Object))
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty('p_patient_id')
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_title: 'Walk', p_recurrence_type: 'daily', p_times: ['09:00:00'], p_measurement_type: null, p_measurement_unit: null })
    expect(client.rpc.mock.calls[1][1]).toMatchObject({ p_plan_id: 'plan-id', p_local_date: '2026-10-12', p_occurrence_key: 'any', p_is_done: true })
    expect(JSON.stringify(client.rpc.mock.calls)).not.toContain('patient_id')
  })

  it('reads separate BP fields and records measurements through the owner-resolving RPC', async () => {
    const { client } = mockClient()
    client.rpc.mockResolvedValue({ data: { id: 'check-1', monitoring_plan_id: 'plan-id', local_date: '2026-10-12', status: 'done', systolic_value: '125', diastolic_value: '80', completed_at: '2026-10-12T10:00:00Z' }, error: null })
    const repo = createPatientMonitoringRepository(client)
    const result = await repo.recordMyMeasurement({ planId: 'plan-id', localDate: '2026-10-12', occurrenceKey: 'any', measurementType: 'blood_pressure', systolicValue: 125, diastolicValue: 80, measurementUnit: 'mmHg' })
    expect(client.rpc).toHaveBeenCalledWith('record_my_patient_monitoring_measurement', expect.objectContaining({ p_systolic_value: 125, p_diastolic_value: 80, p_measurement_value: null }))
    expect(result).toMatchObject({ systolicValue: 125, diastolicValue: 80, status: 'done' })
  })
})
