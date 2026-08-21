const PHONE_PATTERN = /^(?:\+?95|0095|0)9\d{7,9}$/

export function normalizeMyanmarPhone(value: string): string {
  const compact = value.trim().replace(/[\s-]/g, '')
  if (!PHONE_PATTERN.test(compact)) throw new Error('INVALID_PHONE')

  if (compact.startsWith('+959')) return compact
  if (compact.startsWith('00959')) return `+${compact.slice(2)}`
  if (compact.startsWith('959')) return `+${compact}`
  return `+95${compact.slice(1)}`
}

export async function deriveInternalEmail(normalizedPhone: string): Promise<string> {
  const bytes = new TextEncoder().encode(`medibridge-phone-v1:${normalizedPhone}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hash}@phone-auth.medibridge.invalid`
}
