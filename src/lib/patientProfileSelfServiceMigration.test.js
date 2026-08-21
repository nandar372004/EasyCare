import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260821103000_patient_profile_self_service.sql'), 'utf8').toLowerCase()

describe('patient profile self-service migration', () => {
  it('grants only explicit profile select and safe update columns', () => {
    expect(sql).toContain('grant select (')
    expect(sql).toContain('grant update (')
    expect(sql).toContain('care_preferences')
    const updateGrant = sql.slice(sql.indexOf('grant update ('), sql.indexOf(') on table public.patients to authenticated', sql.indexOf('grant update (')))
    for (const protectedField of ['id', 'auth_user_id', 'primary_phone', 'status', 'created_at']) {
      expect(updateGrant).not.toMatch(new RegExp(`\\b${protectedField}\\b`))
    }
  })

  it('restricts updates to the current Auth user while preserving RLS', () => {
    expect(sql).toContain('using (auth_user_id = auth.uid())')
    expect(sql).toContain('with check (auth_user_id = auth.uid())')
    expect(sql).not.toContain('disable row level security')
    expect(sql).not.toMatch(/grant[^;]+to\s+(anon|public)\b/)
  })
})
