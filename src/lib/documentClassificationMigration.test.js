import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOCUMENT_CLASSIFICATION_TYPES } from '../../supabase/functions/_shared/document-classification-contract.js'

const sql = readFileSync('supabase/migrations/20261007110000_document_classification_candidates.sql', 'utf8').toLowerCase()

describe('Step 2 classification migration scope', () => {
  it('stores classification in the existing extraction foundation without duplicate enums or tables', () => {
    expect(sql).toContain('alter table public.document_extractions')
    for (const type of DOCUMENT_CLASSIFICATION_TYPES) expect(sql).toContain(`'${type}'`)
    expect(sql).not.toMatch(/create\s+(table|type)/)
    expect(sql).toContain('classification_review_required boolean not null default true')
  })

  it('restricts candidate persistence to the trusted service role', () => {
    expect(sql).toContain('from public, anon, authenticated')
    expect(sql).toContain('to service_role')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain('for share of patient, profile')
  })

  it('writes only extraction metadata, never source type, clinical truth, or detailed facts', () => {
    const writes = [...sql.matchAll(/\b(insert\s+into|update|delete\s+from|alter\s+table)\s+public\.(\w+)/g)].map(match => match[2])
    expect(writes.length).toBeGreaterThan(0)
    expect(new Set(writes)).toEqual(new Set(['document_extractions']))
    expect(sql).not.toMatch(/create\s+trigger/)
  })
})
