// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const userId = '72000000-0000-4000-8000-000000000001'
let db

describe('minimal registration and consent migration replay', () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create schema storage;
      create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
    `)
    const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
    for (const name of migrations) await db.exec(readFileSync(join(directory, name), 'utf8'))
    await db.query('insert into auth.users(id) values ($1)', [userId])
  }, 60000)

  afterAll(async () => { await db?.close() })

  it('creates a minimal patient and independently records exact document identifiers, versions, actor, and timestamps', async () => {
    const result = await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId,
      fullName: 'Ei Ei San',
      phone: '+959963254323',
      dateOfBirth: '1977-06-09',
      termsAccepted: true,
      privacyConsent: true,
      role: 'doctor',
      providerId: 'arbitrary-client-value',
      medicalProfile: { allergies: 'must not persist' },
    })])
    const patientId = result.rows[0].id
    const identity = (await db.query(
      'select p.id, p.profile_id, p.auth_user_id, p.gender, p.city, p.care_preferences, pr.role from public.patients p join public.profiles pr on pr.id=p.profile_id where p.id=$1',
      [patientId],
    )).rows[0]
    expect(identity).toEqual({
      id: patientId,
      profile_id: userId,
      auth_user_id: userId,
      gender: null,
      city: null,
      care_preferences: {},
      role: 'patient',
    })
    const evidence = (await db.query(
      'select document_key, consent_type, version, status, granted_by_profile_id, granted_at from public.consents where patient_id=$1 order by document_key',
      [patientId],
    )).rows
    expect(evidence).toHaveLength(2)
    expect(evidence.map(({ document_key, consent_type, version, status, granted_by_profile_id, granted_at }) => ({
      document_key, consent_type, version, status, granted_by_profile_id, hasTimestamp: Boolean(granted_at),
    }))).toEqual([
      { document_key: 'privacy_policy', consent_type: 'privacy_policy', version: 'privacy-v1', status: 'granted', granted_by_profile_id: userId, hasTimestamp: true },
      { document_key: 'terms_of_service', consent_type: 'terms_of_service', version: 'terms-v1', status: 'granted', granted_by_profile_id: userId, hasTimestamp: true },
    ])
    expect((await db.query('select count(*)::int as count from public.providers where profile_id=$1', [userId])).rows[0].count).toBe(0)
  })

  it('rejects an explicitly unchecked acknowledgment at the database boundary', async () => {
    await db.query('insert into auth.users(id) values ($1)', ['72000000-0000-4000-8000-000000000002'])
    await expect(db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify({
      userId: '72000000-0000-4000-8000-000000000002',
      fullName: 'Missing Consent', phone: '+959770000002', dateOfBirth: '1995-04-12',
      termsAccepted: true, privacyConsent: false,
    })])).rejects.toThrow('Required registration acknowledgements missing')
  })
})
