// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929100000_vital_readings_dashboard_metadata.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const uid = (n) => `73000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Full migration chain; only the Supabase-managed Auth primitives are stubbed.
async function baseline() {
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } })
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
  await db.query('insert into auth.users(id) values ($1), ($2), ($3), ($4)', [uid(1), uid(2), uid(3), uid(4)])
  const patients = []
  for (const n of [1, 2]) {
    const result = await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: 'Synthetic Vitals Patient', phone: `+95979000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: { blood_type: 'Unknown' },
    })])
    patients.push(result.rows[0].id)
  }
  await db.query("insert into public.profiles(id, role, full_name) values ($1, 'doctor', 'Assigned Doctor'), ($2, 'doctor', 'Unrelated Doctor')", [uid(3), uid(4)])
  const provider = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, 'doctor', 'verified') returning id", [uid(3)])).rows[0].id
  await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, 'doctor', 'verified')", [uid(4)])
  const appointment = (await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
    scheduled_start, scheduled_end, consultation_channel, booking_code)
    values ($1, $2, 'teleconsultation', '2026-09-20T09:00Z', '2026-09-20T09:30Z', 'video', 'ECA-VITAL-TEST') returning id`, [patients[0], provider])).rows[0].id
  const encounter = (await db.query("insert into public.care_encounters(appointment_id, patient_id, provider_id, encounter_type) values ($1, $2, $3, 'teleconsultation') returning id", [appointment, patients[0], provider])).rows[0].id
  return { db, patients, encounter }
}

