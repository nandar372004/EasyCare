import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(process.cwd(), 'src/features/secondary/PatientSettingsPage.jsx'), 'utf8')
const repository = readFileSync(join(process.cwd(), 'src/services/repositories/supabaseRepository.js'), 'utf8')

describe('real patient settings contract', () => {
  it('loads and updates only the authenticated patient row', () => {
    expect(repository).toContain(".eq('id', patientId).eq('auth_user_id', authUserId)")
    expect(repository).not.toContain("patients').select('*'")
    expect(page).toContain('patientId: patient.id')
    expect(page).toContain('authUserId: user.id')
  })

  it('keeps login identity read-only and synchronizes AuthContext', () => {
    expect(page).toContain("value={profile.primary_phone ?? ''} readOnly")
    expect(page).toContain('synchronizePatient(updated)')
    expect(page).not.toMatch(/primary_phone\s*:/)
  })

  it('preserves unrelated care preference keys', () => {
    expect(page).toContain('...(profile?.care_preferences ?? {})')
    expect(page).toContain("allergies: form.noKnownAllergies ? '' : form.allergies.trim()")
  })
})
