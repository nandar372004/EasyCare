import { describe, expect, it, vi } from 'vitest'
import { createPatientHealthGoalRepository, sortPatientHealthGoals } from './patientHealthGoalRepository.js'

const row = (id, title, is_completed, created_at) => ({ id, title, is_completed, completed_at: is_completed ? created_at : null, created_at, updated_at: created_at })

describe('patient-owned health goal repository', () => {
  it('reads only goal columns and sorts active before completed without a browser patient id', async () => {
    const query = {
      select: vi.fn(), order: vi.fn(),
      then: resolve => Promise.resolve({ data: [row('b', 'Done', true, '2026-01-01'), row('a', 'First', false, '2026-01-02'), row('c', 'Next', false, '2026-01-03')], error: null }).then(resolve),
    }
    query.select.mockReturnValue(query); query.order.mockReturnValue(query)
    const client = { from: vi.fn(() => query), rpc: vi.fn() }
    const repository = createPatientHealthGoalRepository(client)
    const goals = await repository.listMyGoals()
    expect(client.from).toHaveBeenCalledWith('patient_health_goals')
    expect(query.select).toHaveBeenCalledWith('id, title, is_completed, completed_at, created_at, updated_at')
    expect(query.order.mock.calls).toEqual([['created_at'], ['id']])
    expect(goals.map(goal => goal.title)).toEqual(['First', 'Next', 'Done'])
    expect(goals[2].isCompleted).toBe(true)
  })

  it('writes only through owner-derived RPCs and never accepts patient_id', async () => {
    const client = { from: vi.fn(), rpc: vi.fn()
      .mockResolvedValueOnce({ data: row('a', 'Walk daily', false, '2026-01-01'), error: null })
      .mockResolvedValueOnce({ data: row('a', 'Walk daily', true, '2026-01-02'), error: null })
      .mockResolvedValueOnce({ data: null, error: null }) }
    const repository = createPatientHealthGoalRepository(client)
    await repository.createMyGoal('Walk daily')
    await repository.setGoalCompletion('a1000000-0000-4000-8000-000000000001', true)
    await repository.deleteMyGoal('a1000000-0000-4000-8000-000000000001')
    expect(client.rpc.mock.calls).toEqual([
      ['create_my_patient_health_goal', { p_title: 'Walk daily' }],
      ['set_my_patient_health_goal_completion', { p_goal_id: 'a1000000-0000-4000-8000-000000000001', p_is_completed: true }],
      ['delete_my_patient_health_goal', { p_goal_id: 'a1000000-0000-4000-8000-000000000001' }],
    ])
    expect(client.rpc.mock.calls.every(([, args]) => !Object.hasOwn(args, 'patient_id'))).toBe(true)
  })

  it('sorts goals by completion first and stable creation order', () => {
    expect(sortPatientHealthGoals([
      { id: 'b', title: 'Complete', isCompleted: true, createdAt: '2026-01-01' },
      { id: 'c', title: 'Second', isCompleted: false, createdAt: '2026-01-02' },
      { id: 'a', title: 'First', isCompleted: false, createdAt: '2026-01-01' },
    ]).map(goal => goal.title)).toEqual(['First', 'Second', 'Complete'])
  })
})
