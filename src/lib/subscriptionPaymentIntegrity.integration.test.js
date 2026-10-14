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
const migration = readFileSync(join(directory, '20261002130000_subscription_payment_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/subscription_payment_validation.sql'), 'utf8')
const uid = n => `89000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  for (const n of [1, 2, 3, 4, 5, 9, 10]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
  const patients = [], providers = [], encounters = [], apps = [], subs = [], pkgs = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Subscription test patient ${n}`, phone: `+95989000000${n}`,
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
    [patients[i], providers[i], `2026-10-0${i + 1}T09:00Z`, `2026-10-0${i + 1}T09:30Z`, `SUB-BASE-${i}`])).rows[0].id
    apps.push(appointment)
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
    const pkg = (await db.query("insert into public.care_packages(name,price) values ($1,45000) returning id", [`Care Package ${i + 1}`])).rows[0].id
    pkgs.push(pkg)
    subs.push((await db.query('insert into public.subscriptions(patient_id,purchased_by_profile_id,package_id) values ($1,$2,$3) returning id',
      [patients[i], uid(i + 1), pkg])).rows[0].id)
  }

  // Setup family profiles
  await db.query("insert into public.profiles(id, role, full_name) values ($1,'family','Authorized Family Payer')", [uid(9)])
  await db.query("insert into public.family_authorizations(patient_id,family_profile_id,status,can_make_payments) values ($1,$2,'active',true)", [patients[0], uid(9)])

  await db.query("insert into public.profiles(id, role, full_name) values ($1,'family','Revoked Family Payer')", [uid(10)])
  await db.query("insert into public.family_authorizations(patient_id,family_profile_id,status,can_make_payments,revoked_at) values ($1,$2,'revoked',true,now())", [patients[0], uid(10)])

  await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002090000_encounter_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002100000_payment_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002110000_notification_mark_read_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002120000_vital_encounter_integrity.sql'), 'utf8'))

  return { db, patients, providers, encounters, apps, subs, pkgs }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  if (n || role !== 'authenticated') await db.exec(`set local role ${role}`)
}

const insertPayment = (db, patient, app = null, sub = null, payer = uid(1), amount = 45000) =>
  db.query(`insert into public.payments(patient_id,appointment_id,subscription_id,payer_profile_id,amount)
    values ($1,$2,$3,$4,$5) returning id,patient_id,appointment_id,subscription_id,status`,
  [patient, app, sub, payer, amount])

