// The prototype remains available for offline demonstrations, but the normal
// application path uses Supabase registration and authentication.
export const HACKATHON_PROTOTYPE = import.meta.env.VITE_HACKATHON_PROTOTYPE === 'true'

export const DEMO_CREDENTIALS = Object.freeze({
  phoneNumber: '09123456789',
  password: 'EasyCare123',
})

export const DEMO_AUTH_ERROR = 'Incorrect phone number or password.'

const SESSION_KEY = 'easycare.hackathon.session.v1'

export function loadPrototypeSession(storage = globalThis.localStorage) {
  if (!HACKATHON_PROTOTYPE || !storage) return null
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY))
    return value?.prototype === true && typeof value.fullName === 'string' ? value : null
  } catch {
    return null
  }
}

export function savePrototypeSession(fullName, storage = globalThis.localStorage) {
  const session = { prototype: true, fullName: fullName?.trim() || 'Demo Patient' }
  storage?.setItem(SESSION_KEY, JSON.stringify(session))
  return session
}

export function clearPrototypeSession(storage = globalThis.localStorage) {
  storage?.removeItem(SESSION_KEY)
}
