import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007130000_document_extracted_fact_review_workflow.sql', 'utf8').toLowerCase()

describe('Phase I Step 4 review migration contract', () => {
  it('defines explanatory confidence bands and review audit fields', () => {
    expect(sql).toContain("then 'high'")
    expect(sql).toContain("then 'medium'")
    expect(sql).toContain("else 'low'")
    expect(sql).toContain('reviewed_by_profile_id')
    expect(sql).toContain('reviewed_at')
    expect(sql).toContain('review_note')
    expect(sql).toContain('create table public.document_extracted_fact_reviews')
  })

  it('exposes only an authenticated owner-bound review function', () => {
    expect(sql).toContain('caller uuid := auth.uid()')
    expect(sql).toContain('patient.auth_user_id = caller')
    expect(sql).toContain('patient.profile_id = caller')
    expect(sql).toContain("grant execute on function public.review_my_document_extracted_fact(uuid,text,text) to authenticated")
    expect(sql).toContain('from public, anon, service_role')
    expect(sql).toContain("p_decision not in ('confirmed','rejected')")
  })

  it('records a one-way decision atomically without writing canonical clinical truth', () => {
    expect(sql).toContain("candidate.review_status = 'needs_review'")
    expect(sql).toContain('insert into public.document_extracted_fact_reviews')
    expect(sql).toContain('reviewer_profile, review_time, clean_note')
    expect(sql).toContain('constraint document_extracted_fact_reviews_once unique (fact_id)')
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules|providers)/)
  })

  it('keeps review audit details unavailable to browser table access', () => {
    expect(sql).toContain('alter table public.document_extracted_fact_reviews enable row level security')
    expect(sql).toContain('revoke all on public.document_extracted_fact_reviews from public, anon, authenticated')
  })
})
