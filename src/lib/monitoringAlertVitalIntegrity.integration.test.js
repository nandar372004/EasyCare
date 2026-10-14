// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261002140000_medication_event_patient_integrity.sql'
const migration = readFileSync(join(directory, '20261002150000_monitoring_alert_vital_patient_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/monitoring_alert_vital_validation.sql'), 'utf8')
const uid = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Alert integrity test patient', phone: `+95991100000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id", [uid(n), role])).rows[0].id)
  }
  // Repair 4 requires an authoritative price; the pricing migration is already
  // applied at this chain cutoff.
  await db.query('update public.providers set consultation_fee_mmk=30000 where id=any($1::uuid[])', [providers])
  for (const i of [0, 1]) {
    const slot = (await db.query("insert into public.provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2037-01-01T09:00Z','2037-01-01T09:30Z') returning id", [providers[i]])).rows[0].id
    const appointment = (await db.query(`insert into public.appointments(patient_id,provider_id,provider_availability_id,appointment_type,
      scheduled_start,scheduled_end,consultation_channel,booking_code)
      values ($1,$2,$3,'teleconsultation',$4,$5,'video',$6) returning id`,
    [patients[i], providers[i], slot, '2037-01-01T09:00Z', '2037-01-01T09:30Z', `ALERT-BASE-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
  }
  // Existing valid clinical data that must survive the repair untouched.
  await db.query(`insert into public.vital_readings(patient_id,encounter_id,recorded_by_profile_id,source,heart_rate,recorded_at)
    values ($1,$2,$3,'provider',70,now())`, [patients[0], encounters[0], uid(3)])
  await db.query(`insert into public.monitoring_alerts(patient_id,vital_reading_id,alert_type,severity,message)
    select $1, id, 'vital', 'warning', 'Existing valid alert' from public.vital_readings where patient_id=$1`, [patients[0]])
  return { db, patients, providers, encounters }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  if (n || role !== 'authenticated') await db.exec(`set local role ${role}`)
}

const insertVital = (db, patient, encounter = null, recorder = uid(3)) =>
  db.query(`insert into public.vital_readings(patient_id,encounter_id,recorded_by_profile_id,source,heart_rate,recorded_at)
    values ($1,$2,$3,'provider',70,now()) returning id,patient_id`, [patient, encounter, recorder])

const insertAlert = (db, patient, vital, alertType = 'vital', severity = 'warning', message = 'Integrity test alert') =>
  db.query(`insert into public.monitoring_alerts(patient_id,vital_reading_id,alert_type,severity,message)
    values ($1,$2,$3,$4,$5) returning id,patient_id,vital_reading_id`, [patient, vital, alertType, severity, message])

describe('Monitoring alert vital reading patient integrity', () => {
  let db, patients, providers, encounters, oldAlert, oldVital, policies
  const vital = patient => insertVital(db, patient)
  // Patient B's vital is clinical data that legitimately exists. Create it as a
  // trusted writer so the alert insert, not the vital insert, is what is tested.
  const foreignVital = async index => {
    await actor(db, null, 'service_role')
    return (await insertVital(db, patients[index], null, null)).rows[0]
  }

  beforeAll(async () => {
    ;({ db, patients, providers, encounters } = await baseline())
    oldAlert = (await db.query('select * from public.monitoring_alerts')).rows[0]
    oldVital = (await db.query('select * from public.vital_readings')).rows[0]
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)
  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical alerts, vitals and every RLS policy', async () => {
    expect((await db.query('select * from public.monitoring_alerts where id=$1', [oldAlert.id])).rows[0]).toEqual(oldAlert)
    expect((await db.query('select * from public.vital_readings where id=$1', [oldVital.id])).rows[0]).toEqual(oldVital)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='monitoring_alerts_vital_patient_fk'")).rows)
      .toEqual([{ convalidated: true, condeferrable: false }])
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='vital_readings_id_patient_key'")).rows)
      .toEqual([{ convalidated: true, condeferrable: false }])
    expect((await db.exec(validation)).map(r => r.rows)).toEqual([[], [], [], [{ standalone_alert_count: 0 }]])
  })

  it('authorized doctor creates alert against a patient own vital and patient reads it', async () => {
    await actor(db, 3)
    const reading = (await vital(patients[0])).rows[0]
    const row = (await insertAlert(db, patients[0], reading.id)).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.vital_reading_id).toBe(reading.id)
    await actor(db, 1)
    expect((await db.query('select id from public.monitoring_alerts where id=$1', [row.id])).rows).toHaveLength(1)
    await actor(db, 2)
    expect((await db.query('select id from public.monitoring_alerts where id=$1', [row.id])).rows).toEqual([])
  })

  it('preserves standalone alerts that carry no vital reading', async () => {
    await actor(db, 3)
    const row = (await insertAlert(db, patients[0], null, 'manual', 'info')).rows[0]
    expect(row.vital_reading_id).toBeNull()
  })

  it('preserves authorized provider service_role and background alert creation', async () => {
    await actor(db, null, 'service_role')
    const reading = (await insertVital(db, patients[0], null, null)).rows[0]
    expect((await insertAlert(db, patients[0], reading.id)).rows).toHaveLength(1)
    expect((await insertAlert(db, patients[0], null, 'ai', 'info', 'Background generated')).rows).toHaveLength(1)
  })

  it('exact audit exploit fails at the relationship boundary for authorized doctor', async () => {
    const foreign = await foreignVital(1)
    await actor(db, 3)
    await expect(insertAlert(db, patients[0], foreign.id))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it('reverse exploit is equally denied at the relationship boundary', async () => {
    const own = await foreignVital(0)
    await actor(db, null, 'service_role')
    await expect(insertAlert(db, patients[1], own.id))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it('unrelated doctor is denied by authorization before the relationship check', async () => {
    const reading = await foreignVital(0)
    await actor(db, 4)
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['suspended', 'inactive'])('%s provider remains denied', async status => {
    const reading = await foreignVital(0)
    await db.query('update public.profiles set status=$1 where id=$2', [status, uid(3)])
    await actor(db, 3)
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it('unverified provider remains denied', async () => {
    const reading = await foreignVital(0)
    await db.query("update public.providers set verification_status='pending' where id=$1", [providers[0]])
    await actor(db, 3)
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it('unauthorized patient remains denied', async () => {
    const reading = await foreignVital(0)
    await actor(db, 1)
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it('anonymous caller remains denied', async () => {
    const reading = await foreignVital(0)
    await actor(db, null, 'anon')
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['authenticated', 'service_role'])('%s direct SQL cannot insert a cross-patient alert', async role => {
    await actor(db, null, role)
    const foreign = (await insertVital(db, patients[1], null, null)).rows[0]
    await expect(insertAlert(db, patients[0], foreign.id))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it.each(['patient_id', 'vital_reading_id'])('cannot corrupt %s via UPDATE', async field => {
    await actor(db, null, 'service_role')
    const foreign = field === 'patient_id'
      ? patients[1]
      : (await insertVital(db, patients[1], null, null)).rows[0].id
    await expect(db.query(`update public.monitoring_alerts set ${field}=$1 where id=$2`, [foreign, oldAlert.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it('service_role cross-patient UPDATE is denied', async () => {
    await actor(db, null, 'service_role')
    const foreign = (await insertVital(db, patients[1], null, null)).rows[0]
    await expect(db.query('update public.monitoring_alerts set vital_reading_id=$1 where id=$2', [foreign.id, oldAlert.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it('parent vital ownership cannot be moved while an alert references it', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.vital_readings set patient_id=$1 where id=$2', [patients[1], oldVital.id]))
      .rejects.toMatchObject({ code: '23001', constraint: 'monitoring_alerts_vital_patient_fk' })
  })

  it('parent vital deletion cannot orphan a referenced alert', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('delete from public.vital_readings where id=$1', [oldVital.id]))
      .rejects.toMatchObject({ code: '23001' })
  })

  it('an unreferenced vital may still be re-pointed freely', async () => {
    await actor(db, null, 'service_role')
    const loose = (await insertVital(db, patients[0], null, null)).rows[0]
    expect((await db.query('update public.vital_readings set patient_id=$1 where id=$2 returning id', [patients[1], loose.id])).rows)
      .toHaveLength(1)
  })

  it('legitimate reviewer update and resolution remain allowed', async () => {
    await actor(db, 3)
    const reading = (await vital(patients[0])).rows[0]
    const row = (await insertAlert(db, patients[0], reading.id)).rows[0]
    expect((await db.query(
      'update public.monitoring_alerts set status=$1,resolved_at=now(),reviewed_by_profile_id=$2 where id=$3 returning id',
      ['resolved', uid(3), row.id])).rows).toHaveLength(1)
  })

  it('unrelated doctor cannot create an alert for a patient', async () => {
    const reading = await foreignVital(0)
    await actor(db, 4)
    await expect(insertAlert(db, patients[0], reading.id)).rejects.toMatchObject({ code: '42501' })
  })

  it('Repair 8 vital/encounter integrity and Repair 3 identity guard still hold', async () => {
    expect((await db.query("select conname from pg_constraint where conname='vital_readings_encounter_patient_fk'")).rows)
      .toEqual([{ conname: 'vital_readings_encounter_patient_fk' }])
    expect((await db.query("select count(*)::int as n from pg_policies where tablename='monitoring_alerts' and policyname='clinical_identity_required'")).rows)
      .toEqual([{ n: 1 }])
    await actor(db, 3)
    await expect(insertVital(db, patients[0], encounters[1]))
      .rejects.toMatchObject({ code: '23503', constraint: 'vital_readings_encounter_patient_fk' })
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, 3)
    await actor(db, null, 'service_role')
    const foreign = (await insertVital(db, patients[1], null, null)).rows[0]
    await actor(db, 3)
    const before = (await insertAlert(db, patients[0], foreign.id)).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.vital_reading_id).toBe(foreign.id)
    await db.exec('rollback')
    expect((await db.query('select id from public.monitoring_alerts where vital_reading_id is not null and patient_id is distinct from (select patient_id from public.vital_readings)')).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, null, 'service_role')
    const foreign2 = (await insertVital(db, patients[1], null, null)).rows[0]
    await actor(db, 3)
    await expect(insertAlert(db, patients[0], foreign2.id))
      .rejects.toMatchObject({ code: '23503', constraint: 'monitoring_alerts_vital_patient_fk' })
    await db.exec('rollback')
    expect((await db.query('select count(*)::int as n from public.monitoring_alerts')).rows).toEqual([{ n: 1 }])
    expect((await db.query(`select count(*)::int as n from public.monitoring_alerts as a
      join public.vital_readings as v on v.id = a.vital_reading_id
      where a.patient_id is distinct from v.patient_id`)).rows).toEqual([{ n: 0 }])
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports the cross-patient alert and migration aborts without rewriting clinical data', async () => {
  const { db, patients } = await baseline()
  try {
    const foreign = (await db.query(
      "insert into public.vital_readings(patient_id,source,heart_rate,recorded_at) values ($1,'provider',70,now()) returning *",
      [patients[1]])).rows[0]
    const alert = (await db.query(
      "insert into public.monitoring_alerts(patient_id,vital_reading_id,alert_type,severity,message) values ($1,$2,'vital','warning','Historical inconsistent alert') returning *",
      [patients[0], foreign.id])).rows[0]
    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[1].rows).toEqual([])
    expect(reports[2].rows).toEqual([])
    expect(reports[3].rows).toEqual([{ standalone_alert_count: 0 }])
    await expect(db.exec(migration)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Monitoring alert relationship repair stopped') })
    await db.exec('rollback')
    expect((await db.query('select * from public.vital_readings where id=$1', [foreign.id])).rows[0]).toEqual(foreign)
    expect((await db.query('select * from public.monitoring_alerts where id=$1', [alert.id])).rows[0]).toEqual(alert)
    expect((await db.query("select conname from pg_constraint where conname='monitoring_alerts_vital_patient_fk'")).rows).toEqual([])
    expect((await db.query("select conname from pg_constraint where conname='vital_readings_id_patient_key'")).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)
