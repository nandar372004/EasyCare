import { describe, expect, it } from 'vitest'
import { getProviderSetupRedirect, validateProviderPassword } from './providerSetup.js'

describe('provider account setup rules', () => {
  it.each([
    ['doctor', '/provider'], ['nurse_aide', '/provider/nurse-aide'],
    ['skilled_nurse_aide', '/provider/nurse-aide'], ['special_nurse', '/provider/nurse-aide'],
  ])('routes %s to its provider workspace', (type, path) => expect(getProviderSetupRedirect(type)).toBe(path))

  it.each(['admin', 'nurse', 'caregiver'])('rejects %s in the new onboarding flow', type => expect(getProviderSetupRedirect(type)).toBeNull())
  it('requires a strong matching password without returning the password', () => {
    expect(validateProviderPassword('short1', 'short1')).toHaveProperty('password')
    expect(validateProviderPassword('long-password', 'long-password')).toHaveProperty('password')
    expect(validateProviderPassword('SecurePass123', 'SecurePass124')).toHaveProperty('confirmation')
    expect(validateProviderPassword('SecurePass123', 'SecurePass123')).toEqual({})
  })
})
