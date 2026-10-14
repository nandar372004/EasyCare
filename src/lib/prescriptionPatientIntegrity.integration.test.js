// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261001090000_prescription_patient_integrity.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const readGrantMigrationName = '20261010140000_patient_prescription_read_column_grants.sql'
const readGrantMigration = readFileSync(join(directory, readGrantMigrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/prescription_relationship_validation.sql'), 'utf8')
const uid = n => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `)
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql') && n < migrationName).sort()) {
    await db.exec(readFileSync(join(directory, name), 'utf8'))
  }
  for (const n of [1, 2, 3, 4, 5]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
  const patients = [], providers = [], encounters = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: 'Prescription integrity test patient', phone: `+95983000000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id", [uid(n), role])).rows[0].id)
  }
  await db.query("update public.providers set display_name='Test doctor' where id=$1", [providers[0]])
  for (const i of [0, 1]) {
    const appointment = (await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
      scheduled_start,scheduled_end,consultation_channel,booking_code)
      values ($1,$2,'teleconsultation',$3,$4,'video',$5) returning id`,
    [patients[i], providers[i], `2026-10-0${i + 1}T09:00Z`, `2026-10-0${i + 1}T09:30Z`, `RX-INTEGRITY-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
  }
  const prescription = (await db.query(`insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id,instructions)
    values ($1,$2,$3,'Existing valid instructions') returning *`, [encounters[0], patients[0], providers[0]])).rows[0]
  await db.query("insert into public.prescription_items(prescription_id, medication_name, strength, dose, route, frequency, duration_days, instructions) values ($1, 'Synthetic prescription item', '10 mg', '1 tablet', 'oral', 'Once daily', 5, 'Recorded use')", [prescription.id])
  return { db, patients, providers, encounters, prescription }
}