describe('Subscription payment patient integrity', () => {
  let db, patients, providers, encounters, apps, subs, pkgs, oldPayment, policies
  const insert = (patient = patients[0], app = null, sub = subs[0], payer = uid(1), amount = 45000) =>
    insertPayment(db, patient, app, sub, payer, amount)

  beforeAll(async () => {
    ;({ db, patients, providers, encounters, apps, subs, pkgs } = await baseline())
    // Pre-migration valid historical payment
    oldPayment = (await db.query(`insert into public.payments(patient_id,subscription_id,payer_profile_id,amount,currency,status,transaction_reference,paid_at)
      values ($1,$2,$3,45000,'MMK','paid','HIST-SUB-PAY-1',now()) returning *`,
    [patients[0], subs[0], uid(1)])).rows[0]
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)

  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical payments, package relationships, and RLS policies', async () => {
    expect((await db.query('select * from public.payments where id=$1', [oldPayment.id])).rows[0]).toEqual(oldPayment)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='payments_subscription_patient_fk'")).rows)
      .toEqual([{ convalidated: true, condeferrable: false }])
    expect((await db.query("select conname from pg_constraint where conname='subscriptions_id_patient_key'")).rows)
      .toHaveLength(1)
    expect((await db.exec(validation))[0].rows).toEqual([])
  })

  it('authorized patient creates valid subscription payment for own subscription and reads it', async () => {
    await actor(db, 1)
    const row = (await insert()).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.subscription_id).toBe(subs[0])
    expect(row.appointment_id).toBeNull()

    // Patient 1 can read
    expect((await db.query('select id from public.payments where id=$1', [row.id])).rows).toHaveLength(1)
    // Patient 2 cannot read
    await actor(db, 2)
    expect((await db.query('select id from public.payments where id=$1', [row.id])).rows).toEqual([])
  })

  it('legitimate appointment payment from Repair 6 continues working', async () => {
    await actor(db, 1)
    const row = (await insertPayment(db, patients[0], apps[0], null, uid(1), 30000)).rows[0]
    expect(row.appointment_id).toBe(apps[0])
    expect(row.subscription_id).toBeNull()
  })

  it('legitimate hybrid payment referencing both appointment and subscription works when both belong to the patient', async () => {
    await actor(db, 1)
    const row = (await insertPayment(db, patients[0], apps[0], subs[0], uid(1), 45000)).rows[0]
    expect(row.appointment_id).toBe(apps[0])
    expect(row.subscription_id).toBe(subs[0])
  })

  it('authorized family payer can create subscription payment and read it', async () => {
    await actor(db, 9)
    const row = (await insert(patients[0], null, subs[0], uid(9))).rows[0]
    expect(row.id).toBeDefined()
    expect((await db.query('select id from public.payments where id=$1', [row.id])).rows).toHaveLength(1)
  })

  it('exact audit exploit: Patient A payment referencing Patient B subscription fails at database boundary', async () => {
    await actor(db, 1)
    await expect(insert(patients[0], null, subs[1], uid(1)))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it('Patient B payment referencing Patient A subscription fails at database boundary', async () => {
    await actor(db, 2)
    await expect(insert(patients[1], null, subs[0], uid(2)))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it.each(['postgres', 'service_role'])('direct %s write cannot create mismatched subscription payment', async role => {
    await actor(db, null, role === 'postgres' ? 'authenticated' : role)
    await expect(insert(patients[0], null, subs[1]))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it.each(['subscription_id', 'patient_id'])('service role cannot corrupt payment %s via UPDATE', async field => {
    await actor(db, null, 'service_role')
    await expect(db.query(`update public.payments set ${field}=$1 where id=$2`,
      [field === 'subscription_id' ? subs[1] : patients[1], oldPayment.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it('service role valid processing remains functional', async () => {
    await actor(db, null, 'service_role')
    const updated = (await db.query(`update public.payments set status='paid', paid_at=now(), transaction_reference='TX-SR-VALID' where id=$1 returning status`,
      [oldPayment.id])).rows[0]
    expect(updated.status).toBe('paid')
  })

  it('family payer cannot attach payment to wrong patient subscription', async () => {
    await actor(db, 9)
    await expect(insert(patients[0], null, subs[1], uid(9)))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it('patient cannot use foreign patient identity to match foreign subscription', async () => {
    await actor(db, 1)
    await expect(insert(patients[1], null, subs[1], uid(1)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('revoked family payer cannot create payments', async () => {
    await actor(db, 10)
    await expect(insert(patients[0], null, subs[0], uid(10)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('anonymous caller cannot create payment', async () => {
    await actor(db, null, 'anon')
    await expect(insert())
      .rejects.toMatchObject({ code: '42501' })
  })

  it('patient has no direct UPDATE or DELETE privileges', async () => {
    await actor(db, 1)
    expect((await db.query('update public.payments set status=$1 where id=$2 returning id', ['paid', oldPayment.id])).rows).toEqual([])
    expect((await db.query('delete from public.payments where id=$1 returning id', [oldPayment.id])).rows).toEqual([])
  })

  it('still enforces at-least-one-parent CHECK constraint (appointment or subscription)', async () => {
    await actor(db, 1)
    await expect(insert(patients[0], null, null, uid(1)))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('hybrid payment cannot reference foreign subscription even when appointment is valid', async () => {
    await actor(db, 1)
    await expect(insertPayment(db, patients[0], apps[0], subs[1], uid(1)))
      .rejects.toMatchObject({ code: '23503', constraint: 'payments_subscription_patient_fk' })
  })

  it('hybrid payment cannot reference foreign appointment even when subscription is valid', async () => {
    await actor(db, 1)
    await expect(insertPayment(db, patients[0], apps[1], subs[0], uid(1)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('parent subscription patient mutation is restricted', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.subscriptions set patient_id=$1 where id=$2', [patients[1], subs[0]]))
      .rejects.toMatchObject({ code: '23001' })
  })

  it('parent subscription deletion is restricted while payment references it', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('delete from public.subscriptions where id=$1', [subs[0]]))
      .rejects.toMatchObject({ code: '23001' })
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, subs } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, 1)
    const before = (await insertPayment(db, patients[0], null, subs[1], uid(1))).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.subscription_id).toBe(subs[1])
    await db.exec('rollback')
    expect((await db.query('select id from public.payments')).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, 1)
    await expect(insertPayment(db, patients[0], null, subs[1], uid(1))).rejects.toMatchObject({
      code: '23503', constraint: 'payments_subscription_patient_fk',
    })
    await db.exec('rollback')
    expect((await db.query('select id from public.payments')).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports inconsistent subscription payment and migration aborts safely without rewriting data', async () => {
  const { db, patients, subs } = await baseline()
  try {
    const corruptPayment = (await db.query(`insert into public.payments(patient_id,subscription_id,payer_profile_id,amount,currency,status,transaction_reference)
      values ($1,$2,$3,45000,'MMK','pending','AUDIT-CORRUPT-SUB-1') returning *`,
    [patients[0], subs[1], uid(1)])).rows[0]

    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[0].rows[0].structural_blocker).toBe(true)
    expect(reports[0].rows[0].review_reasons).toContain('patient_mismatch')

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Subscription payment repair stopped'),
    })
    await db.exec('rollback')
    expect((await db.query('select * from public.payments where id=$1', [corruptPayment.id])).rows[0]).toEqual(corruptPayment)
    expect((await db.query("select conname from pg_constraint where conname='payments_subscription_patient_fk'")).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)
