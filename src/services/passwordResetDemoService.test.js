import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginPasswordResetDemo,
  canOpenDemoPasswordReset,
  demonstratePasswordReset,
  PASSWORD_RESET_DEMO_CONFIG,
  resetPasswordDemoForTests,
  verifyPasswordResetDemoCode,
} from './passwordResetDemoService.js'

describe('password reset presentation service', () => {
  beforeEach(resetPasswordDemoForTests)

  it('accepts only the configured synthetic flow without exposing phone existence', () => {
    expect(beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber, 1000)).toEqual({ success: true })
    expect(verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 1001)).toEqual({ success: true })
    expect(canOpenDemoPasswordReset()).toBe(true)
  })

  it('uses the same generic code error for an unconfigured phone and wrong code', () => {
    beginPasswordResetDemo('09999999999', 1000)
    const ineligible = verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 1001)
    resetPasswordDemoForTests()
    beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber, 1000)
    const wrong = verifyPasswordResetDemoCode('000000', 1001)
    expect(ineligible.error).toBe(wrong.error)
  })

  it('rejects empty, expired, and reused codes', () => {
    beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber, 1000)
    expect(verifyPasswordResetDemoCode('', 1001).success).toBe(false)
    expect(verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 1000 + PASSWORD_RESET_DEMO_CONFIG.expiresAfterMs + 1).success).toBe(false)
    beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber, 2000)
    expect(verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 2001).success).toBe(true)
    expect(verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 2002).success).toBe(false)
  })

  it('applies registration password strength and confirmation rules', () => {
    beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber, 1000)
    verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode, 1001)
    expect(demonstratePasswordReset('weak', 'weak').errors.newPassword).toMatch(/8 characters/)
    expect(demonstratePasswordReset('StrongPass1', 'Different1').errors.confirmPassword).toBe('Passwords must match')
    expect(demonstratePasswordReset('StrongPass1', 'StrongPass1')).toEqual({ success: true })
    expect(canOpenDemoPasswordReset()).toBe(false)
  })

  it('does not write presentation credentials or challenges to browser storage', () => {
    const localBefore = localStorage.length
    const sessionBefore = sessionStorage.length
    beginPasswordResetDemo(PASSWORD_RESET_DEMO_CONFIG.phoneNumber)
    verifyPasswordResetDemoCode(PASSWORD_RESET_DEMO_CONFIG.verificationCode)
    demonstratePasswordReset('StrongPass1', 'StrongPass1')
    expect(localStorage.length).toBe(localBefore)
    expect(sessionStorage.length).toBe(sessionBefore)
  })
})
