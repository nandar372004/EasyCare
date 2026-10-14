// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync('supabase/migrations/20261011110000_ai_guardian_rate_limit.sql', 'utf8')
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const hashC = 'c'.repeat(64)
const hashD = 'd'.repeat(64)

describe('AI Guardian rate limit RPC', () => {
  let db

  async function setRole(role) {
    await db.query("select set_config('request.jwt.claim.role', $1, false)", [role])
    await db.exec(`set role ${role}`)
  }

  async function resetRole() {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.role', '', false)")
  }

  async function consume(hash, limit = 2) {
    return (await db.query(
      'select public.consume_auth_rate_limit($1, $2, $3, $4) as allowed',
      [hash, 'ai_guardian_user', limit, 900],
    )).rows[0].allowed
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.role() returns text language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `)
    await db.exec(migration)
  })

  afterAll(async () => { await db?.close() })

  it('allows the first request, counts repeats, and denies requests at the limit', async () => {
    await setRole('service_role')
    expect(await consume(hashA)).toBe(true)
    expect(await consume(hashA)).toBe(true)
    expect(await consume(hashA)).toBe(false)
    expect(await consume(hashA)).toBe(false)
    await resetRole()
  })

  it('isolates different authenticated-user hashes', async () => {
    await setRole('service_role')
    expect(await consume(hashC, 1)).toBe(true)
    expect(await consume(hashC, 1)).toBe(false)
    expect(await consume(hashD, 1)).toBe(true)
    await resetRole()
  })

  it('denies anonymous and authenticated database roles and exposes no cross-user state', async () => {
    for (const role of ['anon', 'authenticated']) {
      await setRole(role)
      await expect(consume(hashA)).rejects.toThrow(/permission denied/i)
      await expect(db.query('select * from public.auth_rate_limits')).rejects.toThrow(/permission denied/i)
      await resetRole()
    }

    await setRole('service_role')
    await consume(hashA)
    await consume(hashB)
    await expect(db.query('select * from public.auth_rate_limits')).rejects.toThrow(/permission denied/i)
    await resetRole()
  })
})
