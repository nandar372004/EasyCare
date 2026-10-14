import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = (name) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
const migration = readMigration('20260928090000_patient_profile_identity_repair.sql')
const security = readMigration('20260820010900_ai_security.sql')
const selfService = readMigration('20260821103000_patient_profile_self_service.sql')
const registrationConsentTypes = readMigration('20261004120000_registration_consent_types.sql')
const registrationConsent = readMigration('20261004130000_registration_consent_document_identity.sql')

describe('patient registration migration security contract', () => {
  // Behavioral RLS, grants, rollback and ownership assertions execute against
  // PostgreSQL in patientProfileIdentity.integration.test.js. These checks keep
  // the deployed migration-source contract anchored to the current filenames.
  it('preserves RLS and keeps the registration RPC service-only', () => {
    expect(security).toContain("'profiles','patients','family_authorizations'")
    expect(security).toContain("alter table public.%I enable row level security")
    expect(migration).not.toMatch(/disable row level security/i)
    expect(migration).toContain('revoke all on function public.create_patient_registration(jsonb) from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.create_patient_registration(jsonb) to service_role')
  })

  it('uses auth.uid ownership checks for profiles and patients', () => {
    expect(security).toContain('using (id = auth.uid() or public.is_main_admin())')
    expect(migration).toContain('using (profile_id = auth.uid())')
    expect(migration).toContain('with check (profile_id = auth.uid())')
  })

  it('prevents browser updates to role and ownership columns', () => {
    const patientUpdateGrant = selfService.match(/grant update \(([^)]+)\)\s+on table public\.patients to authenticated;/s)?.[1]
    expect(patientUpdateGrant).toBeDefined()
    expect(patientUpdateGrant).not.toMatch(/\b(id|auth_user_id|profile_id|status)\b/)
    expect(security).toContain('new.role is distinct from old.role')
    expect(migration).toContain('new.profile_id is distinct from old.profile_id')
  })

  it('does not grant delete access to browser roles', () => {
    expect(migration).not.toMatch(/grant delete .* to (anon|authenticated)/i)
  })

  it('contains no frontend service-role configuration', () => {
    expect(migration).not.toContain('VITE_SUPABASE_SERVICE')
  })

  it('adds independent Terms and Privacy document evidence without rewriting old consent rows', () => {
    expect(registrationConsentTypes).toContain("add value if not exists 'terms_of_service'")
    expect(registrationConsentTypes).toContain("add value if not exists 'privacy_policy'")
    expect(registrationConsent).toContain('add column document_key text')
    expect(registrationConsent).toContain("'terms_of_service'")
    expect(registrationConsent).toContain("'privacy_policy'")
    expect(registrationConsent).toContain("'terms-v1'")
    expect(registrationConsent).toContain("'privacy-v1'")
    expect(registrationConsent).toContain('granted_by_profile_id')
    expect(registrationConsent).toContain("'terms_of_service', 'terms_of_service'")
    expect(registrationConsent).toContain("'privacy_policy', 'privacy_policy'")
    expect(registrationConsent).not.toMatch(/update public\.consents/i)
    expect(registrationConsent).toContain('grant execute on function public.create_patient_registration(jsonb) to service_role')
  })
})
