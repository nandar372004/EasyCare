// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261002150000_monitoring_alert_vital_patient_integrity.sql'
const migration = readFileSync(join(directory, '20261002160000_medication_prescription_patient_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/medication_prescription_validation.sql'), 'utf8')
const uid = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  const patients = [], providers = [], encounters = [], prescriptions = [], items = [], meds = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Med prescription patient ${n}`, phone: `+95992200000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id", [uid(n), role])).rows[0].id)
  }
  // Repair 4 requires an authoritative price and Repair 5 requires a matching slot.
  await db.query('update public.providers set consultation_fee_mmk=30000 where id=any($1::uuid[])', [providers])
  for (const i of [0, 1]) {
    const slot = (await db.query("insert into public.provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2037-01-01T09:00Z','2037-01-01T09:30Z') returning id", [providers[i]])).rows[0].id
    const appointment = (await db.query(`insert into public.appointments(patient_id,provider_id,provider_availability_id,appointment_type,
      scheduled_start,scheduled_end,consultation_channel,booking_code)
      values ($1,$2,$3,'teleconsultation','2037-01-01T09:00Z','2037-01-01T09:30Z','video',$4) returning id`,
    [patients[i], providers[i], slot, `MEDRX-BASE-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
    const prescription = (await db.query(
      'insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
      [encounters[i], patients[i], providers[i]])).rows[0].id
    prescriptions.push(prescription)
    items.push((await db.query(
      "insert into public.prescription_items(prescription_id,medication_name) values ($1,$2) returning id",
      [prescription, `Prescribed medication ${i + 1}`])).rows[0].id)
  }
  return { db, patients, providers, encounters, prescriptions, items }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  if (n || role !== 'authenticated') await db.exec(`set local role ${role}`)
}

const insertMedication = (db, patient, item, name = 'Test medication') =>
  db.query(`insert into public.patient_medications(patient_id,prescription_item_id,medication_name,created_by_profile_id)
    values ($1,$2,$3,$4) returning id,patient_id,prescription_item_id`,
  [patient, item, name, uid(3)])

describe('Medication prescription item patient integrity', () => {
  let db, patients, providers, encounters, prescriptions, items, meds, schedules, events, manualMed, oldMed, policies

  // Prescribed medications for a patient whose prescription chain already exists.
  const prescribed = async index => {
    await actor(db, null, 'service_role')
    return (await insertMedication(db, patients[index], items[index])).rows[0]
  }
  const insertSchedule = (db, medication) =>
    db.query(`insert into public.medication_schedules(patient_medication_id,time_of_day,timezone)
      values ($1,'08:00:00','Asia/Yangon') returning id`, [medication])

  beforeAll(async () => {
    ;({ db, patients, providers, encounters, prescriptions, items } = await baseline())
    // Existing valid historical data: prescribed medication -> schedule -> event.
    meds = []
    schedules = []
    events = []
    for (const i of [0, 1]) {
      const med = (await insertMedication(db, patients[i], items[i], `Historical medication ${i + 1}`)).rows[0]
      meds.push(med)
      schedules.push((await insertSchedule(db, med.id)).rows[0].id)
      events.push((await db.query("insert into public.medication_events(patient_id,schedule_id,scheduled_at) values ($1,$2,'2026-10-02T08:00:00Z') returning id",
        [patients[i], schedules[i]])).rows[0].id)
    }
    // Manual medication with no prescription origin must keep working, and must
    // still support the Repair 10 schedule/event chain below it.
    const manual = (await db.query(
      "insert into public.patient_medications(patient_id,medication_name,status) values ($1,'Historical manual medication','active') returning id",
      [patients[0]])).rows[0]
    manualMed = manual.id
    const manualSchedule = (await insertSchedule(db, manualMed)).rows[0].id
    await db.query("insert into public.medication_events(patient_id,schedule_id,scheduled_at) values ($1,$2,'2026-10-04T08:00:00Z')", [patients[0], manualSchedule])
    oldMed = (await db.query('select * from public.patient_medications where id=$1', [meds[0].id])).rows[0]
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)
  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical medications, chains and every RLS policy', async () => {
    expect((await db.query('select * from public.patient_medications where id=$1', [oldMed.id])).rows[0]).toEqual(oldMed)
    expect((await db.query('select count(*)::int as n from public.patient_medications')).rows[0].n).toBe(3)
    expect((await db.query('select count(*)::int as n from public.medication_events')).rows[0].n).toBe(3)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    expect((await db.exec(validation)).map(r => r.rows))
      .toEqual([[], [], [], [], [{ manual_medication_count: 1 }]])
  })

  it('Patient A medication from Patient A prescription item is allowed and readable by the patient', async () => {
    const row = await prescribed(0)
    expect(row.patient_id).toBe(patients[0])
    expect(row.prescription_item_id).toBe(items[0])
    await actor(db, 1)
    expect((await db.query('select id from public.patient_medications where id=$1', [row.id])).rows).toHaveLength(1)
    await actor(db, 2)
    expect((await db.query('select id from public.patient_medications where id=$1', [row.id])).rows).toEqual([])
  })

  it('preserves legitimate manually entered medication with no prescription item', async () => {
    await actor(db, null, 'service_role')
    const row = (await db.query(
      "insert into public.patient_medications(patient_id,medication_name,status) values ($1,'Manual over the counter','active') returning id,prescription_item_id",
      [patients[1]])).rows[0]
    expect(row.prescription_item_id).toBeNull()
  })

  it('one prescription item may generate multiple patient medications for the same patient', async () => {
    const first = await prescribed(0)
    const second = await insertMedication(db, patients[0], items[0], 'Second course from same item')
    expect((await second).rows[0].id).not.toBe(first.id)
  })

  it('medication schedule and event remain creatable after a valid medication', async () => {
    const med = await prescribed(0)
    const schedule = (await insertSchedule(db, med.id)).rows[0]
    const event = (await db.query(
      "insert into public.medication_events(patient_id,schedule_id,scheduled_at) values ($1,$2,'2026-10-03T08:00:00Z') returning id",
      [patients[0], schedule.id])).rows[0]
    expect(event.id).toBeTruthy()
  })

  it('exact audit exploit fails at the relationship boundary for service_role', async () => {
    await actor(db, null, 'service_role')
    await expect(insertMedication(db, patients[0], items[1]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Patient medication prescription mismatch') })
  })

  it('reverse exploit is equally denied', async () => {
    await actor(db, null, 'service_role')
    await expect(insertMedication(db, patients[1], items[0]))
      .rejects.toMatchObject({ code: '23514' })
  })

  it.each(['authenticated', 'service_role'])('%s direct SQL cannot insert a cross-patient medication', async role => {
    await actor(db, null, role)
    await expect(insertMedication(db, patients[0], items[1])).rejects.toMatchObject({ code: '23514' })
  })

  it('service_role cross-patient UPDATE of patient_id is denied', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.patient_medications set patient_id=$1 where id=$2', [patients[1], oldMed.id]))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('service_role cross-patient UPDATE of prescription_item_id is denied', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.patient_medications set prescription_item_id=$1 where id=$2', [items[1], oldMed.id]))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('parent prescription item cannot be re-pointed to another patient prescription', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.prescription_items set prescription_id=$1 where id=$2', [prescriptions[1], items[0]]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Prescription item reassignment') })
  })

  it('parent prescription cannot move to another patient while a medication references its item', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.prescriptions set patient_id=$1 where id=$2', [patients[1], prescriptions[0]]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Prescription patient reassignment') })
  })

  it('an unreferenced prescription item still lets Repair 1 be the only authority on patient moves', async () => {
    await actor(db, null, 'service_role')
    const spare = (await db.query(
      'insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
      [encounters[0], patients[0], providers[0]])).rows[0].id
    await db.query("insert into public.prescription_items(prescription_id,medication_name) values ($1,'Unreferenced item')", [spare])
    // No medication references this prescription, so Repair 12 must not fire;
    // Repair 1's encounter foreign key remains the rejecting boundary.
    await expect(db.query('update public.prescriptions set patient_id=$1 where id=$2', [patients[1], spare]))
      .rejects.toMatchObject({ code: '23503', constraint: 'prescriptions_encounter_patient_fk' })
  })

  it('unreferenced prescription item may be re-pointed freely', async () => {
    await actor(db, null, 'service_role')
    const spare = (await db.query("insert into public.prescription_items(prescription_id,medication_name) values ($1,'Unreferenced item') returning id", [prescriptions[0]])).rows[0]
    expect((await db.query('update public.prescription_items set prescription_id=$1 where id=$2 returning id', [prescriptions[0], spare.id])).rows).toHaveLength(1)
  })

  it('unknown prescription item still reports the pre-existing foreign key error', async () => {
    await actor(db, null, 'service_role')
    await expect(insertMedication(db, patients[0], uid(98))).rejects.toMatchObject({ code: '23503' })
  })

  it('legitimate medication metadata update remains allowed', async () => {
    await actor(db, null, 'service_role')
    expect((await db.query(
      "update public.patient_medications set status='discontinued',discontinued_at=now(),discontinued_reason='Course ended' where id=$1 returning id",
      [oldMed.id])).rows).toHaveLength(1)
  })

  it('unauthorized patient cannot create a medication', async () => {
    await actor(db, 1)
    await expect(insertMedication(db, patients[0], items[0])).rejects.toMatchObject({ code: '42501' })
  })

  it('anonymous caller cannot create a medication', async () => {
    await actor(db, null, 'anon')
    await expect(insertMedication(db, patients[0], items[0])).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['suspended', 'inactive'])('%s provider remains denied', async status => {
    await db.query('update public.profiles set status=$1 where id=$2', [status, uid(3)])
    await actor(db, 3)
    await expect(db.query(
      'insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
      [encounters[0], patients[0], providers[0]])).rejects.toMatchObject({ code: '42501' })
  })

  it('unverified provider remains denied', async () => {
    await db.query("update public.providers set verification_status='pending' where id=$1", [providers[0]])
    await actor(db, 3)
    await expect(db.query(
      'insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
      [encounters[0], patients[0], providers[0]])).rejects.toMatchObject({ code: '42501' })
  })

  it('Repair 1 prescription/encounter integrity is not weakened', async () => {
    expect((await db.query("select conname from pg_constraint where conname='prescriptions_encounter_patient_fk'")).rows)
      .toEqual([{ conname: 'prescriptions_encounter_patient_fk' }])
    await actor(db, null, 'service_role')
    await expect(db.query(
      'insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
      [encounters[1], patients[0], providers[0]]))
      .rejects.toMatchObject({ code: '23503', constraint: 'prescriptions_encounter_patient_fk' })
  })

  it('Repair 10 medication event chain integrity is not weakened', async () => {
    expect((await db.query("select count(*)::int as n from pg_policies where tablename='patient_medications' and policyname='clinical_identity_required'")).rows)
      .toEqual([{ n: 1 }])
    expect((await db.query(
      "select tgname from pg_trigger where tgrelid='public.patient_medications'::regclass and not tgisinternal order by tgname")).rows.map(r => r.tgname))
      .toEqual(['patient_medications_parent_guard', 'patient_medications_prescription_guard'])
    await actor(db, null, 'service_role')
    // The manual medication has no prescription item, so Repair 12 defers and
    // Repair 10's own guard is the one that must reject.
    await expect(db.query('update public.patient_medications set patient_id=$1 where id=$2', [patients[1], manualMed]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Patient medication reassignment') })
  })

  it('Repair 10 medication event chain integrity is not weakened', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.medication_events set patient_id=$1 where id=$2', [patients[0], events[1]]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication event patient mismatch') })
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, items } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, null, 'service_role')
    const before = (await insertMedication(db, patients[0], items[1])).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.prescription_item_id).toBe(items[1])
    await db.exec('rollback')
    expect((await db.query('select count(*)::int as n from public.patient_medications')).rows[0].n).toBe(0)

    await db.exec(migration)
    await actor(db, null, 'service_role')
    await expect(insertMedication(db, patients[0], items[1]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Patient medication prescription mismatch') })

    expect((await db.query(`select count(*)::int as n from public.patient_medications m
      join public.prescription_items i on i.id = m.prescription_item_id
      join public.prescriptions p on p.id = i.prescription_id
      where m.patient_id is distinct from p.patient_id`)).rows[0].n).toBe(0)
    expect((await db.query('select count(*)::int as n from public.patient_medications')).rows[0].n).toBe(0)
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports the cross-patient medication and migration aborts without rewriting clinical data', async () => {
  const { db, patients, items } = await baseline()
  try {
    const bad = (await insertMedication(db, patients[0], items[1], 'Historical inconsistent medication')).rows[0]
    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[1].rows).toEqual([])
    expect(reports[2].rows).toEqual([])
    expect(reports[3].rows).toEqual([])
    expect(reports[4].rows).toEqual([{ manual_medication_count: 0 }])

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Medication prescription relationship repair stopped'),
    })
    await db.exec('rollback')

    expect((await db.query('select * from public.patient_medications where id=$1', [bad.id])).rows[0].medication_name).toBe('Historical inconsistent medication')
    expect((await db.query("select count(*)::int as n from pg_trigger where tgrelid='public.patient_medications'::regclass and tgname='patient_medications_prescription_guard'")).rows[0].n).toBe(0)
    expect((await db.query("select count(*)::int as n from pg_proc where proname='check_medication_prescription_patient_chain'")).rows[0].n).toBe(0)
  } finally {
    await db.close()
  }
}, 60000)