// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const baselineCutoff = '20261001100000_follow_up_patient_integrity.sql'
const migrationName = '20261002170000_appointment_care_request_patient_integrity.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/appointment_care_request_validation.sql'), 'utf8')
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
  for (const name of readdirSync(directory).filter(n => n.endsWith('.sql') && n < baselineCutoff).sort()) {
    await db.exec(readFileSync(join(directory, name), 'utf8'))
  }
  for (const n of [1, 2, 3, 4, 5]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])

  const patients = [], providers = [], requests = [], appointments = [], encounters = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Care request patient ${n}`, phone: `+95989000000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
    requests.push((await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Synthetic care request') returning id`, [patients[n - 1], uid(n)])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id",
      [uid(n), role])).rows[0].id)
  }
  for (const provider of providers) {
    await db.query('update public.providers set consultation_fee_mmk = 30000 where id = $1', [provider])
  }

  // Historical valid rows, created before Repair 4 pricing enforcement.
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,$3,'teleconsultation','2026-09-01T09:00Z','2026-09-01T09:30Z','video','CARE-REQ-HIST-0') returning id`,
  [patients[0], providers[0], requests[0]])).rows[0].id)
  // Standalone appointment with no care request is a supported booking.
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,'teleconsultation','2026-09-02T09:00Z','2026-09-02T09:30Z','video','CARE-REQ-HIST-1') returning id`,
  [patients[0], providers[0]])).rows[0].id)
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,$3,'teleconsultation','2026-09-03T09:00Z','2026-09-03T09:30Z','video','CARE-REQ-HIST-2') returning id`,
  [patients[1], providers[1], requests[1]])).rows[0].id)

  for (const i of [0, 2]) {
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`,
    [appointments[i], i === 2 ? patients[1] : patients[0], i === 2 ? providers[1] : providers[0]])).rows[0].id)
  }

  for (const name of readdirSync(directory)
    .filter(n => n.endsWith('.sql') && n > baselineCutoff && n < migrationName).sort()) {
    await db.exec(readFileSync(join(directory, name), 'utf8'))
  }

  return { db, patients, providers, requests, appointments, encounters }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}

