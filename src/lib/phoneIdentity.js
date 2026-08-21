import { normalizeMyanmarPhone } from '../features/auth/registrationSchema.js'

export async function deriveInternalEmail(phoneNumber) {
  const normalizedPhone = normalizeMyanmarPhone(phoneNumber)
  const bytes = new TextEncoder().encode(`medibridge-phone-v1:${normalizedPhone}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hash}@phone-auth.medibridge.invalid`
}
