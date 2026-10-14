import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261010110000_doctor_professional_information_owner_identity_policies.sql'), 'utf8')

describe('doctor professional information owner identity policy migration', () => {
  it('uses the existing authenticated provider setup identity helper for doctor ownership', () => {
    expect(migration.match(/public\.get_my_provider_setup_identity\(\)/g)).toHaveLength(10)
    expect(migration.match(/identity\.provider_type::text = 'doctor'/g)).toHaveLength(10)
    expect(migration).not.toMatch(/from\s+public\.providers\b/i)
    expect(migration).not.toMatch(/grant\s+select\s+on\s+public\.providers/i)
  })

  it('keeps license file access scoped to the signed-in owner and their provider id folder', () => {
    expect(migration.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g)).toHaveLength(5)
    expect(migration.match(/identity\.provider_id::text = \(storage\.foldername\(name\)\)\[2\]/g)).toHaveLength(5)
  })

  it('replaces only doctor professional information and license object policies', () => {
    expect(migration).toMatch(/drop policy if exists doctor_professional_information_owner_read on public\.doctor_professional_information/i)
    expect(migration).toMatch(/drop policy if exists doctor_medical_license_owner_read on storage\.objects/i)
    expect(migration).not.toMatch(/alter\s+table\s+public\.providers|create\s+policy\s+providers_|drop\s+policy\s+.*providers/i)
    expect(migration).not.toMatch(/alter\s+table\s+public\.doctor_professional_information\s+disable\s+row level security/i)
  })
})
