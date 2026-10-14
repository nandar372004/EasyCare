import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261010100000_doctor_professional_information.sql'), 'utf8')

describe('doctor professional information privacy migration', () => {
  it('stores the requested details without approval workflow fields', () => {
    for (const field of ['nrc', 'date_of_birth', 'work_experience_years', 'current_hospital', 'medical_qualification', 'mmc_registration_number', 'medical_practitioner_license_number', 'license_type']) {
      expect(migration).toContain(field)
    }
    expect(migration).not.toMatch(/verification_status|approved|rejected|changes_required|admin_review/i)
  })

  it('restricts all professional information operations to its doctor owner', () => {
    expect(migration).toContain('alter table public.doctor_professional_information enable row level security')
    expect(migration).toMatch(/provider\.profile_id = auth\.uid\(\) and provider\.provider_type = 'doctor'/)
    expect(migration).toContain('for select to authenticated')
    expect(migration).toContain('for insert to authenticated')
    expect(migration).toContain('for update to authenticated')
    expect(migration).toContain('for delete to authenticated')
  })

  it('keeps uploaded licenses private and limits accepted file types and size', () => {
    expect(migration).toContain("'doctor-medical-licenses', 'doctor-medical-licenses', false, 10485760")
    expect(migration).toContain("array['application/pdf','image/jpeg','image/png']")
    expect(migration).toContain("bucket_id = 'doctor-medical-licenses' and (storage.foldername(name))[1] = auth.uid()::text")
  })
})
