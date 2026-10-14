import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007120000_structured_health_fact_extraction.sql', 'utf8').toLowerCase()

describe('Phase I Step 3 structured health-fact migration contract', () => {
  it('extends only the existing candidate fact model with structured source details', () => {
    expect(sql).toContain('alter table public.document_extracted_facts')
    expect(sql).toContain('procedure_candidate')
    expect(sql).toContain('follow_up_candidate')
    for (const column of ['abnormal_flag', 'strength_text', 'form_text', 'frequency_text', 'instruction_text', 'recommended_at', 'source_context', 'observed_at_time']) {
      expect(sql).toContain(`add column ${column}`)
    }
    expect(sql).toContain('document_extracted_facts_source_dedupe_uidx')
  })

  it('limits persistence to trusted server role and always sets needs_review', () => {
    expect(sql).toContain('auth.role() <> \'service_role\'')
    expect(sql).toContain("'needs_review'")
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto authenticated/)
  })

  it('rechecks classified source ownership, active patient identity, document status and object existence', () => {
    expect(sql).toContain("run.extraction_status <> 'needs_review'")
    expect(sql).toContain('document.status = \'active\'')
    expect(sql).toContain("document.source = 'patient_upload'")
    expect(sql).toContain('patient.auth_user_id = run.requested_by_profile_id')
    expect(sql).toContain('patient.profile_id = run.requested_by_profile_id')
    expect(sql).toContain('storage.objects')
  })

  it('enforces locator and human-review provenance and writes no clinical truth', () => {
    expect(sql).toContain("nullif(btrim(item->'sourcelocator'->>'excerpt'), '') is null")
    expect(sql).toContain("item->>'reviewrequired' <> 'true'")
    expect(sql).toContain('source_page, source_section, source_excerpt')
    expect(sql).toContain('on conflict do nothing')
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules|providers)/)
  })
})
