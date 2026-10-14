// @vitest-environment node
// Actual PostgreSQL/WASM migrations and policies; managed Auth is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929110000_patient_conditions_allergies_metadata.sql'
const uid = (n) => `74000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 4 patient conditions and allergies', () => {
  let db, patients, conditionsBefore, allergiesBefore, policiesBefore, oidsBefore

  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `)
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    for (const n of [1, 2, 3, 4, 5]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    patients = []
    for (const n of [1, 2]) {
      patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
        userId: uid(n), fullName: 'Synthetic Patient', phone: `+95976000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: {},
      })])).rows[0].id)
    }
    for (const [n, role] of [[3, 'doctor'], [4, 'nurse'], [5, 'doctor']]) {
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [uid(n), role, `Synthetic ${role}`])
      const provider = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [uid(n), role])).rows[0].id
      if (n !== 5) {
        const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [patients[0], uid(1)])).rows[0].id
        await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, provider, uid(3)])
      }
    }
    await db.query(`insert into public.patient_conditions(patient_id, condition_name, status, diagnosed_at, recorded_by, notes)
      values ($1, 'Synthetic active condition', 'active', '2020-01-01', $3, 'Keep this note'),
        ($1, 'Synthetic resolved condition', 'resolved', null, null, null),
        ($1, 'Synthetic historical condition', 'historical', null, null, null),
        ($2, 'Private other condition', 'active', null, null, null)`, [patients[0], patients[1], uid(3)])
    await db.query(`insert into public.patient_allergies(patient_id, allergen, reaction, severity, status, recorded_by)
      values ($1, 'Synthetic allergen', 'Original reaction', 'mild', 'active', $3),
        ($1, 'Historical allergen', null, null, 'inactive', null),
        ($2, 'Private other allergen', null, null, 'active', null)`, [patients[0], patients[1], uid(3)])
    conditionsBefore = (await db.query('select * from public.patient_conditions order by id')).rows
    allergiesBefore = (await db.query('select * from public.patient_allergies order by id')).rows
    policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' and policyname <> 'allergies_provider_create' order by tablename, policyname")).rows
    oidsBefore = (await db.query("select oid, relname from pg_class where oid in ('public.patient_conditions'::regclass, 'public.patient_allergies'::regclass) order by relname")).rows
    await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('preserves both existing tables and every historical field without inferring new facts', async () => {
    expect((await db.query("select oid, relname from pg_class where oid in ('public.patient_conditions'::regclass, 'public.patient_allergies'::regclass) order by relname")).rows).toEqual(oidsBefore)
    const conditions = (await db.query('select * from public.patient_conditions order by id')).rows
    expect(conditions.map(({ code_system, condition_code, severity, onset_date, resolved_date, ...old }) => old)).toEqual(conditionsBefore)
    expect(conditions.every((row) => ['code_system', 'condition_code', 'severity', 'onset_date', 'resolved_date'].every((field) => row[field] === null))).toBe(true)
    const allergies = (await db.query('select * from public.patient_allergies order by id')).rows
    expect(allergies.map(({ allergen_type, onset_date, verified_by_profile_id, verified_at, ...old }) => old)).toEqual(allergiesBefore)
    expect(allergies.every((row) => ['allergen_type', 'onset_date', 'verified_by_profile_id', 'verified_at'].every((field) => row[field] === null))).toBe(true)
  })

  it('preserves all unrelated policies and adds patient lookup indexes', async () => {
    expect((await db.query("select * from pg_policies where schemaname = 'public' and policyname <> 'allergies_provider_create' order by tablename, policyname")).rows).toEqual(policiesBefore)
    const indexes = (await db.query("select indexdef from pg_indexes where schemaname = 'public' and indexname in ('patient_conditions_patient_idx', 'patient_allergies_patient_idx')")).rows
    expect(indexes).toHaveLength(2)
    expect(indexes.every((index) => index.indexdef.includes('(patient_id)'))).toBe(true)
  })

  it('retrieves the current patient conditions', async () => {
    await actor(1)
    const { rows } = await db.query('select patient_id, condition_name from public.patient_conditions where patient_id = $1', [patients[0]])
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.patient_id === patients[0])).toBe(true)
  })

  it.each(['active', 'resolved', 'historical'])('filters %s conditions, preserving resolved legacy rows without dates', async (status) => {
    await actor(1)
    const { rows } = await db.query('select status, resolved_date from public.patient_conditions where patient_id = $1 and status = $2', [patients[0], status])
    expect(rows).toEqual([{ status, resolved_date: null }])
  })

  it('retrieves active and inactive allergies with existing reaction and severity intact', async () => {
    await actor(1)
    const { rows } = await db.query('select allergen, reaction, severity, status from public.patient_allergies where patient_id = $1 order by status', [patients[0]])
    expect(rows).toEqual([
      { allergen: 'Synthetic allergen', reaction: 'Original reaction', severity: 'mild', status: 'active' },
      { allergen: 'Historical allergen', reaction: null, severity: null, status: 'inactive' },
    ])
  })

  it.each([1, 2])('isolates patient %s across both tables, including unfiltered queries', async (n) => {
    await actor(n)
    for (const table of ['patient_conditions', 'patient_allergies']) {
      const { rows } = await db.query(`select patient_id from public.${table}`)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.patient_id === patients[n - 1])).toBe(true)
      expect((await db.query(`select id from public.${table} where patient_id = $1`, [patients[n === 1 ? 1 : 0]])).rows).toEqual([])
    }
  })

  it.each([3, 4])('permits assigned clinical user %s to read only the authorized patient', async (n) => {
    await actor(n)
    for (const table of ['patient_conditions', 'patient_allergies']) {
      const { rows } = await db.query(`select patient_id from public.${table}`)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.patient_id === patients[0])).toBe(true)
    }
  })

  it('denies unrelated clinical and anonymous reads even with broad SELECT grants', async () => {
    await db.exec('grant select on public.patient_conditions, public.patient_allergies to anon')
    await actor(5)
    for (const table of ['patient_conditions', 'patient_allergies']) expect((await db.query(`select id from public.${table}`)).rows).toEqual([])
    await db.exec('reset role')
    await actor(null, 'anon')
    for (const table of ['patient_conditions', 'patient_allergies']) expect((await db.query(`select id from public.${table}`)).rows).toEqual([])
  })

  it('allows an assigned doctor to record a coded condition without changing legacy columns', async () => {
    await actor(3)
    const { rows } = await db.query(`insert into public.patient_conditions(patient_id, condition_name, status, recorded_by,
      code_system, condition_code, severity, onset_date, resolved_date)
      values ($1, 'Synthetic coded condition', 'resolved', $2, 'local-test-v1', 'TEST-1', 'mild', '2020-01-01', '2021-01-01') returning *`, [patients[0], uid(3)])
    expect(rows[0]).toMatchObject({ code_system: 'local-test-v1', condition_code: 'TEST-1', severity: 'mild', status: 'resolved' })
  })

  it.each([3, 4])('allows assigned clinician %s to record a self-verified allergy', async (n) => {
    await actor(n)
    const { rows } = await db.query(`insert into public.patient_allergies(patient_id, allergen, recorded_by, allergen_type,
      onset_date, verified_by_profile_id, verified_at) values ($1, 'Synthetic food', $2, 'food', '2020-01-01', $2, now()) returning verified_by_profile_id`, [patients[0], uid(n)])
    expect(rows).toEqual([{ verified_by_profile_id: uid(n) }])
  })

  it('keeps the legacy allergy insert payload valid and unverified', async () => {
    await actor(3)
    const { rows } = await db.query('insert into public.patient_allergies(patient_id, allergen, recorded_by) values ($1, $2, $3) returning verified_by_profile_id, verified_at', [patients[0], 'Legacy payload', uid(3)])
    expect(rows).toEqual([{ verified_by_profile_id: null, verified_at: null }])
  })

  it('prevents impersonating another verifier even with broad INSERT privileges', async () => {
    await db.exec('grant insert on public.patient_allergies to authenticated')
    await actor(3)
    await expect(db.query("insert into public.patient_allergies(patient_id, allergen, recorded_by, verified_by_profile_id, verified_at) values ($1, 'Synthetic', $2, $3, now())", [patients[0], uid(3), uid(4)])).rejects.toMatchObject({ code: '42501' })
  })

  it('retains doctor-only condition creation', async () => {
    await actor(4)
    await expect(db.query("insert into public.patient_conditions(patient_id, condition_name, status, recorded_by) values ($1, 'Synthetic', 'active', $2)", [patients[0], uid(4)])).rejects.toMatchObject({ code: '42501' })
  })

  it('does not permit patients to create clinical records', async () => {
    await actor(1)
    await db.exec('savepoint denied')
    await expect(db.query("insert into public.patient_conditions(patient_id, condition_name, status, recorded_by) values ($1, 'Synthetic', 'active', $2)", [patients[0], uid(1)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied')
    await expect(db.query("insert into public.patient_allergies(patient_id, allergen, recorded_by) values ($1, 'Synthetic', $2)", [patients[0], uid(1)])).rejects.toMatchObject({ code: '42501' })
  })

  it.each([
    ['patient_conditions', "code_system = 'ICD-10'"],
    ['patient_conditions', "condition_code = 'TEST-1'"],
    ['patient_conditions', "code_system = ' ', condition_code = 'TEST-1'"],
    ['patient_conditions', "code_system = 'local', condition_code = repeat('x', 101)"],
    ['patient_conditions', "severity = 'invalid'"],
    ['patient_conditions', "onset_date = 'infinity'"],
    ['patient_conditions', "status = 'resolved', resolved_date = 'infinity'"],
    ['patient_conditions', "status = 'active', resolved_date = '2020-01-01'"],
    ['patient_conditions', "status = 'resolved', onset_date = '2021-01-01', resolved_date = '2020-01-01'"],
    ['patient_allergies', "allergen_type = 'invalid'"],
    ['patient_allergies', "onset_date = '-infinity'"],
    ['patient_allergies', 'verified_at = now()'],
    ['patient_allergies', `verified_by_profile_id = '${uid(3)}'`],
    ['patient_allergies', `verified_by_profile_id = '${uid(3)}', verified_at = 'infinity'`],
  ])('rejects invalid %s metadata (case %#)', async (table, changes) => {
    await expect(db.query(`update public.${table} set ${changes} where patient_id = $1`, [patients[0]])).rejects.toMatchObject({ code: '23514' })
  })

  it('enforces the allergy verifier foreign key', async () => {
    await expect(db.query('update public.patient_allergies set verified_by_profile_id = $1, verified_at = now() where patient_id = $2', [uid(99), patients[0]])).rejects.toMatchObject({ code: '23503' })
  })
})
