import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), 'utf8')
const core = readProjectFile('supabase/migrations/20260810000000_core_presentation_schema.sql')
const rls = readProjectFile('supabase/migrations/20260810000200_phase4_schema_rls.sql')
const seed = readProjectFile('supabase/seed.sql')
const reset = readProjectFile('supabase/scripts/reset_synthetic_data.sql')
const diagram = readProjectFile('Tele_Clinic_Database.mmd')

describe('Phase 4 database artifacts', () => {
  it.each(['profiles', 'patients', 'providers', 'availability_slots', 'appointments', 'appointment_events'])(
    'creates %s with RLS enabled',
    (table) => {
      expect(core).toContain(`create table public.${table}`)
      expect(core).toContain(`alter table public.${table} enable row level security`)
    },
  )

  it('uses managed auth.users and contains no custom password storage', () => {
    const allSql = `${core}\n${rls}\n${seed}`.toLowerCase()
    expect(core).toContain('references auth.users(id)')
    expect(allSql).not.toContain('create table auth_users')
    expect(allSql).not.toContain('encrypted_password')
  })

  it('enforces UUID keys, integer MMK, and server consent timestamps', () => {
    expect(core).toMatch(/id uuid primary key/g)
    expect(core).toContain('consultation_fee_mmk integer')
    expect(core).toContain('fee_mmk integer')
    expect(core).toContain('terms_accepted_at timestamptz not null default statement_timestamp()')
    expect(core).toContain('privacy_consent_at timestamptz not null default statement_timestamp()')
  })

  it('prevents duplicate active slot allocation', () => {
    expect(core).toContain('create unique index appointments_one_active_per_slot_uidx')
    expect(core).toContain("where status in ('pending', 'confirmed', 'checked_in', 'in_progress')")
  })

  it('contains participant-scoped RLS without permissive catch-all expressions', () => {
    expect(rls).toContain('appointments_select_patient_own')
    expect(rls).toContain('appointments_select_provider_assigned')
    expect(rls).toContain('profile_id = (select auth.uid())')
    expect(rls).not.toMatch(/using\s*\(\s*true\s*\)/i)
    expect(rls).not.toMatch(/with check\s*\(\s*true\s*\)/i)
  })

  it('keeps provider creation and sensitive event writes away from browser roles', () => {
    expect(rls).not.toMatch(/grant insert[^;]*public\.providers[^;]*authenticated/is)
    expect(rls).not.toMatch(/grant insert[^;]*public\.appointment_events[^;]*authenticated/is)
    expect(rls).not.toMatch(/create policy providers_insert/i)
    expect(rls).not.toMatch(/create policy appointment_events_insert/i)
  })

  it('guards synthetic seed and reset against production execution', () => {
    expect(seed).toContain("environment_name not in ('local', 'test', 'demo')")
    expect(seed).toContain("seed_allowed is distinct from 'on'")
    expect(reset).toContain("environment_name not in ('local', 'test', 'demo')")
    expect(reset).toContain("reset_allowed is distinct from 'on'")
  })

  it('represents auth.users as a managed external identity in the diagram', () => {
    expect(diagram).toContain('AUTH_USERS ||--|| PROFILES : "managed identity"')
    expect(diagram).toContain('Supabase-managed external source')
  })
})
