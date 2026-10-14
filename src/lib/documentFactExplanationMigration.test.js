import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007140000_document_fact_plain_language_explanations.sql', 'utf8').toLowerCase()

describe('Phase I Step 5 explanation migration contract', () => {
  it('stores a distinct explanation payload on candidate facts only', () => {
    expect(sql).toContain('add column plain_language_explanation jsonb')
    expect(sql).toContain('document_extracted_facts')
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules|providers)/)
  })

  it('allows only the trusted server persistence function and verifies linked source ownership', () => {
    expect(sql).toContain("auth.role() <> 'service_role'")
    expect(sql).toContain('p_owner_profile_id')
    expect(sql).toContain('run.requested_by_profile_id = p_owner_profile_id')
    expect(sql).toContain("source.status = 'active'")
    expect(sql).toContain("source.source = 'patient_upload'")
    expect(sql).toContain('source.storage_bucket = \'medical-documents\'')
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
  })

  it('keeps explanation provenance synchronized with review and clears rejected facts', () => {
    expect(sql).toContain("if new.review_status = 'rejected' then")
    expect(sql).toContain('new.plain_language_explanation := null')
    expect(sql).toContain("'{source_reference,review_state}'")
    expect(sql).toContain('not clinician confirmation')
  })
})
