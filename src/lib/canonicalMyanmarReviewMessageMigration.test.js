import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261007160000_canonical_myanmar_confirmed_review_message.sql', 'utf8')
const canonical = 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။'
const alternate = 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ।'

describe('canonical Myanmar confirmed-review migration', () => {
  it('uses one Myanmar punctuation form in save validation and review-state projection', () => {
    expect(sql.match(new RegExp(canonical, 'gu'))).toHaveLength(3)
    expect(sql.split(alternate)).toHaveLength(2) // one occurrence only in the guarded data-repair predicate
  })

  it('repairs only the existing confirmed explanation message and preserves provenance fields', () => {
    expect(sql).toContain("where review_status = 'confirmed'")
    expect(sql).toContain("plain_language_explanation->'source_reference'->>'review_state' = 'confirmed'")
    expect(sql).toContain("'{review_message_my}'")
    expect(sql).not.toMatch(/update\s+public\.(patient_conditions|patient_allergies|patient_medications|prescriptions|care_plans|medication_schedules)/i)
  })

  it('preserves English review strings and rejected-state clearing', () => {
    expect(sql).toContain("'Patient reviewed. This is not clinician confirmation.'")
    expect(sql).toContain("new.review_status = 'rejected'")
    expect(sql).toContain('new.plain_language_explanation := null')
  })
})
