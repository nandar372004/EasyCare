import { describe, expect, it, vi } from 'vitest'
import { executeRegistration } from './registration-core.ts'

const validPayload = {
  password: 'Synthetic123',
  account: { phoneNumber: '09 123-456-789' },
  profile: {
    fullName: 'Synthetic Patient',
    dateOfBirth: '1995-04-12',
    gender: 'Prefer not to say',
    addressCity: 'Synthetic Yangon',
  },
  emergencyContact: {
    name: 'Synthetic Contact',
    relationship: 'Sibling',
    phoneNumber: '+95 9 876 543 210',
  },
  medicalProfile: {
    bloodType: 'Unknown',
    allergies: '',
    noKnownAllergies: true,
    existingMedicalConditions: '',
    currentMedications: '',
  },
  consent: { termsAccepted: true, privacyConsent: true },
}

function dependencies(overrides = {}) {
  return {
    phoneExists: vi.fn().mockResolvedValue(false),
    createUser: vi.fn().mockResolvedValue({ id: 'synthetic-user-id' }),
    persistPatient: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('patient-register Edge Function core', () => {
  it('registers a valid synthetic patient and returns no sensitive content', async () => {
    const logStage = vi.fn()
    const deps = dependencies({ logStage })
    const result = await executeRegistration(validPayload, deps)
    expect(result).toEqual({ status: 201, body: { success: true } })
    expect(deps.persistPatient).toHaveBeenCalledOnce()
    const persisted = deps.persistPatient.mock.calls[0][0]
    expect(persisted.phone).toBe('+959123456789')
    expect(persisted.medicalProfile).toEqual({
      blood_type: 'Unknown',
      allergies: '',
      no_known_allergies: true,
      existing_medical_conditions: '',
      current_medications: '',
    })
    expect(persisted.termsAccepted).toBe(true)
    expect(persisted.privacyConsent).toBe(true)
    expect(persisted).not.toHaveProperty('password')
    expect(JSON.stringify(result.body)).not.toContain(validPayload.password)
    expect(JSON.stringify(result.body)).not.toContain('medicalProfile')
    expect(logStage.mock.calls.map(([stage]) => stage)).toEqual([
      'payload_validated',
      'phone_normalized',
      'auth_create_started',
      'auth_create_succeeded',
      'persistence_started',
      'persistence_succeeded',
      'registration_completed',
    ])
  })

  it('rejects a duplicate phone before Auth user creation', async () => {
    const deps = dependencies({ phoneExists: vi.fn().mockResolvedValue(true) })
    const result = await executeRegistration(validPayload, deps)
    expect(result.status).toBe(409)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('rejects malformed input', async () => {
    const deps = dependencies()
    const result = await executeRegistration({ account: {} }, deps)
    expect(result.status).toBe(400)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('rejects a weak password', async () => {
    const deps = dependencies()
    const result = await executeRegistration({ ...validPayload, password: 'weak' }, deps)
    expect(result.status).toBe(400)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('deletes the Auth user when profile persistence fails', async () => {
    const deps = dependencies({ persistPatient: vi.fn().mockRejectedValue(new Error('synthetic failure')) })
    const result = await executeRegistration(validPayload, deps)
    expect(result.status).toBe(500)
    expect(deps.deleteUser).toHaveBeenCalledWith('synthetic-user-id')
  })
})
