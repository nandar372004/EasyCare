// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isPhaseITestPipelineEnabled, PHASE_I_TEST_STAGING_PROJECT_REF } from './phase-i-test-pipeline-gate.js'

const stagingUrl = `https://${PHASE_I_TEST_STAGING_PROJECT_REF}.supabase.co`

describe('Staging-only Phase I test pipeline gate', () => {
  it('requires the explicit server flag and exact Staging project URL', () => {
    expect(isPhaseITestPipelineEnabled({ flag: 'true', supabaseUrl: stagingUrl })).toBe(true)
    expect(isPhaseITestPipelineEnabled({ flag: 'false', supabaseUrl: stagingUrl })).toBe(false)
    expect(isPhaseITestPipelineEnabled({ flag: undefined, supabaseUrl: stagingUrl })).toBe(false)
    expect(isPhaseITestPipelineEnabled({ flag: 'true', supabaseUrl: 'http://localhost:54321' })).toBe(false)
    expect(isPhaseITestPipelineEnabled({ flag: 'true', supabaseUrl: 'https://production.supabase.co' })).toBe(false)
    expect(isPhaseITestPipelineEnabled({ flag: 'true', supabaseUrl: 'https://xyprybspwrtthvhnumdp.supabase.co.attacker.example' })).toBe(false)
  })
})
