// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261001120000_appointment_pricing_integrity.sql'
const migration = readFileSync(join(directory, '20261002120000_vital_encounter_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/vital_encounter_validation.sql'), 'utf8')
const uid = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Vital integrity test patient', phone: `+95990000000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id", [uid(n), role])).rows[0].id)
  }
  for (const i of [0, 1]) {
    const appointment = (await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
      scheduled_start,scheduled_end,consultation_channel,booking_code)
      values ($1,$2,'teleconsultation',$3,$4,'video',$5) returning id`,
    [patients[i], providers[i], `2026-10-0${i + 1}T09:00Z`, `2026-10-0${i + 1}T09:30Z`, `VITAL-BASE-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
  }
  await db.query(`insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id,instructions)
    values ($1,$2,$3,'Existing valid instructions')`, [encounters[0], patients[0], providers[0]])
  await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002090000_encounter_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002100000_payment_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002110000_notification_mark_read_integrity.sql'), 'utf8'))
  return { db, patients, providers, encounters }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  if (n || role !== 'authenticated') await db.exec(`set local role ${role}`)
}

const insertVital = (db, patient, encounter, recorder = uid(3), source = 'provider') =>
  db.query(`insert into public.vital_readings(patient_id,encounter_id,recorded_by_profile_id,source,heart_rate,recorded_at)
    values ($1,$2,$3,$4,70,now()) returning id,patient_id,encounter_id`, [patient, encounter, recorder, source])

