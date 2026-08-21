import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/features/doctors/DoctorsPage.jsx'), 'utf8')

describe('doctor booking patient identity', () => {
  it('uses the patient hydrated by AuthContext without a duplicate lookup', () => {
    expect(source).toContain("import { useAuth } from '../auth/AuthContext.jsx'")
    expect(source).toContain('const { patient, status: authStatus } = useAuth()')
    expect(source).not.toContain('presentationRepository.getCurrentPatient()')
  })

  it('uses the patient row id and shows the patient full name read-only', () => {
    expect(source).toContain('patientId: patient.id')
    expect(source).toContain("patient?.full_name ?? 'Unable to load your patient account.'")
    expect(source).not.toMatch(/<select[^>]*>\s*<option[^>]*>\{patient/)
  })

  it('distinguishes hydration from a missing patient account', () => {
    expect(source).toContain("const patientLoading = authStatus === 'loading'")
    expect(source).toContain('Unable to load your patient account.')
  })
})
