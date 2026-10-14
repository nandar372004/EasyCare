import { describe, expect, it, vi } from 'vitest'
import { executeRegistration } from './registration-core.ts'

const validPayload = {
  password: 'Synthetic123',
  account: { phoneNumber: '09 123-456-789' },
  profile: { fullName: 'Synthetic Patient', dateOfBirth: '1995-04-12' },
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
  it('registers a minimal patient and persists separate acknowledgements without sensitive response data', async () => {
    const logStage = vi.fn()
    const deps = dependencies({ logStage })
    const result = await executeRegistration(validPayload, deps)
    expect(result).toEqual({ status: 201, body: { success: true } })
    expect(deps.persistPatient).toHaveBeenCalledOnce()
    const persisted = deps.persistPatient.mock.calls[0][0]
    expect(persisted).toMatchObject({
      userId: 'synthetic-user-id',
      phone: '+959123456789',
      fullName: 'Synthetic Patient',
      dateOfBirth: '1995-04-12',
      termsAccepted: true,
      privacyConsent: true,
    })
    expect(persisted).not.toHaveProperty('medicalProfile')
    expect(persisted).not.toHaveProperty('role')
    expect(persisted).not.toHaveProperty('providerId')
    expect(persisted).not.toHaveProperty('password')
    expect(JSON.stringify(result.body)).not.toContain(validPayload.password)
    expect(logStage.mock.calls.map(([stage]) => stage)).toEqual([
      'payload_validated', 'phone_normalized', 'auth_create_started', 'auth_create_succeeded',
      'persistence_started', 'persistence_succeeded', 'registration_completed',
    ])
  })

  it('accepts the reported Myanmar registration payload and keeps the date in ISO format', async () => {
    const payload = {
      password: 'EasyCare2026',
      account: { phoneNumber: '+959963254323' },
      profile: { fullName: 'Ei Ei San', dateOfBirth: '1977-06-09' },
      consent: { termsAccepted: true, privacyConsent: true },
    }
    const deps = dependencies()
    const result = await executeRegistration(payload, deps)

    expect(result).toEqual({ status: 201, body: { success: true } })
    expect(deps.phoneExists).toHaveBeenCalledWith('+959963254323')
    expect(deps.createUser).toHaveBeenCalledOnce()
    expect(deps.persistPatient).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+959963254323',
      fullName: 'Ei Ei San',
      dateOfBirth: '1977-06-09',
      termsAccepted: true,
      privacyConsent: true,
    }))
  })

  it('tolerates legacy optional health fields but does not persist them', async () => {
    const legacyPayload = {
      ...validPayload,
      profile: { ...validPayload.profile, gender: 'Prefer not to say', addressCity: 'Yangon' },
      emergencyContact: { name: 'Legacy', relationship: 'Sibling', phoneNumber: '09 876 543 210' },
      medicalProfile: { bloodType: 'Unknown', allergies: 'legacy free text', noKnownAllergies: false },
    }
    const deps = dependencies()
    expect((await executeRegistration(legacyPayload, deps)).status).toBe(201)
    expect(deps.persistPatient.mock.calls[0][0]).not.toHaveProperty('medicalProfile')
    expect(deps.persistPatient.mock.calls[0][0]).not.toHaveProperty('emergencyContact')
  })

  it('continues to register a valid minor DOB', async () => {
    const deps = dependencies()
    const result = await executeRegistration({
      ...validPayload,
      profile: { ...validPayload.profile, dateOfBirth: '2015-01-01' },
    }, deps)
    expect(result.status).toBe(201)
    expect(deps.createUser).toHaveBeenCalledOnce()
  })

  it('rejects an invalid phone before Auth user creation', async () => {
    const deps = dependencies()
    const result = await executeRegistration({ ...validPayload, account: { phoneNumber: '555' } }, deps)
    expect(result.status).toBe(400)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('rejects a duplicate phone before Auth user creation', async () => {
    const deps = dependencies({ phoneExists: vi.fn().mockResolvedValue(true) })
    const result = await executeRegistration(validPayload, deps)
    expect(result.status).toBe(409)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('rejects missing Terms or Privacy acceptance on the server', async () => {
    for (const consent of [{ termsAccepted: false, privacyConsent: true }, { termsAccepted: true, privacyConsent: false }]) {
      const deps = dependencies()
      expect((await executeRegistration({ ...validPayload, consent }, deps)).status).toBe(400)
      expect(deps.createUser).not.toHaveBeenCalled()
    }
  })

  it('rejects a weak password', async () => {
    const deps = dependencies()
    expect((await executeRegistration({ ...validPayload, password: 'weak' }, deps)).status).toBe(400)
    expect(deps.createUser).not.toHaveBeenCalled()
  })

  it('rejects invalid or future DOB on the server', async () => {
    for (const dateOfBirth of ['2024-02-30', '2999-01-01']) {
      const deps = dependencies()
      expect((await executeRegistration({ ...validPayload, profile: { ...validPayload.profile, dateOfBirth } }, deps)).status).toBe(400)
      expect(deps.createUser).not.toHaveBeenCalled()
    }
  })

  it('deletes the Auth user when patient persistence fails', async () => {
    const deps = dependencies({ persistPatient: vi.fn().mockRejectedValue(new Error('synthetic failure')) })
    expect((await executeRegistration(validPayload, deps)).status).toBe(500)
    expect(deps.deleteUser).toHaveBeenCalledWith('synthetic-user-id')
  })
})
