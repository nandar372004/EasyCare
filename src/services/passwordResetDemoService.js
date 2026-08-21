import { normalizeMyanmarPhone } from '../features/auth/registrationSchema.js'
import { passwordSchema } from '../features/auth/registrationSchema.js'

export const PASSWORD_RESET_DEMO_CONFIG = Object.freeze({
  phoneNumber: '09123456789',
  verificationCode: '246810',
  expiresAfterMs: 5 * 60 * 1000,
})

const GENERIC_CODE_ERROR = 'The demo verification code is invalid, expired, or already used.'
let challenge = null

export function beginPasswordResetDemo(phoneNumber, now = Date.now()) {
  let normalizedPhone
  try {
    normalizedPhone = normalizeMyanmarPhone(phoneNumber)
  } catch {
    return { success: false, error: 'Enter a valid Myanmar phone number.' }
  }

  challenge = {
    eligible: normalizedPhone === normalizeMyanmarPhone(PASSWORD_RESET_DEMO_CONFIG.phoneNumber),
    expiresAt: now + PASSWORD_RESET_DEMO_CONFIG.expiresAfterMs,
    used: false,
    resetAuthorized: false,
  }
  return { success: true }
}

export function verifyPasswordResetDemoCode(code, now = Date.now()) {
  if (!code?.trim() || !challenge || challenge.used || now > challenge.expiresAt) {
    return { success: false, error: GENERIC_CODE_ERROR }
  }

  if (!challenge.eligible || code.trim() !== PASSWORD_RESET_DEMO_CONFIG.verificationCode) {
    return { success: false, error: GENERIC_CODE_ERROR }
  }

  challenge.used = true
  challenge.resetAuthorized = true
  return { success: true }
}

export function canOpenDemoCodeVerification() {
  return Boolean(challenge)
}

export function canOpenDemoPasswordReset() {
  return Boolean(challenge?.resetAuthorized)
}

export function demonstratePasswordReset(newPassword, confirmPassword) {
  if (!canOpenDemoPasswordReset()) {
    return { success: false, errors: {}, flowError: 'Restart the password reset presentation.' }
  }

  const parsed = passwordSchema.safeParse(newPassword)
  const errors = {}
  if (!parsed.success) errors.newPassword = parsed.error.issues[0].message
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your password'
  else if (newPassword !== confirmPassword) errors.confirmPassword = 'Passwords must match'
  if (Object.keys(errors).length) return { success: false, errors }

  challenge = null
  return { success: true }
}

export function resetPasswordDemoForTests() {
  challenge = null
}
