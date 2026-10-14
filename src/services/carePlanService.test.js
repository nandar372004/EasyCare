import { describe, expect, it, vi } from 'vitest'
import { createCarePlanRepository } from './repositories/carePlanRepository.js'
import { createCarePlanService } from './carePlanService.js'

describe('clinical care plan contracts', () => {
  it('uses intent-specific RPCs and never mutates plan tables directly', async () => {
    const rpc = vi.fn(async () => ({ data: 'plan-id', error: null }))
    const repository = createCarePlanRepository({ rpc })
    await repository.transition('plan-id', 'pause')
    expect(rpc).toHaveBeenCalledWith('transition_care_plan', { p_plan: 'plan-id', p_intent: 'pause', p_reason: null })
    await repository.reconcileOccurrences('plan-id')
    expect(rpc).toHaveBeenCalledWith('reconcile_care_plan_occurrences', { p_plan: 'plan-id' })
    expect(rpc.mock.calls.every(([name]) => !name.includes('update') && !name.includes('insert'))).toBe(true)
  })

  it('validates the clinical plan and task intent fields', async () => {
    const repository = { createDraft: vi.fn(), addTask: vi.fn(), transition: vi.fn() }
    const service = createCarePlanService(repository)
    expect(() => service.createDraft({ patientId: 'invalid', title: 'Plan', timezone: 'UTC' })).toThrow(/patient/i)
    expect(() => service.addTask({ planId: '00000000-0000-4000-8000-000000000001', type: 'medication-ish', title: 'Dose' })).toThrow(/task type/i)
    await service.addTask({ planId: '00000000-0000-4000-8000-000000000001', type: 'instruction', title: 'Rest' })
    expect(repository.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rest' }))
  })
})
