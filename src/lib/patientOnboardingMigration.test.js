import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261004140000_patient_onboarding_state.sql', 'utf8').toLowerCase()
const identityFix = readFileSync('supabase/migrations/20261005100000_patient_onboarding_auth_identity.sql', 'utf8').toLowerCase()
describe('patient onboarding migration security contract', () => {
  it('resolves ownership from auth.uid and grants only the session RPCs', () => {
    expect(sql).toContain('p.auth_user_id = auth.uid()')
    expect(sql).toContain('p.profile_id = auth.uid()')
    expect(sql).toContain('revoke all on public.patient_onboarding_states from public, anon, authenticated')
    expect(sql).toContain('grant execute on function public.get_my_patient_onboarding() to authenticated')
    expect(sql).toContain('grant execute on function public.save_my_patient_onboarding(text,jsonb) to authenticated')
    expect(sql).toContain("'emergencycontactphone'" )
    expect(sql).toContain("'emergencycontactrelationship'")
    expect(sql).toContain("'addressline'")
    expect(sql).not.toMatch(/patient_allergies|patient_conditions|patient_medications|prescriptions|medication_schedules/)
    expect(sql).not.toMatch(/set\s+(role|provider_id|clinic_id|admin)/)
  })

  it('resolves legacy patient identity through the authenticated patient row', () => {
    expect(identityFix).toContain('p.auth_user_id = auth.uid()')
    expect(identityFix).toContain("'fullname', p.full_name")
    expect(identityFix).toContain("'dateofbirth', p.date_of_birth")
    expect(identityFix).toContain("'phone', p.primary_phone")
    expect(identityFix).not.toContain('p.profile_id')
    expect(identityFix).not.toContain('public.profiles')
    expect(identityFix).toContain('grant execute on function public.get_my_patient_onboarding() to authenticated')
    expect(identityFix).toContain('grant execute on function public.save_my_patient_onboarding(text,jsonb) to authenticated')
  })
})
