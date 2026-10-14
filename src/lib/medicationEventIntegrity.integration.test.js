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
const migration = readFileSync(join(directory, '20261002140000_medication_event_patient_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/medication_event_validation.sql'), 'utf8')
const uid = n => `87000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  const patients = [], providers = [], encounters = [], meds = [], schedules = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Med event patient ${n}`, phone: `+95987000000${n}`,
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
    [patients[i], providers[i], `2026-10-0${i + 1}T09:00Z`, `2026-10-0${i + 1}T09:30Z`, `MED-EVT-BASE-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)

    const med = (await db.query(`insert into public.patient_medications(patient_id,medication_name,dose,frequency,start_date,created_by_profile_id)
      values ($1,$2,'500mg','once daily','2026-01-01',$3) returning id`,
      [patients[i], `Medication ${i + 1}`, uid(3)])).rows[0].id
    meds.push(med)

    const sched = (await db.query(`insert into public.medication_schedules(patient_medication_id,time_of_day,timezone)
      values ($1,'08:00:00','Asia/Yangon') returning id`, [med])).rows[0].id
    schedules.push(sched)
  }

  await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002090000_encounter_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002100000_payment_appointment_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002110000_notification_mark_read_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002120000_vital_encounter_integrity.sql'), 'utf8'))
  await db.exec(readFileSync(join(directory, '20261002130000_subscription_payment_integrity.sql'), 'utf8'))

  return { db, patients, providers, encounters, meds, schedules }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  if (n || role !== 'authenticated') await db.exec(`set local role ${role}`)
}

const insertEvent = (db, patient, schedule, scheduledAt = '2026-10-02T08:00:00Z', status = 'pending') =>
  db.query(`insert into public.medication_events(patient_id,schedule_id,scheduled_at,status)
    values ($1,$2,$3,$4) returning id,patient_id,schedule_id,status,scheduled_at`,
  [patient, schedule, scheduledAt, status])

describe('Medication event to schedule patient integrity', () => {
  let db, patients, providers, encounters, meds, schedules, oldEvent, policies
  const insert = (patient = patients[0], schedule = schedules[0], time = '2026-10-02T08:00:00Z', status = 'pending') =>
    insertEvent(db, patient, schedule, time, status)

  beforeAll(async () => {
    ;({ db, patients, providers, encounters, meds, schedules } = await baseline())
    // Pre-migration valid historical event
    const inserted = (await insert(patients[0], schedules[0], '2026-09-01T08:00:00Z', 'taken')).rows[0]
    oldEvent = (await db.query('select * from public.medication_events where id=$1', [inserted.id])).rows[0]
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)

  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical medication events and RLS policies', async () => {
    expect((await db.query('select * from public.medication_events where id=$1', [oldEvent.id])).rows[0]).toEqual(oldEvent)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    expect((await db.exec(validation))[0].rows).toEqual([])
  })

  it('service role creates valid Patient A event for Patient A schedule', async () => {
    await actor(db, null, 'service_role')
    const row = (await insert()).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.schedule_id).toBe(schedules[0])
    expect(row.status).toBe('pending')
  })

  it('patient reads authorized medication events and cannot read another patient events', async () => {
    await actor(db, null, 'service_role')
    const eventA = (await insert(patients[0], schedules[0])).rows[0]
    const eventB = (await insert(patients[1], schedules[1])).rows[0]

    // Patient 1 reads own events
    await actor(db, 1)
    const p1Rows = (await db.query('select id from public.medication_events where id = any($1::uuid[])', [[eventA.id, eventB.id]])).rows
    expect(p1Rows).toEqual([{ id: eventA.id }])

    // Patient 2 reads own events
    await actor(db, 2)
    const p2Rows = (await db.query('select id from public.medication_events where id = any($1::uuid[])', [[eventA.id, eventB.id]])).rows
    expect(p2Rows).toEqual([{ id: eventB.id }])
  })

  it('legitimate mark-as-taken workflow via record_medication_event_status succeeds', async () => {
    await actor(db, null, 'service_role')
    const event = (await insert(patients[0], schedules[0])).rows[0]

    await actor(db, 1)
    const confirmed = (await db.query('select * from public.record_medication_event_status($1, $2)', [event.id, 'taken'])).rows[0]
    expect(confirmed.status).toBe('taken')
    expect(confirmed.confirmed_by_profile_id).toBe(uid(1))
    expect(confirmed.confirmed_at).toBeDefined()
  })

  it('legitimate mark-as-skipped workflow via record_medication_event_status succeeds', async () => {
    await actor(db, null, 'service_role')
    const event = (await insert(patients[0], schedules[0])).rows[0]

    await actor(db, 1)
    const confirmed = (await db.query('select * from public.record_medication_event_status($1, $2)', [event.id, 'skipped'])).rows[0]
    expect(confirmed.status).toBe('skipped')
    expect(confirmed.confirmed_by_profile_id).toBe(uid(1))
  })

  it('adherence calculation remains correct', async () => {
    await actor(db, null, 'service_role')
    await insert(patients[0], schedules[0], '2026-10-01T08:00:00Z', 'taken')
    await insert(patients[0], schedules[0], '2026-10-02T08:00:00Z', 'skipped')
    await insert(patients[0], schedules[0], '2026-10-03T08:00:00Z', 'missed')
    await insert(patients[0], schedules[0], '2026-10-04T08:00:00Z', 'pending')

    const stats = (await db.query(`
      select
        count(*) filter (where status = 'taken') as taken_count,
        count(*) filter (where status in ('taken', 'missed', 'skipped')) as total_reported,
        round(100.0 * count(*) filter (where status = 'taken') / nullif(count(*) filter (where status in ('taken', 'missed', 'skipped')), 0), 1) as adherence_pct
      from public.medication_events
      where patient_id = $1 and scheduled_at >= '2026-10-01'
    `, [patients[0]])).rows[0]

    expect(Number(stats.taken_count)).toBe(1)
    expect(Number(stats.total_reported)).toBe(3)
    expect(Number(stats.adherence_pct)).toBe(33.3)
  })

  it('exact audit exploit: Patient A event referencing Patient B schedule fails at database boundary', async () => {
    await actor(db, null, 'service_role')
    await expect(insert(patients[0], schedules[1]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication event patient mismatch') })
  })

  it('Patient B event referencing Patient A schedule fails at database boundary', async () => {
    await actor(db, null, 'service_role')
    await expect(insert(patients[1], schedules[0]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication event patient mismatch') })
  })

  it.each(['postgres', 'service_role'])('direct %s write cannot create mismatched medication event', async role => {
    await actor(db, null, role === 'postgres' ? 'authenticated' : role)
    await expect(insert(patients[0], schedules[1]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication event patient mismatch') })
  })

  it.each(['schedule_id', 'patient_id'])('service role cannot corrupt event %s via UPDATE', async field => {
    await actor(db, null, 'service_role')
    await expect(db.query(`update public.medication_events set ${field}=$1 where id=$2`,
      [field === 'schedule_id' ? schedules[1] : patients[1], oldEvent.id]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication event patient mismatch') })
  })

  it('patient cannot directly INSERT into medication_events', async () => {
    await actor(db, 1)
    await expect(insert(patients[0], schedules[0]))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('anonymous caller cannot select or insert medication_events', async () => {
    await actor(db, null, 'anon')
    expect((await db.query('select * from public.medication_events')).rows).toEqual([])
    await expect(insert()).rejects.toMatchObject({ code: '42501' })
  })

  it('patient cannot confirm another patient event', async () => {
    await actor(db, null, 'service_role')
    const eventB = (await insert(patients[1], schedules[1])).rows[0]

    await actor(db, 1)
    await expect(db.query('select * from public.record_medication_event_status($1, $2)', [eventB.id, 'taken']))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('parent schedule medication reassignment is guarded against invalidating event ownership', async () => {
    await actor(db, null, 'service_role')
    const eventA = (await insert(patients[0], schedules[0])).rows[0]
    expect(eventA.id).toBeDefined()

    // Attempt to reassign Schedule A to Patient B's medication
    await expect(db.query('update public.medication_schedules set patient_medication_id = $1 where id = $2',
      [meds[1], schedules[0]]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Medication schedule reassignment') })
  })

  it('parent patient_medication patient reassignment is guarded against invalidating event ownership', async () => {
    await actor(db, null, 'service_role')
    const eventA = (await insert(patients[0], schedules[0])).rows[0]
    expect(eventA.id).toBeDefined()

    // Attempt to reassign Medication A's patient to Patient B
    await expect(db.query('update public.patient_medications set patient_id = $1 where id = $2',
      [patients[1], meds[0]]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Patient medication reassignment') })
  })

  it('parent schedule deletion is restricted while events exist', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('delete from public.medication_schedules where id = $1', [schedules[0]]))
      .rejects.toMatchObject({ code: '23001' })
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, schedules } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, null, 'service_role')
    const before = (await insertEvent(db, patients[0], schedules[1])).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.schedule_id).toBe(schedules[1])
    await db.exec('rollback')
    expect((await db.query('select id from public.medication_events')).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, null, 'service_role')
    await expect(insertEvent(db, patients[0], schedules[1])).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Medication event patient mismatch'),
    })
    await db.exec('rollback')
    expect((await db.query('select id from public.medication_events')).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports inconsistent medication event and migration aborts safely without rewriting data', async () => {
  const { db, patients, schedules } = await baseline()
  try {
    const corruptEvent = (await db.query(`insert into public.medication_events(patient_id,schedule_id,scheduled_at,status)
      values ($1,$2,now(),'pending') returning *`, [patients[0], schedules[1]])).rows[0]

    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[0].rows[0].reason).toBe('patient_mismatch')

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Medication event repair stopped'),
    })
    await db.exec('rollback')
    expect((await db.query('select * from public.medication_events where id=$1', [corruptEvent.id])).rows[0]).toEqual(corruptEvent)
    expect((await db.query("select proname from pg_proc where proname = 'check_medication_event_patient_chain'")).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)
