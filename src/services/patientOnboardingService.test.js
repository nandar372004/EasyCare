import { describe, expect, it, vi } from 'vitest'
import { savePatientOnboarding } from './patientOnboardingService.js'

describe('patient onboarding service', () => {
  it('sends only allowlisted profile values through a session-bound RPC with no identity arguments', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { status: 'completed' }, error: null }) }
    await savePatientOnboarding('completed', { addressLine: 'Road', gender: 'female', role: 'doctor', patientId: 'other-patient', allergies: ['x'] }, client)
    expect(client.rpc).toHaveBeenCalledWith('save_my_patient_onboarding', { p_status: 'completed', p_profile: { addressLine: 'Road' } })
  })

  it('rejects unsupported state values before calling the backend', async () => {
    const client = { rpc: vi.fn() }
    await expect(savePatientOnboarding('admin', {}, client)).rejects.toThrow('Invalid onboarding status')
    expect(client.rpc).not.toHaveBeenCalled()
  })
})