describe('Phase 3 vital readings dashboard compatibility', () => {
  let db, patients, encounter, beforeRows, beforePolicies, beforeIndexes, beforeTableOid

  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
  }

  beforeAll(async () => {
    ;({ db, patients, encounter } = await baseline())
    await db.query(`insert into public.vital_readings(patient_id, encounter_id, recorded_by_profile_id, source,
      systolic_bp, diastolic_bp, heart_rate, spo2, temperature_c, glucose_mg_dl, weight_kg, recorded_at, notes)
      values ($1, $3, $4, 'provider', 120, 80, 70, 98, 36.5, 90, 65, '2026-09-20T09:15Z', 'Original reading'),
        ($1, null, null, 'manual', 125, 82, 75, 97, 36.7, 100, 65.5, '2026-09-21T09:15Z', null),
        ($2, null, null, 'device', 130, 85, 80, 99, 37, 95, 70, '2026-09-22T09:15Z', null)`,
    [patients[0], patients[1], encounter, uid(3)])
    beforeRows = (await db.query('select * from public.vital_readings order by id')).rows
    beforePolicies = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    beforeIndexes = (await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'vital_readings' order by indexname")).rows
    beforeTableOid = (await db.query("select 'public.vital_readings'::regclass::oid as oid")).rows[0].oid
    await db.exec(migration)
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('alters the same table, preserves every old column/value, and derives source_type', async () => {
    const rows = (await db.query('select * from public.vital_readings order by id')).rows
    expect((await db.query("select 'public.vital_readings'::regclass::oid as oid")).rows[0].oid).toBe(beforeTableOid)
    expect(rows.map(({ measurement_context, source_type, ...original }) => original)).toEqual(beforeRows)
    expect(rows.every((row) => row.measurement_context === null && row.source_type === row.source)).toBe(true)
    const columns = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'vital_readings'")).rows.map((row) => row.column_name)
    for (const duplicate of ['oxygen_saturation', 'temperature', 'blood_glucose', 'device_id']) expect(columns).not.toContain(duplicate)
  })

  it('keeps the existing history index and all policies unchanged', async () => {
    expect((await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'vital_readings' order by indexname")).rows).toEqual(beforeIndexes)
    expect(beforeIndexes.some((index) => index.indexdef.includes('(patient_id, recorded_at DESC)'))).toBe(true)
    expect((await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows).toEqual(beforePolicies)
    expect((await db.query("select relrowsecurity from pg_class where oid = 'public.vital_readings'::regclass")).rows[0].relrowsecurity).toBe(true)
    expect((await db.query("select convalidated from pg_constraint where conrelid = 'public.vital_readings'::regclass and conname like '%finite_check'")).rows).toEqual(Array(4).fill({ convalidated: true }))
  })

  it('allows an assigned clinician to insert a reading using existing fields plus context', async () => {
    await actor(3)
    const { rows } = await db.query(`insert into public.vital_readings(patient_id, encounter_id, recorded_by_profile_id,
      source, heart_rate, recorded_at, measurement_context)
      values ($1, $2, $3, 'provider', 72, '2026-09-23T09:15Z', 'Resting, seated') returning *`, [patients[0], encounter, uid(3)])
    expect(rows[0]).toMatchObject({ patient_id: patients[0], encounter_id: encounter, heart_rate: 72, source: 'provider', source_type: 'provider', measurement_context: 'Resting, seated' })
  })

  it('keeps old insert payloads valid without either new field', async () => {
    await actor(3)
    const { rows } = await db.query("insert into public.vital_readings(patient_id, recorded_by_profile_id, source, recorded_at, weight_kg) values ($1, $2, 'manual', now(), 60) returning source_type, measurement_context", [patients[0], uid(3)])
    expect(rows).toEqual([{ source_type: 'manual', measurement_context: null }])
  })

  it('retrieves the latest own reading, not another patient newer reading', async () => {
    await actor(1)
    const { rows } = await db.query('select * from public.vital_readings where patient_id = $1 order by recorded_at desc limit 1', [patients[0]])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ patient_id: patients[0], heart_rate: 75 })
    expect(new Date(rows[0].recorded_at).toISOString()).toBe('2026-09-21T09:15:00.000Z')
  })

  it('retrieves chronological historical readings in a date range', async () => {
    await actor(1)
    const { rows } = await db.query("select heart_rate from public.vital_readings where patient_id = $1 and recorded_at >= '2026-09-20' and recorded_at < '2026-09-22' order by recorded_at", [patients[0]])
    expect(rows).toEqual([{ heart_rate: 70 }, { heart_rate: 75 }])
  })

  it.each([1, 2])('isolates patient %s even without a client-side patient filter', async (n) => {
    await actor(n)
    const { rows } = await db.query('select patient_id from public.vital_readings')
    expect(rows).toHaveLength(n === 1 ? 2 : 1)
    expect(rows.every((row) => row.patient_id === patients[n - 1])).toBe(true)
    expect((await db.query('select id from public.vital_readings where patient_id = $1', [patients[n === 1 ? 1 : 0]])).rows).toEqual([])
  })

  it('denies anonymous reads both with and without table privileges', async () => {
    await actor(null, 'anon')
    await db.exec('savepoint denied')
    await expect(db.query('select id from public.vital_readings')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied; reset role; grant select on public.vital_readings to anon; set local role anon')
    expect((await db.query('select id from public.vital_readings')).rows).toEqual([])
  })

  it('does not let a patient self-insert or an unrelated doctor insert/read', async () => {
    await actor(1)
    await db.exec('savepoint denied')
    await expect(db.query("insert into public.vital_readings(patient_id, recorded_by_profile_id, source, recorded_at) values ($1, $2, 'manual', now())", [patients[0], uid(1)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied; reset role')
    await actor(4)
    expect((await db.query('select id from public.vital_readings')).rows).toEqual([])
    await expect(db.query("insert into public.vital_readings(patient_id, recorded_by_profile_id, source, recorded_at) values ($1, $2, 'provider', now())", [patients[0], uid(4)])).rejects.toMatchObject({ code: '42501' })
  })

  it('prevents clinician writes to another patient or attribution to another user', async () => {
    await actor(3)
    await db.exec('savepoint denied')
    await expect(db.query("insert into public.vital_readings(patient_id, recorded_by_profile_id, source, recorded_at) values ($1, $2, 'provider', now())", [patients[1], uid(3)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied')
    await expect(db.query("insert into public.vital_readings(patient_id, recorded_by_profile_id, source, recorded_at) values ($1, $2, 'provider', now())", [patients[0], uid(4)])).rejects.toMatchObject({ code: '42501' })
  })

  it.each([
    ['measurement_context', ''], ['measurement_context', '   '], ['measurement_context', 'x'.repeat(501)],
    ['systolic_bp', '0'], ['diastolic_bp', '-1'], ['heart_rate', '0'], ['spo2', '101'],
    ['temperature_c', '-300'], ['temperature_c', 'NaN'], ['glucose_mg_dl', '-1'],
    ['glucose_mg_dl', 'NaN'], ['glucose_mg_dl', 'Infinity'], ['weight_kg', 'NaN'], ['recorded_at', 'infinity'],
  ])('rejects invalid %s (case %#)', async (column, value) => {
    await expect(db.query(`update public.vital_readings set ${column} = $1 where id = $2`, [value, beforeRows[0].id])).rejects.toMatchObject({ code: '23514' })
  })

  it('does not allow source_type to diverge from source', async () => {
    await expect(db.query("update public.vital_readings set source_type = 'device' where id = $1", [beforeRows[0].id])).rejects.toMatchObject({ code: '428C9' })
  })
})

it('preserves anomalous historical measurements while enforcing checks on new writes', async () => {
  const { db, patients } = await baseline()
  try {
    const id = (await db.query(`insert into public.vital_readings(patient_id, source, temperature_c, glucose_mg_dl, weight_kg, recorded_at)
      values ($1, 'manual', 'NaN', -1, 'NaN', 'infinity') returning id`, [patients[0]])).rows[0].id
    const before = (await db.query('select * from public.vital_readings where id = $1', [id])).rows[0]
    await db.exec(migration)
    const { source_type, measurement_context, ...after } = (await db.query('select * from public.vital_readings where id = $1', [id])).rows[0]
    expect(after).toEqual(before)
    const constraints = (await db.query("select convalidated from pg_constraint where conrelid = 'public.vital_readings'::regclass and conname like '%finite_check'")).rows
    expect(constraints).toEqual(Array(4).fill({ convalidated: false }))
    await expect(db.query("insert into public.vital_readings(patient_id, source, recorded_at, glucose_mg_dl) values ($1, 'manual', now(), -1)", [patients[0]])).rejects.toMatchObject({ code: '23514' })
  } finally { await db.close() }
}, 60000)
