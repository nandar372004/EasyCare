import { describe, expect, it } from 'vitest'
import { resolveSupabaseConfiguration, supabase, supabaseConfiguration } from './supabase.js'

function syntheticJwt(role) {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256' })}.${encode({ role })}.synthetic-signature`
}

describe('Supabase browser client preparation', () => {
  it('uses fixture mode when environment variables are missing', () => {
    const configuration = resolveSupabaseConfiguration('', '')
    expect(configuration).toMatchObject({ mode: 'fixture', isConfigured: false })
    expect(configuration.message).not.toBe('')
  })

  it('accepts a browser-safe publishable key', () => {
    const configuration = resolveSupabaseConfiguration('https://synthetic-project.supabase.co', 'sb_publishable_synthetic-test-key')
    expect(configuration).toEqual({ mode: 'supabase', isConfigured: true, message: '' })
  })

  it('accepts a legacy anon-role browser key', () => {
    const configuration = resolveSupabaseConfiguration('https://synthetic-project.supabase.co', syntheticJwt('anon'))
    expect(configuration.isConfigured).toBe(true)
  })

  it('rejects a secret key without revealing it in the message', () => {
    const key = 'sb_secret_synthetic-test-key'
    const configuration = resolveSupabaseConfiguration('https://synthetic-project.supabase.co', key)
    expect(configuration).toMatchObject({ mode: 'fixture', isConfigured: false })
    expect(configuration.message).not.toContain(key)
  })

  it('rejects a service-role JWT without revealing configuration values', () => {
    const url = 'https://synthetic-project.supabase.co'
    const key = syntheticJwt('service_role')
    const configuration = resolveSupabaseConfiguration(url, key)
    expect(configuration).toMatchObject({ mode: 'fixture', isConfigured: false })
    expect(configuration.message).not.toContain(url)
    expect(configuration.message).not.toContain(key)
  })

  it('rejects malformed URLs and keeps fixture mode active', () => {
    const configuration = resolveSupabaseConfiguration('not-a-url', 'sb_publishable_synthetic-test-key')
    expect(configuration).toMatchObject({ mode: 'fixture', isConfigured: false })
  })

  it('exports no client when the test environment is unconfigured', () => {
    expect(supabaseConfiguration.mode).toBe('fixture')
    expect(supabase).toBeNull()
  })
})