describe('Appointment to care-request patient integrity', () => {
  let db, patients, providers, requests, appointments, encounters
  let history, policies, fees

  // Slots must not overlap for the same provider; 90 minutes apart keeps every booking valid.
  const newSlot = async (provider = providers[0]) => {
    const index = await db.query('select count(*)::int as n from public.provider_availability')
    const minutes = index.rows[0].n * 90
    const start = new Date(Date.UTC(2031, 2, 4, 8, minutes, 0)).toISOString()
    const end = new Date(Date.UTC(2031, 2, 4, 8, minutes + 30, 0)).toISOString()
    return (await db.query(`insert into public.provider_availability(provider_id,service_type,start_at,end_at)
      values ($1,'teleconsultation',$2,$3) returning id,start_at,end_at`, [provider, start, end])).rows[0]
  }

  const bookInto = (slot, patient = patients[0], provider = providers[0], careRequest = null) =>
    db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,provider_availability_id,
      appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,$4,'teleconsultation','video',$5,$6,$7)
      returning id,patient_id,care_request_id,fee_amount,currency,status`,
    [patient, provider, careRequest, slot.id, slot.start_at, slot.end_at, `CARE-REQ-${slot.id}`])

  const book = async (patient = patients[0], provider = providers[0], careRequest = null) =>
    bookInto(await newSlot(provider), patient, provider, careRequest)

  // Patients have no column grant for care_request_id at all; the client booking
  // path therefore can never supply the link.
  const bookAsPatient = (slot, patient = patients[0], provider = providers[0]) =>
    db.query(`insert into public.appointments(patient_id,provider_id,provider_availability_id,
      appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,'teleconsultation','video',$4,$5,$6)
      returning id,patient_id,fee_amount,currency`,
    [patient, provider, slot.id, slot.start_at, slot.end_at, `PATIENT-BOOK-${slot.id}`])

  beforeAll(async () => {
    ;({ db, patients, providers, requests, appointments, encounters } = await baseline())
    fees = (await db.query('select consultation_fee_mmk from public.providers where id = any($1::uuid[]) order by id', [providers])).rows
    history = (await db.query('select * from public.appointments order by id')).rows
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)

  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical appointments and RLS policies, and reports no inconsistencies', async () => {
    expect((await db.query('select * from public.appointments order by id')).rows).toEqual(history)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([])
    expect(reports[1].rows).toEqual([])
    expect(reports[2].rows).toEqual([])
    expect(reports[3].rows).toEqual([])
  })

  it('declarative composite constraint is installed, not a trigger', async () => {
    expect((await db.query(`select conname, contype, confupdtype, confdeltype, confmatchtype
      from pg_constraint where conrelid = 'public.appointments'::regclass
        and conname = 'appointments_care_request_patient_fk'`)).rows).toEqual([{
      conname: 'appointments_care_request_patient_fk', contype: 'f',
      confupdtype: 'r', confdeltype: 'r', confmatchtype: 's',
    }])
    expect((await db.query(`select conname from pg_constraint
      where conrelid = 'public.care_requests'::regclass and conname = 'care_requests_id_patient_key'`)).rows)
      .toEqual([{ conname: 'care_requests_id_patient_key' }])
    expect((await db.query(`select tgname from pg_trigger
      where tgrelid = 'public.appointments'::regclass and tgname = 'appointments_care_request_patient_fk'`)).rows).toEqual([])
  })

  it('service role creates Patient A appointment for Patient A care request', async () => {
    await actor(db, null, 'service_role')
    const row = (await book(patients[0], providers[0], requests[0])).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.care_request_id).toBe(requests[0])
  })

  it('one care request may legitimately produce multiple appointments', async () => {
    await actor(db, null, 'service_role')
    const first = (await book(patients[0], providers[0], requests[0])).rows[0]
    const second = (await book(patients[0], providers[0], requests[0])).rows[0]
    expect(first.care_request_id).toBe(requests[0])
    expect(second.care_request_id).toBe(requests[0])
  })

  it('standalone appointment without a care request stays supported', async () => {
    await actor(db, null, 'service_role')
    const row = (await book(patients[0], providers[0], null)).rows[0]
    expect(row.care_request_id).toBeNull()
    expect(Number((await db.query('select count(*) from public.appointments where care_request_id is null')).rows[0].count))
      .toBeGreaterThanOrEqual(2)
  })

  it('direct patient booking without a care request still works', async () => {
    const slot = await newSlot(providers[0])
    await actor(db, 1)
    const row = (await bookAsPatient(slot)).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(Number(row.fee_amount)).toBe(30000)
    expect(row.currency).toBe('MMK')
  })

  it('patients cannot supply a care request link at all', async () => {
    const slot = await newSlot(providers[0])
    await actor(db, 1)
    await expect(bookInto(slot, patients[0], providers[0], requests[0]))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('patient cannot insert an appointment for another patient', async () => {
    const slot = await newSlot(providers[0])
    await actor(db, 2)
    await expect(bookAsPatient(slot, patients[0], providers[0])).rejects.toMatchObject({ code: '42501' })
  })

  it('patient appointment reads stay isolated to their own patient', async () => {
    const ids = (await db.query('select id from public.appointments order by id')).rows.map(r => r.id)
    const visible = async n => {
      await actor(db, n)
      return (await db.query('select id from public.appointments where id = any($1::uuid[])', [ids]))
        .rows.map(r => r.id).sort()
    }
    expect(await visible(1)).toEqual([appointments[0], appointments[1]].sort())
    expect(await visible(2)).toEqual([appointments[2]])
  })

  it('exact audit exploit: service role points Patient A appointment at Patient B care request', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.appointments set care_request_id=$1 where id=$2', [requests[1], appointments[0]]))
      .rejects.toMatchObject({ code: '23503', constraint: 'appointments_care_request_patient_fk' })
  })

  it('service role INSERT of Patient A appointment against Patient B care request is denied', async () => {
    await actor(db, null, 'service_role')
    await expect(book(patients[0], providers[0], requests[1]))
      .rejects.toMatchObject({ code: '23503', constraint: 'appointments_care_request_patient_fk' })
  })

  it('Patient B appointment against Patient A care request is denied', async () => {
    await actor(db, null, 'service_role')
    await expect(book(patients[1], providers[1], requests[0]))
      .rejects.toMatchObject({ code: '23503', constraint: 'appointments_care_request_patient_fk' })
  })

  it('direct superuser SQL cross-patient INSERT and UPDATE are denied', async () => {
    await actor(db, null, 'service_role')
    const spare = (await book(patients[0], providers[0], requests[0])).rows[0]
    const spareB = (await book(patients[1], providers[1], requests[1])).rows[0]
    const slot = await newSlot(providers[0])

    await actor(db, null, 'postgres')
    const denied = async (run, match) => {
      await db.exec('savepoint sp')
      try {
        await expect(run()).rejects.toMatchObject(match)
      } finally {
        await db.exec('rollback to savepoint sp')
      }
    }
    await denied(() => db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,provider_availability_id,
      appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,$4,'teleconsultation','video',$5,$6,'DIRECT-SQL-CROSS')`,
    [patients[0], providers[0], requests[1], slot.id, slot.start_at, slot.end_at]),
    { code: '23503', constraint: 'appointments_care_request_patient_fk' })
    await denied(() => db.query('update public.appointments set care_request_id=$1 where id=$2', [requests[0], spareB.id]),
      { code: '23503', constraint: 'appointments_care_request_patient_fk' })
    await denied(() => db.query('update public.appointments set patient_id=$1 where id=$2', [patients[0], spareB.id]),
      { code: '23503', constraint: 'appointments_care_request_patient_fk' })
    await denied(() => db.query('update public.appointments set care_request_id=$1 where id=$2', [requests[1], spare.id]),
      { code: '23503', constraint: 'appointments_care_request_patient_fk' })
  })

  it('changing appointment.patient_id is allowed once the appointment has no care request', async () => {
    await actor(db, null, 'service_role')
    const row = (await db.query('update public.appointments set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], appointments[1]])).rows[0]
    expect(row.patient_id).toBe(patients[1])
  })

  it('clearing an appointment care request back to NULL is allowed', async () => {
    await actor(db, null, 'service_role')
    const row = (await db.query('update public.appointments set care_request_id=null where id=$1 returning care_request_id',
      [appointments[0]])).rows[0]
    expect(row.care_request_id).toBeNull()
  })

  it('care request ownership cannot be moved while a linked appointment exists', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('update public.care_requests set patient_id=$1 where id=$2', [patients[1], requests[0]]))
      .rejects.toMatchObject({
        code: '23001',
        message: expect.stringContaining('appointments_care_request_patient_fk'),
      })
  })

  it('care request ownership can change when no appointment is linked', async () => {
    await actor(db, null, 'service_role')
    const orphan = (await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Unlinked') returning id`, [patients[0], uid(1)])).rows[0].id
    const row = (await db.query('update public.care_requests set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], orphan])).rows[0]
    expect(row.patient_id).toBe(patients[1])
  })

  it('deleting a care request referenced by an appointment remains restricted', async () => {
    await actor(db, null, 'service_role')
    await expect(db.query('delete from public.care_requests where id=$1', [requests[0]]))
      .rejects.toMatchObject({ code: '23001' })
  })

  it('anonymous caller cannot read or create appointments', async () => {
    const slot = await newSlot(providers[0])
    await actor(db, null, 'anon')
    const denied = async (run, match) => {
      await db.exec('savepoint anon_sp')
      try {
        await expect(run()).rejects.toMatchObject(match)
      } finally {
        await db.exec('rollback to savepoint anon_sp')
      }
    }
    await denied(() => db.query('select * from public.appointments'), { code: '42501' })
    await denied(() => bookInto(slot), { code: '42501' })
  })

  it('Repair 4 pricing integrity still applies after this repair', async () => {
    expect(fees.every(f => Number(f.consultation_fee_mmk) === 30000)).toBe(true)
    expect(fees).toHaveLength(providers.length)
    await actor(db, null, 'service_role')
    const row = (await book(patients[0], providers[0], requests[0])).rows[0]
    expect(Number(row.fee_amount)).toBe(30000)
    expect(row.currency).toBe('MMK')
    await expect(db.query('update public.appointments set fee_amount=0 where id=$1', [row.id]))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('Repair 5 encounter appointment integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    const appointment = (await book(patients[0], providers[0], requests[0])).rows[0]
    const encounter = (await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id,patient_id`, [appointment.id, patients[0], providers[0]])).rows[0]
    expect(encounter.patient_id).toBe(patients[0])
    await expect(db.query('update public.care_encounters set patient_id=$1 where id=$2', [patients[1], encounter.id]))
      .rejects.toMatchObject({ code: '23503', constraint: 'care_encounters_appointment_patient_fk' })
  })

  it('Repair 3 suspended provider remains blocked from clinical access', async () => {
    await db.query("update public.profiles set status='suspended' where id=$1", [uid(3)])
    await actor(db, 3)
    expect((await db.query('select id from public.care_encounters')).rows).toEqual([])
  })

  it('care assignment cross-patient observation is reported, not repaired here', async () => {
    await actor(db, null, 'service_role')
    await db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,$4,'accepted')`, [requests[1], appointments[0], providers[0], uid(3)])
    const reports = await db.exec(validation)
    expect(reports[2].rows).toHaveLength(1)
    expect(reports[2].rows[0].appointment_id).toBe(appointments[0])
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, requests, appointments } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, null, 'service_role')
    const before = (await db.query('update public.appointments set care_request_id=$1 where id=$2 returning id,patient_id,care_request_id',
      [requests[1], appointments[0]])).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.care_request_id).toBe(requests[1])
    await db.exec('rollback')
    expect((await db.query('select care_request_id from public.appointments where id=$1', [appointments[0]])).rows)
      .toEqual([{ care_request_id: requests[0] }])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, null, 'service_role')
    await expect(db.query('update public.appointments set care_request_id=$1 where id=$2',
      [requests[1], appointments[0]]))
      .rejects.toMatchObject({ code: '23503', constraint: 'appointments_care_request_patient_fk' })
    await db.exec('rollback')
    expect((await db.query('select care_request_id from public.appointments where id=$1', [appointments[0]])).rows)
      .toEqual([{ care_request_id: requests[0] }])
    expect(Number((await db.query(`select count(*) from public.appointments a
      join public.care_requests r on r.id = a.care_request_id
      where r.patient_id is distinct from a.patient_id`)).rows[0].count)).toBe(0)
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports the mismatch and migration aborts safely without rewriting data', async () => {
  const { db, patients, requests, appointments } = await baseline()
  try {
    const corrupt = (await db.query('update public.appointments set care_request_id=$1 where id=$2 returning *',
      [requests[1], appointments[0]])).rows[0]

    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[0].rows[0].reason).toBe('patient_mismatch')

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Appointment repair stopped'),
    })
    await db.exec('rollback')

    const preserved = (await db.query('select * from public.appointments where id=$1', [appointments[0]])).rows[0]
    expect(preserved).toEqual(corrupt)
    expect(preserved.care_request_id).toBe(requests[1])
    expect((await db.query(`select conname from pg_constraint
      where conrelid = 'public.appointments'::regclass and conname = 'appointments_care_request_patient_fk'`)).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)