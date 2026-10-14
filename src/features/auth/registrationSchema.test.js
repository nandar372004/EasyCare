import { describe, expect, it, vi } from 'vitest'
import { registerPatient, submitRegistration } from '../../services/registrationService.js'

const validForm = {
  phoneNumber: '09 123-456-789',
  password: 'Health123',
  confirmPassword: 'Health123',
  fullName: 'Test Patient',
  dateOfBirth: '1995-04-12',
  termsAccepted: true,
  privacyConsent: true,
}

function expectRejected(changes, field) {
  const result = submitRegistration({ ...validForm, ...changes })
  expect(result.success).toBe(false)
  expect(result.errors).toHaveProperty(field)
}

describe('patient registration validation', () => {
  it('accepts the minimal registration contract and normalizes the phone', () => {
    const result = submitRegistration(validForm)
    expect(result.success).toBe(true)
    expect(result.registrationData).toEqual({
      account: { phoneNumber: '+959123456789' },
      profile: { fullName: 'Test Patient', dateOfBirth: '1995-04-12' },
      consent: { termsAccepted: true, privacyConsent: true },
    })
  })

  it('accepts the reported phone and preserves the date input as YYYY-MM-DD', () => {
    const result = submitRegistration({
      ...validForm,
      phoneNumber: '09963254323',
      fullName: 'Ei Ei San',
      dateOfBirth: '1977-06-09',
    })

    expect(result.success).toBe(true)
    expect(result.registrationData).toMatchObject({
      account: { phoneNumber: '+959963254323' },
      profile: { fullName: 'Ei Ei San', dateOfBirth: '1977-06-09' },
      consent: { termsAccepted: true, privacyConsent: true },
    })
  })

  it('rejects an empty form and missing full name', () => {
    expect(submitRegistration({}).success).toBe(false)
    expectRejected({ fullName: '' }, 'fullName')
  })

  it.each(['', '12345', '+1 202 555 0142'])(
    'rejects missing or invalid Myanmar phone %s',
    (phoneNumber) => expectRejected({ phoneNumber }, 'phoneNumber'),
  )

  it.each(['short1', 'onlyletters', '12345678'])(
    'rejects weak password %s',
    (password) => expectRejected({ password, confirmPassword: password }, 'password'),
  )

  it('rejects password confirmation mismatch', () => expectRejected({ confirmPassword: 'Different123' }, 'confirmPassword'))

  it.each(['not-a-date', '2999-01-01', '2024-02-30'])(
    'rejects invalid or future date %s',
    (dateOfBirth) => expectRejected({ dateOfBirth }, 'dateOfBirth'),
  )

  it('continues to accept a valid minor DOB', () => {
    expect(submitRegistration({ ...validForm, dateOfBirth: '2015-01-01' }).success).toBe(true)
  })

  it('requires Terms and Privacy independently', () => {
    expectRejected({ termsAccepted: false }, 'termsAccepted')
    expectRejected({ privacyConsent: false }, 'privacyConsent')
  })

  it('does not require or send legacy health/profile fields', () => {
    const result = submitRegistration(validForm)
    expect(result.success).toBe(true)
    expect(result.registrationData.profile).not.toHaveProperty('gender')
    expect(result.registrationData).not.toHaveProperty('emergencyContact')
    expect(result.registrationData).not.toHaveProperty('medicalProfile')
  })

  it('does not let client-supplied role or patient identifiers enter registration data', () => {
    const result = submitRegistration({ ...validForm, role: 'doctor', providerId: 'arbitrary', patientId: 'other-patient' })
    expect(result.success).toBe(true)
    expect(result.registrationData).not.toHaveProperty('role')
    expect(result.registrationData).not.toHaveProperty('providerId')
    expect(result.registrationData).not.toHaveProperty('patientId')
  })

  it('does not include passwords in the registration data', () => {
    const result = submitRegistration(validForm)
    expect(JSON.stringify(result.registrationData)).not.toContain(validForm.password)
    expect(result.registrationData).not.toHaveProperty('password')
  })

  it('reports missing Supabase configuration instead of claiming registration succeeded', async () => {
    await expect(registerPatient(validForm, null)).resolves.toMatchObject({ success: false })
  })

  it('invokes patient-register with only the minimal validated payload and password', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    await expect(registerPatient(validForm, { functions: { invoke } })).resolves.toMatchObject({ success: true })
    expect(invoke).toHaveBeenCalledWith('patient-register', {
      body: { password: validForm.password, ...submitRegistration(validForm).registrationData },
    })
  })

  it('maps duplicate phone response safely', async () => {
    const context = new Response(JSON.stringify({ error: 'Unable to register with these details.' }), { status: 409 })
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context } }) } }
    await expect(registerPatient(validForm, client)).resolves.toMatchObject({
      success: false,
      message: 'An account with this phone number may already exist.',
    })
  })
})
