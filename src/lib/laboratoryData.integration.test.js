// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; only managed Auth is stubbed.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929120000_laboratory_data.sql'
const uid = (n) => `75000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 5 laboratory data', () => {
  let db, patients, providers, encounters, orders, results, patientsBefore, encountersBefore, policiesBefore

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
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `)
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    patients = []
    for (const n of [1, 2]) {
      patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
        userId: uid(n), fullName: 'Synthetic Lab Patient', phone: `+95975000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: {},
      })])).rows[0].id)
    }
    providers = {}
    for (const [n, role] of [[3, 'doctor'], [4, 'nurse'], [5, 'doctor'], [6, 'family'], [7, 'main_admin']]) {
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [uid(n), role, `Synthetic ${role}`])
      if (n <= 5) providers[n] = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [uid(n), role])).rows[0].id
    }
    encounters = []
    for (const i of [0, 1]) {
      const appointment = (await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
        scheduled_start, scheduled_end, consultation_channel, booking_code)
        values ($1, $2, 'teleconsultation', $3, $4, 'video', $5) returning id`,
      [patients[i], providers[i === 0 ? 3 : 5], `2026-09-${20 + i}T09:00Z`, `2026-09-${20 + i}T09:30Z`, `ECA-LAB-${i}`])).rows[0].id
      encounters.push((await db.query("insert into public.care_encounters(appointment_id, patient_id, provider_id, encounter_type) values ($1, $2, $3, 'teleconsultation') returning id", [appointment, patients[i], providers[i === 0 ? 3 : 5]])).rows[0].id)
    }
    const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [patients[0], uid(1)])).rows[0].id
    await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, providers[4], uid(3)])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', true)", [patients[0], uid(6)])
    patientsBefore = (await db.query('select * from public.patients order by id')).rows
    encountersBefore = (await db.query('select * from public.care_encounters order by id')).rows
    policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
    orders = []; results = []
    await db.exec('set role service_role')
    for (const i of [0, 1]) {
      orders.push((await db.query(`insert into public.lab_orders(patient_id, encounter_id, ordered_by_provider_id, laboratory_name, ordered_at)
        values ($1, $2, $3, 'Synthetic Laboratory', '2026-09-22T08:00Z') returning id`, [patients[i], encounters[i], providers[i === 0 ? 3 : 5]])).rows[0].id)
      results.push((await db.query(`insert into public.lab_results(lab_order_id, patient_id, test_code, test_name,
        value_numeric, unit, reference_low, reference_high, abnormal_flag, result_status, observed_at, verified_at)
        values ($1, $2, 'TEST-1', 'Synthetic quantitative test', 4.5, 'test-unit', 3, 6, 'normal', 'final',
          '2026-09-22T10:00Z', '2026-09-22T11:00Z') returning id`, [orders[i], patients[i]])).rows[0].id)
    }
    await db.exec('reset role')
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('creates requested fields and preserves existing records and policies', async () => {
    const expected = {
      lab_orders: ['id', 'patient_id', 'encounter_id', 'ordered_by_provider_id', 'order_code', 'status', 'laboratory_name', 'ordered_at', 'collected_at', 'completed_at', 'notes', 'created_at', 'updated_at'],
      lab_results: ['id', 'lab_order_id', 'patient_id', 'test_code', 'test_name', 'value_numeric', 'value_text', 'unit', 'reference_low', 'reference_high', 'abnormal_flag', 'result_status', 'observed_at', 'verified_at', 'created_at', 'updated_at'],
    }
    for (const [table, names] of Object.entries(expected)) {
      expect((await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [table])).rows.map((row) => row.column_name)).toEqual(names)
    }
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(patientsBefore)
    expect((await db.query('select * from public.care_encounters order by id')).rows).toEqual(encountersBefore)
    expect((await db.query("select * from pg_policies where schemaname = 'public' and tablename not in ('lab_orders', 'lab_results') order by tablename, policyname")).rows).toEqual(policiesBefore)
  })

  it('supports trusted order completion, qualitative results, and repeated tests', async () => {
    await actor(null, 'service_role')
    await db.query("update public.lab_orders set status = 'completed', collected_at = '2026-09-22T09:00Z', completed_at = '2026-09-22T12:00Z' where id = $1", [orders[0]])
    const { rows } = await db.query(`insert into public.lab_results(lab_order_id, patient_id, test_code, test_name, value_text, result_status, verified_at)
      values ($1, $2, 'TEST-1', 'Synthetic qualitative test', 'Negative', 'final', now()) returning *`, [orders[0], patients[0]])
    expect(rows[0]).toMatchObject({ value_numeric: null, value_text: 'Negative', result_status: 'final', abnormal_flag: 'unknown' })
    expect((await db.query('select id from public.lab_results where lab_order_id = $1', [orders[0]])).rows).toHaveLength(2)
  })

  it('supports orders without encounters and pending results without fabricated values', async () => {
    await actor(null, 'service_role')
    const order = (await db.query('insert into public.lab_orders(patient_id, ordered_by_provider_id) values ($1, $2) returning *', [patients[0], providers[3]])).rows[0]
    expect(order.order_code).toMatch(/^LAB-[A-F0-9]{32}$/)
    expect(order.encounter_id).toBeNull()
    const result = (await db.query("insert into public.lab_results(lab_order_id, patient_id, test_name) values ($1, $2, 'Pending synthetic test') returning *", [order.id, patients[0]])).rows[0]
    expect(result).toMatchObject({ result_status: 'pending', value_numeric: null, value_text: null, observed_at: null, verified_at: null })
  })

  it.each([1, 2])('allows patient %s to retrieve only their own orders and results', async (n) => {
    await actor(n)
    for (const table of ['lab_orders', 'lab_results']) {
      expect((await db.query(`select patient_id from public.${table}`)).rows).toEqual([{ patient_id: patients[n - 1] }])
      expect((await db.query(`select id from public.${table} where patient_id = $1`, [patients[n === 1 ? 1 : 0]])).rows).toEqual([])
    }
  })

  it.each([[3, 0], [4, 0], [5, 1]])('allows clinician %s only their authorized patient', async (n, index) => {
    await actor(n)
    for (const table of ['lab_orders', 'lab_results']) expect((await db.query(`select patient_id from public.${table}`)).rows).toEqual([{ patient_id: patients[index] }])
  })

  it('denies provider reads when verification is suspended', async () => {
    await db.query("update public.providers set verification_status = 'suspended' where id = $1", [providers[3]])
    await actor(3)
    expect((await db.query('select id from public.lab_results')).rows).toEqual([])
  })

  it('does not extend generic family permissions to laboratory data', async () => {
    await actor(6)
    expect((await db.query("select public.can_access_patient($1, 'clinical') as allowed", [patients[0]])).rows[0].allowed).toBe(true)
    expect((await db.query('select id from public.lab_orders')).rows).toEqual([])
    expect((await db.query('select id from public.lab_results')).rows).toEqual([])
  })

  it('honors existing active main-admin clinical read authority', async () => {
    await actor(7)
    expect((await db.query('select id from public.lab_results')).rows).toHaveLength(2)
  })

  it('denies anonymous data access even if SELECT is later granted', async () => {
    await actor(null, 'anon')
    await db.exec('savepoint denied')
    await expect(db.query('select id from public.lab_results')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied; reset role; grant select on public.lab_orders, public.lab_results to anon; set local role anon')
    for (const table of ['lab_orders', 'lab_results']) expect((await db.query(`select id from public.${table}`)).rows).toEqual([])
  })

  it.each([1, 3, 4, 7])('denies browser user %s writes to verified laboratory results', async (n) => {
    await actor(n)
    await db.exec('savepoint denied')
    await expect(db.query('update public.lab_results set value_numeric = 99 where id = $1', [results[0]])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied')
    await expect(db.query('delete from public.lab_results where id = $1', [results[0]])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied')
    await expect(db.query("insert into public.lab_results(lab_order_id, patient_id, test_name) values ($1, $2, 'Forbidden')", [orders[0], patients[0]])).rejects.toMatchObject({ code: '42501' })
  })

  it('RLS still rejects patient writes under accidentally broad table grants', async () => {
    await db.exec('grant insert, update, delete on public.lab_orders, public.lab_results to authenticated')
    await actor(1)
    expect((await db.query('update public.lab_results set value_numeric = 99 where id = $1 returning id', [results[0]])).rows).toEqual([])
    expect((await db.query('delete from public.lab_results where id = $1 returning id', [results[0]])).rows).toEqual([])
    expect((await db.query("update public.lab_orders set status = 'cancelled' where id = $1 returning id", [orders[0]])).rows).toEqual([])
    await expect(db.query("insert into public.lab_results(lab_order_id, patient_id, test_name) values ($1, $2, 'Forbidden')", [orders[0], patients[0]])).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['patient_id', 'encounter_id', 'ordered_by_provider_id'])('rejects an invalid order %s foreign key', async (column) => {
    await expect(db.query(`update public.lab_orders set ${column} = $1 where id = $2`, [uid(99), orders[0]])).rejects.toMatchObject({ code: '23503' })
  })

  it.each(['lab_order_id', 'patient_id'])('rejects an invalid result %s foreign key', async (column) => {
    await expect(db.query(`update public.lab_results set ${column} = $1 where id = $2`, [uid(99), results[0]])).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects an encounter belonging to a different patient', async () => {
    await expect(db.query('update public.lab_orders set encounter_id = $1 where id = $2', [encounters[1], orders[0]])).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects a result whose order belongs to a different patient', async () => {
    await expect(db.query('update public.lab_results set lab_order_id = $1 where id = $2', [orders[1], results[0]])).rejects.toMatchObject({ code: '23503' })
  })

  it('prevents parent updates from invalidating encounter/order/result patient consistency', async () => {
    await db.exec('savepoint parent_change')
    await expect(db.query('update public.care_encounters set patient_id = $1 where id = $2', [patients[1], encounters[0]])).rejects.toMatchObject({ code: '23503' })
    await db.exec('rollback to savepoint parent_change')
    await expect(db.query('update public.lab_orders set encounter_id = null, patient_id = $1 where id = $2', [patients[1], orders[0]])).rejects.toMatchObject({ code: '23503' })
  })

  it('prevents deleting an order that has results', async () => {
    await db.exec('savepoint restricted_delete')
    // PostgreSQL versions report this as restrict_violation or FK violation.
    const error = await db.query('delete from public.lab_orders where id = $1', [orders[0]]).catch((error) => error)
    expect(['23001', '23503']).toContain(error.code)
    expect(error.constraint).toBe('lab_results_order_patient_fk')
    await db.exec('rollback to savepoint restricted_delete')
    expect((await db.query('select id from public.lab_orders where id = $1', [orders[0]])).rows).toHaveLength(1)
    expect((await db.query('select id from public.lab_results where id = $1', [results[0]])).rows).toHaveLength(1)
  })

  it('requires unique order codes', async () => {
    await expect(db.query('update public.lab_orders set order_code = (select order_code from public.lab_orders where id = $1) where id = $2', orders)).rejects.toMatchObject({ code: '23505' })
  })

  it.each([
    ['lab_orders', "order_code = ' '"], ['lab_orders', "status = 'invalid'"],
    ['lab_orders', "laboratory_name = ' '"], ['lab_orders', "ordered_at = 'infinity'"],
    ['lab_orders', "collected_at = '2026-09-20'"], ['lab_orders', "status = 'collected'"],
    ['lab_orders', "status = 'completed'"], ['lab_orders', "completed_at = now()"],
    ['lab_orders', "status = 'completed', collected_at = '2026-09-24', completed_at = '2026-09-23'"],
    ['lab_results', "test_name = ' '"], ['lab_results', "test_code = ' '"], ['lab_results', "unit = ' '"],
    ['lab_results', "value_numeric = 'NaN'"], ['lab_results', "value_numeric = 'Infinity'"],
    ['lab_results', "reference_low = '-Infinity'"], ['lab_results', "reference_high = 'NaN'"],
    ['lab_results', 'reference_low = 20, reference_high = 10'], ['lab_results', "abnormal_flag = 'invalid'"],
    ['lab_results', "result_status = 'invalid'"], ['lab_results', 'verified_at = null'],
    ['lab_results', "result_status = 'pending'"], ['lab_results', 'value_numeric = null, value_text = null'],
    ['lab_results', "value_text = ' '"], ['lab_results', "observed_at = 'infinity'"],
    ['lab_results', "verified_at = '2026-09-21'"], ['lab_results', "verified_at = 'infinity'"],
  ])('enforces %s checks (case %#)', async (table, changes) => {
    await expect(db.query(`update public.${table} set ${changes} where id = $1`, [table === 'lab_orders' ? orders[0] : results[0]])).rejects.toMatchObject({ code: '23514' })
  })

  it.each(['lab_orders', 'lab_results'])('updates %s timestamps using the existing trigger', async (table) => {
    const id = table === 'lab_orders' ? orders[0] : results[0]
    const old = (await db.query(`select created_at from public.${table} where id = $1`, [id])).rows[0]
    await actor(null, 'service_role')
    const row = (await db.query(`update public.${table} set updated_at = '2000-01-01' where id = $1 returning created_at, updated_at, statement_timestamp() as expected`, [id])).rows[0]
    expect(row.created_at).toEqual(old.created_at)
    expect(row.updated_at).toEqual(row.expected)
  })

  it('has RLS enabled, validated foreign keys, and patient/order lookup indexes', async () => {
    expect((await db.query("select relrowsecurity from pg_class where oid in ('public.lab_orders'::regclass, 'public.lab_results'::regclass)")).rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }])
    const fks = (await db.query("select convalidated, confdeltype from pg_constraint where contype = 'f' and conrelid in ('public.lab_orders'::regclass, 'public.lab_results'::regclass)")).rows
    expect(fks).toHaveLength(5)
    expect(fks.every((fk) => fk.convalidated && fk.confdeltype === 'r')).toBe(true)
    const indexes = (await db.query("select indexname from pg_indexes where schemaname = 'public' and tablename in ('lab_orders', 'lab_results')")).rows.map((row) => row.indexname)
    expect(indexes).toEqual(expect.arrayContaining(['lab_orders_patient_ordered_idx', 'lab_orders_provider_ordered_idx', 'lab_orders_encounter_idx', 'lab_results_patient_observed_idx', 'lab_results_order_idx']))
  })
})
