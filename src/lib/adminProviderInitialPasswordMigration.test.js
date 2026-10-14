import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20261009130000_admin_provider_initial_password.sql', 'utf8')

describe('admin-created provider password migration contract', () => {
  it('reuses provider setup state and defaults existing providers to no forced password change', () => {
    expect(migration).toMatch(/add column must_change_password boolean not null default false/i)
    expect(migration).toMatch(/setup_state='setup_required'/i)
  })

  it('provisions only the four supported types with a server-managed password-change flag', () => {
    expect(migration).toMatch(/p_provider_type::text not in \('doctor','nurse_aide','skilled_nurse_aide','special_nurse'\)/i)
    expect(migration).toMatch(/account_status,setup_state,must_change_password\)[\s\S]*'active','setup_required',true/i)
    expect(migration).toMatch(/new\.must_change_password is distinct from old\.must_change_password and auth\.uid\(\) is not null/i)
  })

  it('allows only service role to clear the flag and blocks provider setup while it remains true', () => {
    expect(migration).toMatch(/complete_provider_initial_password_change\(uuid\)/i)
    expect(migration).toMatch(/revoke all on function public\.complete_provider_initial_password_change\(uuid\) from public,anon,authenticated/i)
    expect(migration).toMatch(/grant execute on function public\.complete_provider_initial_password_change\(uuid\) to service_role/i)
    expect(migration).toMatch(/coalesce\(must_change,true\)/i)
  })

  it('does not alter RLS policies or enable/disable row-level security', () => {
    expect(migration).not.toMatch(/\b(?:enable|disable) row level security\b/i)
    expect(migration).not.toMatch(/\bcreate policy\b/i)
    expect(migration).not.toMatch(/\bdrop policy\b/i)
  })
})
