import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repository = readFileSync(join(process.cwd(), 'src/services/repositories/supabaseRepository.js'), 'utf8')
const page = readFileSync(join(process.cwd(), 'src/features/health/HealthPages.jsx'), 'utf8')
const dashboard = readFileSync(join(process.cwd(), 'src/features/dashboard/DashboardPage.jsx'), 'utf8')
const search = readFileSync(join(process.cwd(), 'src/components/GlobalSearch.jsx'), 'utf8')

describe('real medication frontend contract', () => {
  it('requires a valid patient UUID before querying the normalized table', () => {
    expect(repository).toContain("if (!UUID_PATTERN.test(patientId ?? ''))")
    expect(repository).toContain("from('patient_medications').select(PATIENT_MEDICATION_SELECT).eq('patient_id', patientId)")
    expect(repository).not.toContain("medications).select('*')")
  })

  it('uses AuthContext patient id in every medication caller', () => {
    expect(page).toContain('presentationRepository.listMedications(patient.id)')
    expect(dashboard).toContain('const patientId = auth.patient?.id')
    expect(dashboard).toContain('loadDashboardPage(patientId)')
    expect(search).toContain('presentationRepository.listMedications(patient.id)')
    expect(`${page}${dashboard}${search}`).not.toContain('listMedications()')
  })

  it('keeps dashboard medication errors isolated', () => {
    expect(dashboard).toContain("section={state('medications')}")
    expect(dashboard).toContain('No dose event recorded')
  })
})
