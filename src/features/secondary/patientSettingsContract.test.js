import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(process.cwd(), 'src/features/secondary/PatientSettingsPage.jsx'), 'utf8')
const repository = readFileSync(join(process.cwd(), 'src/services/repositories/supabaseRepository.js'), 'utf8')

describe('real patient settings contract', () => {
  it('removes patient provider-application entry points and the route', () => {
    expect(page).not.toContain('Apply as Healthcare Provider')
    expect(page).not.toContain('/provider/apply')
    const routes = readFileSync(join(process.cwd(),'src/App.jsx'),'utf8')
    expect(routes).not.toContain('ProviderApplicationPage')
    expect(routes).not.toContain('path="/provider/apply"')
  })
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

  it('uses the shared patient-reported intake and retires the care_preferences clinical text editor', () => {
    expect(page).toContain('<PatientReportedHealthIntake />')
    expect(page).not.toContain('care_preferences')
    expect(page).not.toContain('existingMedicalConditions')
    expect(page).not.toContain('currentMedications')
    expect(repository).not.toContain('care_preferences, status')
  })
})
