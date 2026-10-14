import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007150000_bilingual_document_fact_explanations.sql', 'utf8').toLowerCase()

describe('forward-only bilingual explanation migration', () => {
  it('changes only candidate explanation persistence and review projection', () => {
    expect(sql).toContain('create or replace function public.save_my_document_fact_explanation')
    expect(sql).toContain('create or replace function public.sync_document_fact_explanation_review_state')
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules)/)
    expect(sql).toContain("new.review_status = 'rejected'")
    expect(sql).toContain('new.plain_language_explanation := null')
  })

  it('requires server-only persistence, ownership, exact bilingual keys, and needs-review state', () => {
    expect(sql).toContain("auth.role() <> 'service_role'")
    expect(sql).toContain('jsonb_object_keys(p_explanation_fields)) <> 14')
    expect(sql).toContain("'translation_status'")
    expect(sql).toContain("'source_assertion'")
    expect(sql).toContain('run.requested_by_profile_id = p_owner_profile_id')
    expect(sql).toContain("candidate.review_status in ('needs_review','confirmed')")
    expect(sql).toContain('grant execute on function public.save_my_document_fact_explanation(uuid,uuid,jsonb) to service_role')
  })

  it('keeps the currently deployed six-field English writer compatible until Edge Function deployment', () => {
    expect(sql).toContain('is_legacy_english')
    expect(sql).toContain('p_explanation_fields ?& legacy_fields')
    expect(sql).toContain("p_explanation_fields->>'review_message'")
    expect(sql).toContain('this item was patient-reviewed and confirmed. this is not clinician confirmation.')
  })
})