describe('Prescription patient relationship repair', () => {
  let db, patients, providers, encounters, prescription, policiesBefore, providerPrivilegesBefore
  const policies = () => db.query("select * from pg_policies where schemaname='public' and policyname <> 'prescriptions_doctor_create' order by tablename,policyname")
  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
  }
  const insert = (patient = patients[0], encounter = encounters[0], provider = providers[0]) =>
    db.query('insert into public.prescriptions(patient_id,encounter_id,doctor_provider_id) values ($1,$2,$3)', [patient, encounter, provider])

  beforeAll(async () => {
    ({ db, patients, providers, encounters, prescription } = await baseline())
    policiesBefore = (await policies()).rows
    await db.exec(migration)
    // Mirror Staging's missing SELECT grants while preserving the existing
    // INSERT/UPDATE/DELETE ACLs for the grant migration regression checks.
    await db.exec('revoke select on public.prescriptions, public.prescription_items from anon, authenticated')
    providerPrivilegesBefore = (await db.query(`select
      has_column_privilege('authenticated','public.providers','id','select') as id_select,
      has_column_privilege('authenticated','public.providers','display_name','select') as display_name_select,
      has_column_privilege('authenticated','public.providers','profile_id','select') as profile_id_select,
      has_column_privilege('authenticated','public.providers','license_number','select') as license_number_select`)).rows[0]
    await db.exec(readGrantMigration)
  }, 60000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('preserves existing valid prescription bytes and all other policies', async () => {
    expect((await db.query('select * from public.prescriptions where id=$1', [prescription.id])).rows[0]).toEqual(prescription)
    expect((await policies()).rows).toEqual(policiesBefore)
    const fk = (await db.query("select convalidated, condeferrable from pg_constraint where conrelid='public.prescriptions'::regclass and conname='prescriptions_encounter_patient_fk'")).rows[0]
    expect(fk).toEqual({ convalidated: true, condeferrable: false })
    expect((await db.exec(validation)).map(r => r.rows)).toEqual([[], []])
  })

  it('allows assigned doctor creation and normal doctor/patient reads', async () => {
    await actor(3)
    const row = (await db.query(`insert into public.prescriptions(patient_id,encounter_id,doctor_provider_id)
      values ($1,$2,$3) returning id`, [patients[0], encounters[0], providers[0]])).rows[0]
    expect((await db.query('select id from public.prescriptions where id=$1', [row.id])).rows).toEqual([{ id: row.id }])
    await actor(1)
    expect((await db.query('select patient_id from public.prescriptions where id=$1', [row.id])).rows).toEqual([{ patient_id: patients[0] }])
    await actor(2)
    expect((await db.query('select id from public.prescriptions where id=$1', [row.id])).rows).toEqual([])
  })

  it('grants only the patient UI columns and preserves patient, item, and prescriber read scope', async () => {
    await actor(1)
    const rows = await db.query(`select p.id, p.patient_id, p.doctor_provider_id, p.status, p.instructions, p.issued_at,
      i.id as item_id, i.medication_name, i.strength, i.dose, i.route, i.frequency, i.duration_days, i.instructions as item_instructions,
      provider.display_name
      from public.prescriptions p
      left join public.prescription_items i on i.prescription_id=p.id
      left join public.providers provider on provider.id=p.doctor_provider_id`)
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ patient_id: patients[0], medication_name: 'Synthetic prescription item', display_name: 'Test doctor' })
    expect((await db.query("update public.prescriptions set instructions='tampered' where id=$1 returning id", [prescription.id])).rows).toEqual([])
    expect((await db.query("update public.prescription_items set medication_name='tampered' where prescription_id=$1 returning id", [prescription.id])).rows).toEqual([])

    await actor(2)
    expect((await db.query('select id from public.prescriptions')).rows).toEqual([])
    expect((await db.query('select id from public.prescription_items')).rows).toEqual([])
  })

  it('denies anonymous reads and keeps unneeded and private columns ungranted', async () => {
    expect((await db.query(`select
      has_table_privilege('authenticated','public.prescriptions','select') as prescription_table_select,
      has_column_privilege('authenticated','public.prescriptions','id','select') as prescription_id_select,
      has_column_privilege('authenticated','public.prescriptions','encounter_id','select') as encounter_id_select,
      has_column_privilege('authenticated','public.prescription_items','medication_name','select') as item_name_select,
      has_column_privilege('authenticated','public.prescription_items','prescription_id','select') as item_parent_select,
      has_table_privilege('authenticated','public.prescriptions','insert') as prescription_insert_before,
      has_table_privilege('authenticated','public.prescriptions','update') as prescription_update_before,
      has_table_privilege('authenticated','public.prescriptions','delete') as prescription_delete_before`)).rows[0]).toEqual({
      prescription_table_select: false, prescription_id_select: true, encounter_id_select: false,
      item_name_select: true, item_parent_select: true,
      prescription_insert_before: true, prescription_update_before: true, prescription_delete_before: true,
    })
    expect((await db.query(`select
      has_column_privilege('authenticated','public.providers','id','select') as id_select,
      has_column_privilege('authenticated','public.providers','display_name','select') as display_name_select,
      has_column_privilege('authenticated','public.providers','profile_id','select') as profile_id_select,
      has_column_privilege('authenticated','public.providers','license_number','select') as license_number_select`)).rows[0]).toEqual(providerPrivilegesBefore)
    await actor(null, 'anon')
    await db.exec('savepoint anon_prescription_read')
    await expect(db.query('select id from public.prescriptions')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anon_prescription_read')
    await expect(db.query('select id from public.prescription_items')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anon_prescription_read')
    expect((await db.query(`select
      has_table_privilege('authenticated','public.prescriptions','insert') as insert_after,
      has_table_privilege('authenticated','public.prescriptions','update') as update_after,
      has_table_privilege('authenticated','public.prescriptions','delete') as delete_after`)).rows[0]).toEqual({ insert_after: true, update_after: true, delete_after: true })
    expect((await db.query(`select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('prescriptions','prescription_items') order by tablename`)).rows)
      .toEqual([{ tablename: 'prescription_items', rowsecurity: true }, { tablename: 'prescriptions', rowsecurity: true }])
  })

  it('preserves the doctor prescription-item creation workflow', async () => {
    await actor(3)
    const item = (await db.query("insert into public.prescription_items(prescription_id,medication_name) values ($1,'Test item') returning id", [prescription.id])).rows[0]
    await actor(1)
    expect((await db.query('select id from public.prescription_items where id=$1', [item.id])).rows).toEqual([item])
  })

  it('rejects the original attack without RETURNING via qualified INSERT RLS', async () => {
    await actor(3)
    await expect(insert(patients[1])).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['own-provider', 'spoofed-provider'])('denies an unrelated doctor (%s)', async mode => {
    await actor(4)
    await expect(insert(patients[0], encounters[0], mode === 'own-provider' ? providers[1] : providers[0]))
      .rejects.toMatchObject({ code: '42501' })
  })

  it.each([1, 5])('denies non-doctor actor %s even with a valid patient/encounter pair', async n => {
    await actor(n)
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })

  it('denies anonymous prescription creation', async () => {
    await actor(null, 'anon')
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })

  it('enforces the patient pair on service-role INSERT independently of RLS', async () => {
    await actor(null, 'service_role')
    await expect(insert(patients[1])).rejects.toMatchObject({ code: '23503', constraint: 'prescriptions_encounter_patient_fk' })
  })

  it.each([['patient_id', 1], ['encounter_id', 1]])('enforces the pair on trusted UPDATE of %s', async (column, index) => {
    await actor(null, 'service_role')
    await expect(db.query(`update public.prescriptions set ${column}=$1 where id=$2`,
      [column === 'patient_id' ? patients[index] : encounters[index], prescription.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'prescriptions_encounter_patient_fk' })
  })

  it('prevents parent patient reassignment from invalidating an existing prescription', async () => {
    await actor(null, 'service_role')
    await expect(db.query('update public.care_encounters set patient_id=$1 where id=$2', [patients[1], encounters[0]]))
      .rejects.toMatchObject({ code: '23001', constraint: 'prescriptions_encounter_patient_fk' })
  })

  it('retains denial of doctor UPDATE and leaves the row unchanged', async () => {
    await actor(3)
    expect((await db.query('update public.prescriptions set patient_id=$1 where id=$2 returning id', [patients[1], prescription.id])).rows).toEqual([])
    await actor(null, 'service_role')
    expect((await db.query('select * from public.prescriptions where id=$1', [prescription.id])).rows[0]).toEqual(prescription)
  })

  it('allows a trusted non-relationship update of a valid prescription', async () => {
    await actor(null, 'service_role')
    const row = (await db.query("update public.prescriptions set instructions='Reviewed instructions' where id=$1 returning *", [prescription.id])).rows[0]
    expect(row).toMatchObject({ patient_id: patients[0], encounter_id: encounters[0], instructions: 'Reviewed instructions' })
  })
})

it('reports inconsistent legacy rows and aborts migration without rewriting records or policies', async () => {
  const { db, patients, providers, encounters } = await baseline()
  try {
    // Reproduce pre-repair vulnerability under a real authenticated doctor role.
    await db.exec('begin')
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(3)])
    await db.exec('set local role authenticated')
    await db.query('insert into public.prescriptions(id,patient_id,encounter_id,doctor_provider_id) values ($1,$2,$3,$4)',
      [uid(90), patients[1], encounters[0], providers[0]])
    await db.exec('commit')
    const before = (await db.query('select * from public.prescriptions order by id')).rows
    const oldPolicy = (await db.query("select with_check from pg_policies where policyname='prescriptions_doctor_create'")).rows
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([{
      prescription_id: uid(90), encounter_id: encounters[0], prescription_patient_id: patients[1], encounter_patient_id: patients[0],
    }])
    await expect(db.exec(migration)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('1 inconsistent') })
    await db.exec('rollback')
    expect((await db.query('select * from public.prescriptions order by id')).rows).toEqual(before)
    expect((await db.query("select with_check from pg_policies where policyname='prescriptions_doctor_create'")).rows).toEqual(oldPolicy)
    expect((await db.query("select conname from pg_constraint where conname='prescriptions_encounter_patient_fk'")).rows).toEqual([])
  } finally { await db.close() }
}, 60000)
