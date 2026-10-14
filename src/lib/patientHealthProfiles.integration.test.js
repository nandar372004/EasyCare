// @vitest-environment node
// Real PostgreSQL/WASM migrations and RLS; only Supabase-managed Auth is stubbed.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrationName = '20260929090000_patient_health_profiles.sql'
const migrations = join(process.cwd(), 'supabase/migrations')
const uid = (n) => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const users = { patient: uid(1), other: uid(2), doctor: uid(3), unrelated: uid(4), nurse: uid(5), caregiver: uid(6), family: uid(7), coordinator: uid(8), clinicAdmin: uid(9), admin: uid(10) }

describe('Phase 2 patient health profiles in PostgreSQL', () => {
  let db
  let patient
  let otherPatient
  let doctor
  let clinic
  let beforePatients
  let beforePolicies
  const providerIds = {}

  async function actor(userId, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
    await db.exec(`set local role ${role}`)
  }

  async function readIds() {
    return (await db.query('select patient_id from public.patient_health_profiles order by patient_id')).rows.map((row) => row.patient_id)
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
      -- Exercise the migration's explicit revocations under permissive defaults.
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `)
    for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(migrations, name), 'utf8'))
    }
    for (const id of Object.values(users)) await db.query('insert into auth.users(id) values ($1)', [id])
    for (const [name, id] of Object.entries(users)) {
      if (['patient', 'other'].includes(name)) continue
      const role = name === 'unrelated' ? 'doctor' : name === 'clinicAdmin' ? 'clinic_admin' : name === 'admin' ? 'main_admin' : name
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [id, role, `Synthetic ${name}`])
    }
    const register = async (id, phone) => (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: id, fullName: 'Synthetic Patient', phone, dateOfBirth: '1995-01-01',
      medicalProfile: { blood_type: 'O+', existing_medical_conditions: 'Preserve original text', no_known_allergies: true },
    })])).rows[0].id
    patient = await register(users.patient, '+959780000001')
    otherPatient = await register(users.other, '+959780000002')
    for (const name of ['doctor', 'unrelated', 'nurse', 'caregiver']) {
      providerIds[name] = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [users[name], name === 'unrelated' ? 'doctor' : name])).rows[0].id
    }
    doctor = providerIds.doctor
    clinic = (await db.query("insert into public.partner_clinics(name, status) values ('Synthetic Clinic', 'active') returning id")).rows[0].id
    // Real care relationships; no authorization helper is replaced for tests.
    for (const name of ['doctor', 'nurse', 'caregiver']) {
      await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
        scheduled_start, scheduled_end, consultation_channel, booking_code)
        values ($1, $2, 'teleconsultation', now() + interval '1 day', now() + interval '1 day 30 minutes', 'video', $3)`,
      [patient, providerIds[name], `ECA-HEALTH-${name}`])
    }
    const coordinator = (await db.query('insert into public.care_coordinators(profile_id) values ($1) returning id', [users.coordinator])).rows[0].id
    await db.query('update public.patients set primary_coordinator_id = $1 where id = $2', [coordinator, patient])
    await db.query("insert into public.clinic_staff(clinic_id, profile_id, clinic_role) values ($1, $2, 'sub_admin')", [clinic, users.clinicAdmin])
    await db.query("insert into public.clinic_staff(clinic_id, profile_id, provider_id, clinic_role) values ($1, $2, $3, 'doctor')", [clinic, users.doctor, doctor])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', true)", [patient, users.family])
    beforePatients = (await db.query('select * from public.patients order by id')).rows
    beforePolicies = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    await db.exec(readFileSync(join(migrations, migrationName), 'utf8'))
    // Provisioning is explicitly a trusted service operation in this phase.
    await db.exec('set role service_role')
    await db.query('insert into public.patient_health_profiles(patient_id, primary_physician_id, preferred_clinic_id) values ($1, $2, $3), ($4, null, null)', [patient, doctor, clinic, otherPatient])
    await db.exec('reset role')
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('creates exactly the requested fields with UUID/defaults and preserves canonical blood type and existing policies', async () => {
    const columns = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'patient_health_profiles' order by ordinal_position")).rows.map((row) => row.column_name)
    expect(columns).toEqual(['id', 'patient_id', 'height_cm', 'baseline_weight_kg', 'smoking_status', 'alcohol_use', 'pregnancy_status', 'primary_physician_id', 'preferred_clinic_id', 'last_health_review_at', 'created_at', 'updated_at'])
    const row = (await db.query('select * from public.patient_health_profiles where patient_id = $1', [patient])).rows[0]
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row).toMatchObject({ height_cm: null, baseline_weight_kg: null, smoking_status: 'unknown', alcohol_use: 'unknown', pregnancy_status: 'unknown', last_health_review_at: null })
    expect(row.created_at).toBeTruthy()
    expect(row.updated_at).toBeTruthy()
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(beforePatients)
    expect((await db.query("select * from pg_policies where schemaname = 'public' and tablename <> 'patient_health_profiles' order by tablename, policyname")).rows).toEqual(beforePolicies)
  })

  it('enforces one health profile per patient', async () => {
    await expect(db.query('insert into public.patient_health_profiles(patient_id) values ($1)', [patient])).rejects.toMatchObject({ code: '23505' })
  })

  it('requires a patient identity', async () => {
    await expect(db.query('insert into public.patient_health_profiles default values')).rejects.toMatchObject({ code: '23502' })
  })

  it.each(['patient_id', 'primary_physician_id', 'preferred_clinic_id'])('enforces the %s foreign key', async (column) => {
    await expect(db.query(`update public.patient_health_profiles set ${column} = $1 where patient_id = $2`, [uid(99), patient])).rejects.toMatchObject({ code: '23503' })
  })

  it('uses RESTRICT foreign keys and only useful lookup indexes', async () => {
    const fks = (await db.query("select confdeltype from pg_constraint where conrelid = 'public.patient_health_profiles'::regclass and contype = 'f'")).rows
    expect(fks).toEqual([{ confdeltype: 'r' }, { confdeltype: 'r' }, { confdeltype: 'r' }])
    const indexes = (await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'patient_health_profiles'")).rows
    expect(indexes).toHaveLength(4)
    expect(indexes.filter((index) => index.indexdef.includes('UNIQUE'))).toHaveLength(2)
    expect(indexes.filter((index) => index.indexdef.includes('IS NOT NULL'))).toHaveLength(2)
  })

  it.each([
    ['height_cm', '0'], ['height_cm', '-1'], ['height_cm', 'NaN'],
    ['baseline_weight_kg', '0'], ['baseline_weight_kg', '-1'], ['baseline_weight_kg', 'NaN'],
    ['smoking_status', 'invalid'], ['alcohol_use', 'invalid'], ['pregnancy_status', 'invalid'],
    ['last_health_review_at', 'infinity'],
  ])('rejects invalid %s = %s', async (column, value) => {
    await expect(db.query(`update public.patient_health_profiles set ${column} = $1 where patient_id = $2`, [value, patient])).rejects.toMatchObject({ code: '23514' })
  })

  it.each(['smoking_status', 'alcohol_use', 'pregnancy_status'])('requires explicit unknown rather than NULL for %s', async (column) => {
    await expect(db.query(`update public.patient_health_profiles set ${column} = null where patient_id = $1`, [patient])).rejects.toMatchObject({ code: '23502' })
  })

  it('accepts fractional measurements, known statuses, optional relationships and a real review timestamp', async () => {
    await db.query(`update public.patient_health_profiles set height_cm = 165.25, baseline_weight_kg = 55.75,
      smoking_status = 'never', alcohol_use = 'none', pregnancy_status = 'not_applicable',
      primary_physician_id = null, preferred_clinic_id = null, last_health_review_at = '2026-09-01T00:00:00Z'
      where patient_id = $1`, [patient])
    const row = (await db.query('select height_cm, baseline_weight_kg from public.patient_health_profiles where patient_id = $1', [patient])).rows[0]
    expect(Number(row.height_cm)).toBe(165.25)
    expect(Number(row.baseline_weight_kg)).toBe(55.75)
  })

  it('allows only the current patient health profile', async () => {
    await actor(users.patient)
    expect(await readIds()).toEqual([patient])
    expect((await db.query('select id from public.patient_health_profiles where patient_id = $1', [otherPatient])).rows).toEqual([])
  })

  it('isolates the first patient from the second patient session', async () => {
    await actor(users.other)
    expect(await readIds()).toEqual([otherPatient])
  })

  it('denies anonymous access at the privilege boundary', async () => {
    await actor(null, 'anon')
    await expect(readIds()).rejects.toMatchObject({ code: '42501' })
  })

  it('RLS also denies anonymous reads if SELECT is accidentally granted later', async () => {
    await db.exec('grant select on public.patient_health_profiles to anon')
    await actor(null, 'anon')
    expect(await readIds()).toEqual([])
  })

  it.each(['doctor', 'nurse', 'caregiver'])('permits the assigned verified %s only for their patient', async (name) => {
    await actor(users[name])
    expect(await readIds()).toEqual([patient])
  })

  it('permits a provider with an accepted care assignment without an appointment', async () => {
    const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [otherPatient, users.other])).rows[0].id
    await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, providerIds.unrelated, users.admin])
    await actor(users.unrelated)
    expect(await readIds()).toEqual([otherPatient])
  })

  it('denies an unrelated verified doctor', async () => {
    await actor(users.unrelated)
    expect(await readIds()).toEqual([])
  })

  it('denies an assigned provider after verification is suspended', async () => {
    await db.query("update public.providers set verification_status = 'suspended' where id = $1", [doctor])
    await actor(users.doctor)
    expect(await readIds()).toEqual([])
  })

  it.each(['coordinator', 'clinicAdmin'])('does not broaden %s access to clinical records', async (name) => {
    await actor(users[name])
    expect(await readIds()).toEqual([])
  })

  it('honors the existing main-admin clinical-read authority', async () => {
    await actor(users.admin)
    expect((await readIds()).sort()).toEqual([patient, otherPatient].sort())
  })

  it('honors explicitly granted family clinical viewing', async () => {
    await actor(users.family)
    expect(await readIds()).toEqual([patient])
  })

  it('denies family without record-view permission', async () => {
    await db.query('update public.family_authorizations set can_view_records = false where family_profile_id = $1', [users.family])
    await actor(users.family)
    expect(await readIds()).toEqual([])
  })

  it.each(['patient', 'doctor', 'admin'])('keeps %s browser access read-only', async (name) => {
    await actor(users[name])
    await db.exec('savepoint browser_write')
    await expect(db.query('update public.patient_health_profiles set height_cm = 170 where patient_id = $1', [patient])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint browser_write')
    await expect(db.query('insert into public.patient_health_profiles(patient_id) values ($1)', [patient])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint browser_write')
    await expect(db.query('delete from public.patient_health_profiles where patient_id = $1', [patient])).rejects.toMatchObject({ code: '42501' })
  })

  it('reuses set_updated_at for trusted updates without changing created_at', async () => {
    const old = (await db.query('select created_at, updated_at from public.patient_health_profiles where patient_id = $1', [patient])).rows[0]
    await actor(null, 'service_role')
    const row = (await db.query("update public.patient_health_profiles set height_cm = 170, updated_at = '2000-01-01T00:00:00Z' where patient_id = $1 returning created_at, updated_at, statement_timestamp() as expected", [patient])).rows[0]
    expect(row.created_at).toEqual(old.created_at)
    expect(row.updated_at).toEqual(row.expected)
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(new Date(old.updated_at).getTime())
    await db.exec('reset role')
    expect((await db.query("select p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.patient_health_profiles'::regclass and not t.tgisinternal")).rows).toEqual([{ proname: 'set_updated_at' }])
  })
})
