import { describe, expect, it, vi } from 'vitest'
import { registerPatient, submitRegistration } from '../../services/registrationService.js'

const validForm = {
  phoneNumber: '09 123-456-789',
  password: 'Health123',
  confirmPassword: 'Health123',
  fullName: 'Test Patient',
  dateOfBirth: '1995-04-12',
  gender: 'Prefer not to say',
  addressCity: 'Yangon',
  emergencyName: 'Test Contact',
  emergencyRelationship: 'Sibling',
  emergencyPhoneNumber: '+95 9 876-543-210',
  bloodType: 'Unknown',
  allergies: 'Synthetic test allergy',
  noKnownAllergies: false,
  existingMedicalConditions: '',
  currentMedications: '',
  termsAccepted: true,
  privacyConsent: true,
}

function expectRejected(changes, field) {
  const result = submitRegistration({ ...validForm, ...changes })
  expect(result.success).toBe(false)
  expect(result.errors).toHaveProperty(field)
}

describe('patient registration validation', () => {
  it('rejects an empty form', () => {
    const emptyForm = Object.fromEntries(Object.entries(validForm).map(([key, value]) => [key, typeof value === 'boolean' ? false : '']))
    expect(submitRegistration(emptyForm).success).toBe(false)
  })

  it('rejects a missing full name', () => expectRejected({ fullName: '' }, 'fullName'))

  it.each(['not-a-date', '2999-01-01', '2024-02-30'])(
    'rejects invalid or future date %s',
    (dateOfBirth) => expectRejected({ dateOfBirth }, 'dateOfBirth'),
  )

  it.each(['', '12345', '+1 202 555 0142'])(
    'rejects missing or invalid Myanmar phone %s',
    (phoneNumber) => expectRejected({ phoneNumber }, 'phoneNumber'),
  )

  it.each(['short1', 'onlyletters', '12345678'])(
    'rejects weak password %s',
    (password) => expectRejected({ password, confirmPassword: password }, 'password'),
  )

  it('rejects a password mismatch', () => expectRejected({ confirmPassword: 'Different123' }, 'confirmPassword'))

  it('rejects missing gender', () => expectRejected({ gender: '' }, 'gender'))
  it('rejects missing address or city', () => expectRejected({ addressCity: '' }, 'addressCity'))
  it('rejects a missing emergency contact name', () => expectRejected({ emergencyName: '' }, 'emergencyName'))
  it('rejects a missing emergency relationship', () => expectRejected({ emergencyRelationship: '' }, 'emergencyRelationship'))
  it('rejects an invalid emergency phone', () => expectRejected({ emergencyPhoneNumber: '555' }, 'emergencyPhoneNumber'))
  it('rejects a missing blood type', () => expectRejected({ bloodType: '' }, 'bloodType'))
  it('rejects missing allergies without an explicit no-known-allergies choice', () => expectRejected({ allergies: '', noKnownAllergies: false }, 'allergies'))

  it('accepts an explicit no-known-allergies choice', () => {
    expect(submitRegistration({ ...validForm, allergies: '', noKnownAllergies: true }).success).toBe(true)
  })

  it.each([
    ['fullName', 161],
    ['addressCity', 301],
    ['emergencyName', 161],
    ['emergencyRelationship', 81],
    ['allergies', 1001],
    ['existingMedicalConditions', 2001],
    ['currentMedications', 2001],
  ])('matches the Edge Function maximum for %s', (field, length) => {
    expectRejected({ [field]: 'x'.repeat(length), noKnownAllergies: false }, field)
  })

  it('reports missing Supabase configuration instead of claiming registration succeeded', async () => {
    const result = await registerPatient(validForm, null)
    expect(result).toEqual({
      success: false,
      errors: {},
      message: 'Registration service is not configured correctly. Please contact support.',
    })
  })

  it('accepts empty optional medical fields', () => {
    expect(submitRegistration({ ...validForm, existingMedicalConditions: '', currentMedications: '' }).success).toBe(true)
  })

  it('rejects missing Terms acceptance', () => expectRejected({ termsAccepted: false }, 'termsAccepted'))
  it('rejects missing Privacy Consent', () => expectRejected({ privacyConsent: false }, 'privacyConsent'))

  it('creates the required registration data for a valid form', () => {
    const result = submitRegistration(validForm)
    expect(result.success).toBe(true)
    expect(result.registrationData).toEqual({
      account: { phoneNumber: '+959123456789' },
      profile: {
        fullName: 'Test Patient',
        dateOfBirth: '1995-04-12',
        gender: 'Prefer not to say',
        addressCity: 'Yangon',
      },
      emergencyContact: {
        name: 'Test Contact',
        relationship: 'Sibling',
        phoneNumber: '+959876543210',
      },
      medicalProfile: {
        bloodType: 'Unknown',
        allergies: 'Synthetic test allergy',
        noKnownAllergies: false,
        existingMedicalConditions: '',
        currentMedications: '',
      },
      consent: { termsAccepted: true, privacyConsent: true },
    })
  })

  it('never includes password fields in registrationData', () => {
    const result = submitRegistration(validForm)
    expect(result.success).toBe(true)
    expect(JSON.stringify(result.registrationData)).not.toContain(validForm.password)
    expect(result.registrationData).not.toHaveProperty('password')
    expect(result.registrationData.account).not.toHaveProperty('password')
  })

  it('invokes patient-register with the complete validated payload', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
    const result = await registerPatient(validForm, { functions: { invoke } })

    expect(result.success).toBe(true)
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('patient-register', {
      body: {
        password: validForm.password,
        ...submitRegistration(validForm).registrationData,
      },
    })
    expect(invoke.mock.calls[0][1].body).not.toEqual({})
  })

  it.each([
    [400, 'Please check your registration details, phone number, and password and try again.'],
    [409, 'An account with this phone number may already exist.'],
    [429, 'Too many registration attempts. Please wait and try again.'],
  ])('maps expected backend HTTP %s safely', async (status, message) => {
    const context = new Response(JSON.stringify({ error: 'Unable to register with these details.' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { context } }) } }

    await expect(registerPatient(validForm, client)).resolves.toMatchObject({ success: false, message })
  })
})
