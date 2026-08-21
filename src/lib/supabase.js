import { createClient } from '@supabase/supabase-js'

const FIXTURE_MESSAGE = 'Development configuration: Supabase is not configured. The application is running in fixture mode.'
const INVALID_MESSAGE = 'Development configuration: Supabase configuration is invalid. The application is running in fixture mode.'
const UNSAFE_KEY_MESSAGE = 'Development configuration: An unsafe Supabase browser key was rejected. The application is running in fixture mode.'

function decodeJwtPayload(key) {
  const parts = key.split('.')
  if (parts.length !== 3) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(globalThis.atob(padded))
  } catch {
    return null
  }
}

function isUnsafeBrowserKey(key) {
  const normalizedKey = key.toLowerCase()
  if (normalizedKey.startsWith('sb_secret_') || normalizedKey.includes('service_role')) return true

  const payload = decodeJwtPayload(key)
  return payload?.role === 'service_role' || payload?.role === 'supabase_admin'
}

function isValidSupabaseUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function resolveSupabaseConfiguration(urlValue, keyValue) {
  const url = urlValue?.trim() ?? ''
  const publishableKey = keyValue?.trim() ?? ''

  if (!url || !publishableKey) {
    return { mode: 'fixture', isConfigured: false, message: FIXTURE_MESSAGE }
  }

  if (isUnsafeBrowserKey(publishableKey)) {
    return { mode: 'fixture', isConfigured: false, message: UNSAFE_KEY_MESSAGE }
  }

  if (!isValidSupabaseUrl(url)) {
    return { mode: 'fixture', isConfigured: false, message: INVALID_MESSAGE }
  }

  return { mode: 'supabase', isConfigured: true, message: '' }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabaseConfiguration = Object.freeze(
  resolveSupabaseConfiguration(supabaseUrl, supabasePublishableKey),
)

export const supabase = supabaseConfiguration.isConfigured
  ? createClient(supabaseUrl.trim(), supabasePublishableKey.trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
