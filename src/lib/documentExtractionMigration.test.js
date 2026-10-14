import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007100000_document_extraction_foundation.sql', 'utf8').toLowerCase()

describe('Phase I document extraction foundation migration contract', () => {
  it('stores runs and facts with patient, document, extraction and locator provenance', () => {
    expect(sql).toContain('create table public.document_extractions')
    expect(sql).toContain('create table public.document_extracted_facts')
    expect(sql).toContain('foreign key (extraction_id, clinical_document_id, patient_id)')
    expect(sql).toContain('source_page integer')
    expect(sql).toContain('source_section text')
    expect(sql).toContain('source_excerpt text')
    expect(sql).toContain('confidence numeric(5,4)')
    expect(sql).toContain("default 'needs_review'")
  })

  it('derives patient identity from auth.uid and accepts no browser patient identifier', () => {
    const requestFunction = sql.slice(sql.indexOf('create function public.request_my_document_extraction'))
    expect(requestFunction).toContain('auth.uid()')
    expect(requestFunction).toContain('patient.auth_user_id = caller')
    expect(requestFunction).toContain('patient.profile_id = caller')
    expect(requestFunction).toContain('document.patient_id = patient_row.id')
    expect(requestFunction).toContain("document.status = 'active'")
    expect(requestFunction).toContain("public.can_access_patient(document.patient_id, 'clinical')")
    expect(requestFunction).toContain('storage.objects')
    expect(requestFunction).not.toMatch(/p_patient_id|p_profile_id|p_user_id/)
    expect(sql).toContain('grant execute on function public.request_my_document_extraction(uuid) to authenticated')
    expect(sql).toContain('from public, anon')
  })

  it('keeps extraction and fact writes out of browser roles', () => {
    expect(sql).toContain('revoke all on public.document_extractions, public.document_extracted_facts from public, anon, authenticated')
    expect(sql).toContain('grant select, insert, update on public.document_extractions, public.document_extracted_facts to service_role')
    expect(sql).not.toMatch(/grant\s+(all|insert|update|delete|select\s*,\s*(insert|update|delete))[^;]*\bto authenticated/)
  })

  it('does not touch authoritative clinical records or trigger extraction from uploads', () => {
    expect(sql).not.toMatch(/insert\s+into\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules)/)
    expect(sql).not.toMatch(/create\s+trigger[^;]*\bon\s+public\.clinical_documents/)
    expect(sql).not.toMatch(/ai_provider_api_key|openai|fetch\s*\(/)
  })
})