describe('Vital encounter patient integrity', () => {
  let db, patients, providers, encounters, apps, oldVital, policies
  const insert = (patient, encounter, recorder, source) =>
    insertVital(db, patient ?? patients[0], encounter === undefined ? encounters[0] : encounter, recorder, source)

  beforeAll(async () => {
    ;({ db, patients, providers } = await baseline())
    apps = []
    encounters = []
    await db.query('update public.providers set consultation_fee_mmk=30000 where id=any($1::uuid[])', [providers])
    for (const i of [0, 1]) {
      const slot = (await db.query("insert into public.provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2037-01-01T09:00Z','2037-01-01T09:30Z') returning id", [providers[i]])).rows[0].id
      apps.push((await db.query("insert into public.appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code) values ($1,$2,$3,'teleconsultation','video','2037-01-01T09:00Z','2037-01-01T09:30Z',$4) returning id", [patients[i], providers[i], slot, `VITAL-${i}`])).rows[0].id)
      encounters.push((await db.query("insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type) values ($1,$2,$3,'teleconsultation') returning id", [apps[i], patients[i], providers[i]])).rows[0].id)
    }
    const vital = (await insert()).rows[0]
    oldVital = (await db.query('select * from public.vital_readings where id=$1', [vital.id])).rows[0]
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)
  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical measurements, generated aliases and every RLS policy', async () => {
    expect((await db.query('select * from public.vital_readings where id=$1', [oldVital.id])).rows[0]).toEqual(oldVital)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='vital_readings_encounter_patient_fk'")).rows)
      .toEqual([{ convalidated: true, condeferrable: false }])
    expect((await db.exec(validation)).map(r => r.rows)).toEqual([[], []])
  })

  it('authorized doctor creates encounter-linked vital and patient reads it', async () => {
    await actor(db, 3)
    const row = (await insert()).rows[0]
    await actor(db, 1)
    expect((await db.query('select id from public.vital_readings where id=$1', [row.id])).rows).toHaveLength(1)
    await actor(db, 2)
    expect((await db.query('select id from public.vital_readings where id=$1', [row.id])).rows).toEqual([])
  })

  it('preserves authorized provider standalone vitals', async () => {
    await actor(db, 3)
    expect((await insert(patients[0], null)).rows[0].encounter_id).toBeNull()
  })

  it('does not invent patient self-entry permission', async () => {
    await actor(db, 1)
    await expect(insert(patients[0], null, uid(1), 'manual')).rejects.toMatchObject({ code: '42501' })
  })

  it('exact audit exploit fails at relationship boundary for authorized doctor', async () => {
    await actor(db, 3)
    await expect(insert(patients[0], encounters[1])).rejects.toMatchObject({ code: '23503', constraint: 'vital_readings_encounter_patient_fk' })
  })

  it.each(['postgres', 'service_role'])('%s cannot insert cross-patient encounter reference', async role => {
    await actor(db, null, role === 'postgres' ? 'authenticated' : role)
    await expect(insert(patients[0], encounters[1])).rejects.toMatchObject({ code: '23503', constraint: 'vital_readings_encounter_patient_fk' })
  })

  it('trusted device-source standalone and linked writes remain supported', async () => {
    await actor(db, null, 'service_role')
    expect((await insert(patients[0], null, null, 'device')).rows).toHaveLength(1)
    expect((await insert(patients[0], encounters[0], null, 'device')).rows).toHaveLength(1)
  })

  it.each(['patient_id', 'encounter_id'])('service role cannot corrupt %s via UPDATE', async field => {
    await actor(db, null, 'service_role')
    await expect(db.query(`update public.vital_readings set ${field}=$1 where id=$2`, [field === 'patient_id' ? patients[1] : encounters[1], oldVital.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'vital_readings_encounter_patient_fk' })
  })

  it('cannot attach a standalone vital to a foreign encounter', async () => {
    const row = (await insert(patients[0], null)).rows[0]
    await actor(db, null, 'service_role')
    await expect(db.query('update public.vital_readings set encounter_id=$1 where id=$2', [encounters[1], row.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'vital_readings_encounter_patient_fk' })
  })

  it('parent encounter cannot move to another patient even when appointment chain would be valid', async () => {
    await db.query('delete from public.care_encounters where id=$1', [encounters[1]])
    await actor(db, null, 'service_role')
    await expect(db.query('update public.care_encounters set appointment_id=$1,patient_id=$2,provider_id=$3 where id=$4',
      [apps[1], patients[1], providers[1], encounters[0]])).rejects.toMatchObject({ code: '23001' })
  })

  it('parent encounter deletion cannot orphan a vital', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('delete from public.care_encounters where id=$1', [encounters[0]])).rejects.toMatchObject({ code: '23001' })
  })

  it('doctor still has no direct UPDATE or DELETE policy', async () => {
    await actor(db, 3)
    expect((await db.query('update public.vital_readings set patient_id=$1 where id=$2 returning id', [patients[1], oldVital.id])).rows).toEqual([])
    expect((await db.query('delete from public.vital_readings where id=$1 returning id', [oldVital.id])).rows).toEqual([])
  })

  it('unrelated doctor cannot create vital', async () => {
    await actor(db, 4)
    await expect(insert(patients[0], encounters[0], uid(4))).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['suspended', 'inactive'])('%s provider remains denied', async status => {
    await db.query('update public.profiles set status=$1 where id=$2', [status, uid(3)])
    await actor(db, 3)
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })

  it('unverified provider remains denied', async () => {
    await db.query("update public.providers set verification_status='pending' where id=$1", [providers[0]])
    await actor(db, 3)
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })

  it('anonymous cannot insert', async () => {
    await actor(db, null, 'anon')
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, encounters } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, 3)
    const before = (await insertVital(db, patients[0], encounters[1])).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.encounter_id).toBe(encounters[1])
    await db.exec('rollback')
    expect((await db.query('select id from public.vital_readings')).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, 3)
    await expect(insertVital(db, patients[0], encounters[1])).rejects.toMatchObject({
      code: '23503', constraint: 'vital_readings_encounter_patient_fk',
    })
    await db.exec('rollback')
    expect((await db.query('select id from public.vital_readings')).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports inconsistent vital and affected alert; migration aborts without rewriting either', async () => {
  const { db, patients, encounters } = await baseline()
  try {
    const vital = (await db.query("insert into public.vital_readings(patient_id,encounter_id,source,heart_rate,recorded_at) values ($1,$2,'provider',70,now()) returning *", [patients[0], encounters[1]])).rows[0]
    const alert = (await db.query("insert into public.monitoring_alerts(patient_id,vital_reading_id,alert_type,severity,message) values ($1,$2,'manual','info','Historical audit fixture') returning *", [patients[0], vital.id])).rows[0]
    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[1].rows).toHaveLength(1)
    await expect(db.exec(migration)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Vital relationship repair stopped') })
    await db.exec('rollback')
    expect((await db.query('select * from public.vital_readings where id=$1', [vital.id])).rows[0]).toEqual(vital)
    expect((await db.query('select * from public.monitoring_alerts where id=$1', [alert.id])).rows[0]).toEqual(alert)
    expect((await db.query("select conname from pg_constraint where conname='vital_readings_encounter_patient_fk'")).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)
