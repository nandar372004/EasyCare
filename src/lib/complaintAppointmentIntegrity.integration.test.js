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
const migrationName = '20261002190000_complaint_appointment_patient_integrity.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/complaint_appointment_validation.sql'), 'utf8')
const uid = n => `8b000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])

  const patients = [], providers = [], appointments = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Complaint patient ${n}`, phone: `+95987000000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id",
      [uid(n), role])).rows[0].id)
  }
  // Authorized family member for Patient A, and a main administrator.
  await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(6), 'family', 'Test family'])
  await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(7), 'main_admin', 'Test admin'])
  await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1,$2,'active',true)",
    [patients[0], uid(6)])

  for (const provider of providers) {
    await db.query('update public.providers set consultation_fee_mmk = 30000 where id = $1', [provider])
  }

  // Historical appointments, created before Repair 4 pricing enforcement.
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,'teleconsultation','2026-09-01T09:00Z','2026-09-01T09:30Z','video','COMPLAINT-HIST-0') returning id`,
  [patients[0], providers[0]])).rows[0].id)
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,'teleconsultation','2026-09-02T09:00Z','2026-09-02T09:30Z','video','COMPLAINT-HIST-1') returning id`,
  [patients[1], providers[1]])).rows[0].id)

  const encounters = [(await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
    values ($1,$2,$3,'teleconsultation') returning id`, [appointments[0], patients[0], providers[0]])).rows[0].id]

  const complaints = []
  complaints.push((await db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
    values ($1,$2,$3,'Valid historical complaint','Valid historical complaint body') returning id`,
  [patients[0], appointments[0], uid(1)])).rows[0].id)
  // A general complaint with neither patient nor appointment is a supported shape.
  complaints.push((await db.query(`insert into public.complaints(submitted_by_profile_id,subject,description)
    values ($1,'General complaint','Service level complaint') returning id`, [uid(1)])).rows[0].id)

  for (const name of readdirSync(directory)
    .filter(n => n.endsWith('.sql') && n > baselineCutoff && n < migrationName).sort()) {
    await db.exec(readFileSync(join(directory, name), 'utf8'))
  }

  return { db, patients, providers, appointments, encounters, complaints }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}

describe('Complaint to appointment patient integrity', () => {
  let db, patients, providers, appointments, encounters, complaints
  let history, policies

  const newSlot = async (provider = providers[0]) => {
    const index = await db.query('select count(*)::int as n from public.provider_availability')
    const minutes = index.rows[0].n * 90
    const start = new Date(Date.UTC(2031, 2, 4, 8, minutes, 0)).toISOString()
    const end = new Date(Date.UTC(2031, 2, 4, 8, minutes + 30, 0)).toISOString()
    return (await db.query(`insert into public.provider_availability(provider_id,service_type,start_at,end_at)
      values ($1,'teleconsultation',$2,$3) returning id,start_at,end_at`, [provider, start, end])).rows[0]
  }

  const book = async (patient = patients[0], provider = providers[0]) => {
    const slot = await newSlot(provider)
    return (await db.query(`insert into public.appointments(patient_id,provider_id,provider_availability_id,
      appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,'teleconsultation','video',$4,$5,$6) returning id,patient_id,fee_amount,currency`,
    [patient, provider, slot.id, slot.start_at, slot.end_at, `COMPLAINT-BOOK-${slot.id}`])).rows[0]
  }

  const complain = (submitter, patient = null, appointment = null, subject = 'Test complaint') =>
    db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
      values ($1,$2,$3,$4,$4) returning id,patient_id,appointment_id,submitted_by_profile_id,status`,
    [patient, appointment, submitter, subject])

  // Each negative statement runs inside its own savepoint so one rejection does not
  // abort the surrounding test transaction.
  const denied = async (run, match) => {
    await db.exec('savepoint r15')
    try {
      await expect(run()).rejects.toMatchObject(match)
    } finally {
      await db.exec('rollback to savepoint r15')
    }
  }

  beforeAll(async () => {
    ;({ db, patients, providers, appointments, encounters, complaints } = await baseline())
    history = (await db.query('select * from public.complaints order by id')).rows
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)

  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical complaints and RLS policies, and reports no inconsistencies', async () => {
    expect((await db.query('select * from public.complaints order by id')).rows).toEqual(history)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([])
    expect(reports[1].rows).toEqual([])
    expect(reports[3].rows).toEqual([])
  })

  it('reuses the existing appointments unique key and adds only the composite foreign key', async () => {
    const keys = (await db.query(`select conname, contype, confupdtype, confdeltype, confmatchtype
      from pg_constraint where conrelid = 'public.complaints'::regclass
        and conname = 'complaints_appointment_patient_fk'`)).rows
    expect(keys).toEqual([{
      conname: 'complaints_appointment_patient_fk', contype: 'f',
      confupdtype: 'r', confdeltype: 'r', confmatchtype: 's',
    }])
    // Repair 5's key is reused; no duplicate unique constraint is created.
    expect((await db.query(`select count(*) from pg_constraint
      where conrelid = 'public.appointments'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) like '%(id, patient_id)%'`)).rows[0].count).toBe(1)
    expect((await db.query(`select tgname from pg_trigger
      where tgrelid = 'public.appointments'::regclass and tgname = 'appointments_complaint_guard'`)).rows)
      .toEqual([{ tgname: 'appointments_complaint_guard' }])
  })

  it('patient submits a complaint about their own appointment', async () => {
    await actor(db, 1)
    const row = (await complain(uid(1), patients[0], appointments[0])).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.appointment_id).toBe(appointments[0])
    expect(row.status).toBe('open')
  })

  it('standalone general complaint without patient or appointment stays supported', async () => {
    await actor(db, 1)
    const row = (await complain(uid(1), null, null)).rows[0]
    expect(row.patient_id).toBeNull()
    expect(row.appointment_id).toBeNull()
  })

  it('patient complaint about a patient without an appointment stays supported', async () => {
    await actor(db, 1)
    const row = (await complain(uid(1), patients[0], null)).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.appointment_id).toBeNull()
  })

  it('authorized family member may submit a complaint for an authorized patient', async () => {
    await actor(db, 6)
    const row = (await complain(uid(6), patients[0], appointments[0])).rows[0]
    expect(row.submitted_by_profile_id).toBe(uid(6))
    expect(row.patient_id).toBe(patients[0])
  })

  it('service role records a complaint on behalf of a patient', async () => {
    await actor(db, null, 'service_role')
    const row = (await complain(uid(1), patients[0], appointments[0], 'Support complaint')).rows[0]
    expect(row.patient_id).toBe(patients[0])
    expect(row.appointment_id).toBe(appointments[0])
  })

  it('complaint reads stay limited to the submitter and main administrators', async () => {
    const ids = (await db.query('select id from public.complaints')).rows.map(r => r.id)
    await actor(db, 1)
    expect((await db.query('select id from public.complaints where id = any($1::uuid[]) order by id', [ids])).rows)
      .toHaveLength(2)

    await actor(db, 2)
    expect((await db.query('select id from public.complaints where id = any($1::uuid[]) order by id', [ids])).rows)
      .toEqual([])

    await actor(db, 7)
    expect((await db.query('select id from public.complaints where id = any($1::uuid[]) order by id', [ids])).rows)
      .toHaveLength(2)
  })

  it('exact audit exploit: Patient A complaint against Patient B appointment is denied', async () => {
    await actor(db, 1)
    await denied(() => complain(uid(1), patients[0], appointments[1]), {
      code: '23503', constraint: 'complaints_appointment_patient_fk',
    })
  })

  it('Patient B complaint against Patient A appointment is denied', async () => {
    await actor(db, 2)
    await denied(() => complain(uid(2), patients[1], appointments[0]), {
      code: '23503', constraint: 'complaints_appointment_patient_fk',
    })
  })

  it('service role cross-patient insert is denied', async () => {
    await actor(db, null, 'service_role')
    await denied(() => complain(uid(1), patients[0], appointments[1]), {
      code: '23503', constraint: 'complaints_appointment_patient_fk',
    })
  })

  it('direct superuser SQL cross-patient insert is denied', async () => {
    await actor(db, null, 'postgres')
    await denied(() => complain(uid(1), patients[0], appointments[1], 'Direct SQL complaint'), {
      code: '23503', constraint: 'complaints_appointment_patient_fk',
    })
  })

  it('changing complaint.appointment_id to another patient appointment is denied', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.complaints set appointment_id=$1 where id=$2', [appointments[1], complaints[0]]),
      { code: '23503', constraint: 'complaints_appointment_patient_fk' })
  })

  it('changing complaint.patient_id to conflict with its appointment is denied', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.complaints set patient_id=$1 where id=$2', [patients[1], complaints[0]]),
      { code: '23503', constraint: 'complaints_appointment_patient_fk' })
  })

  it('unrelated complaint workflow columns keep updating', async () => {
    await actor(db, null, 'service_role')
    const row = (await db.query(`update public.complaints set status='resolved', resolved_at=statement_timestamp(),
      resolution='Reviewed' where id=$1 returning status,resolution,patient_id,appointment_id`, [complaints[0]])).rows[0]
    expect(row.status).toBe('resolved')
    expect(row.resolution).toBe('Reviewed')
    expect(row.appointment_id).toBe(appointments[0])
  })

  it('standalone appointment ownership cannot move while a complaint disagrees', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.appointments set patient_id=$1 where id=$2', [patients[1], appointments[0]]),
      { code: '23514', message: expect.stringContaining('Appointment patient reassignment would invalidate complaint') })
  })

  it('appointment ownership may still move when only complaint-free or NULL-patient complaints exist', async () => {
    await actor(db, null, 'service_role')
    const moved = (await db.query('update public.appointments set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], appointments[1]])).rows[0]
    expect(moved.patient_id).toBe(patients[1])

    // A complaint that names no patient does not constrain appointment ownership.
    const unlinked = await book(patients[0], providers[0])
    await db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
      values (null,$1,$2,'General service complaint','No patient named')`, [unlinked.id, uid(1)])
    const stillMoved = (await db.query('update public.appointments set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], unlinked.id])).rows[0]
    expect(stillMoved.patient_id).toBe(patients[1])
  })

  it('patient cannot submit a complaint impersonating another submitter', async () => {
    await actor(db, 1)
    await denied(() => complain(uid(2), patients[0], appointments[0]), { code: '42501' })
  })

  it('family member without authorization is denied', async () => {
    await actor(db, 5)
    await denied(() => complain(uid(5), patients[0], appointments[0]), { code: '42501' })
  })

  it('anonymous caller cannot create complaints', async () => {
    await actor(db, null, 'anon')
    await denied(() => complain(uid(1), patients[0], appointments[0]), { code: '42501' })
  })

  it('deleting an appointment referenced by a complaint stays restricted', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('delete from public.appointments where id=$1', [appointments[0]]), { code: '23001' })
  })

  it('Repair 5 encounter integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.care_encounters set patient_id=$1 where id=$2', [patients[1], encounters[0]]),
      { code: '23503', constraint: 'care_encounters_appointment_patient_fk' })
  })

  it('Repair 13 care request/appointment integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    const request = (await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Repair 13 regression') returning id`, [patients[1], uid(1)])).rows[0].id
    const appointment = await book(patients[0], providers[0])
    await denied(() => db.query('update public.appointments set care_request_id=$1 where id=$2 returning id', [request, appointment.id]),
      { code: '23503', constraint: 'appointments_care_request_patient_fk' })
  })

  it('Repair 14 care assignment integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    const request = (await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Repair 14 regression') returning id`, [patients[0], uid(1)])).rows[0].id
    const assignment = (await db.query(`insert into public.care_assignments(care_request_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,'accepted') returning id`, [request, providers[0], uid(7)])).rows[0]
    expect(assignment.id).toBeDefined()
    await denied(() => db.query('update public.care_assignments set appointment_id=$1 where id=$2 returning id',
      [appointments[1], assignment.id]),
    { code: '23514', message: expect.stringContaining('Care assignment patient mismatch') })
  })

  it('Repair 4 pricing integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    const appointment = await book(patients[0], providers[0])
    expect(Number(appointment.fee_amount)).toBe(30000)
    expect(appointment.currency).toBe('MMK')
    await denied(() => db.query('update public.appointments set fee_amount=0 where id=$1', [appointment.id]),
      { code: '23514' })
  })

  it('Repair 3 suspended provider remains blocked from clinical access', async () => {
    await db.query("update public.profiles set status='suspended' where id=$1", [uid(3)])
    await actor(db, 3)
    expect((await db.query('select id from public.care_encounters')).rows).toEqual([])
  })

  it('preflight classifies every complaint shape', async () => {
    await actor(db, null, 'service_role')
    const reports = await db.exec(validation)
    const shapes = reports[2].rows.map(r => r.complaint_shape).sort()
    expect(shapes).toEqual(['appointment_complaint', 'general_complaint'])
    expect(reports[0].rows).toEqual([])
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, appointments } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, 1)
    const before = (await db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
      values ($1,$2,$3,'Audit exploit','Audit exploit body') returning id,patient_id,appointment_id,submitted_by_profile_id`,
    [patients[0], appointments[1], uid(1)])).rows[0]
    expect(before.patient_id).toBe(patients[0])
    expect(before.appointment_id).toBe(appointments[1])
    expect(before.submitted_by_profile_id).toBe(uid(1))
    await db.exec('rollback')
    expect((await db.query('select id from public.complaints where appointment_id=$1', [appointments[1]])).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, 1)
    await expect(db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
      values ($1,$2,$3,'Audit exploit','Audit exploit body')`, [patients[0], appointments[1], uid(1)]))
      .rejects.toMatchObject({ code: '23503', constraint: 'complaints_appointment_patient_fk' })
    await db.exec('rollback')
    expect((await db.query('select id from public.complaints where appointment_id=$1', [appointments[1]])).rows).toEqual([])
    expect(Number((await db.query(`select count(*) from public.complaints c
      join public.appointments a on a.id = c.appointment_id
      where c.appointment_id is not null and c.patient_id is distinct from a.patient_id`)).rows[0].count)).toBe(0)
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports the mismatch and migration aborts safely without rewriting data', async () => {
  const { db, patients, appointments } = await baseline()
  try {
    const corrupt = (await db.query(`insert into public.complaints(patient_id,appointment_id,submitted_by_profile_id,subject,description)
      values ($1,$2,$3,'Preflight exploit','Preflight exploit body') returning *`,
    [patients[0], appointments[1], uid(1)])).rows[0]

    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[0].rows[0].reason).toBe('patient_mismatch')

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Complaint repair stopped'),
    })
    await db.exec('rollback')

    expect((await db.query('select * from public.complaints where id=$1', [corrupt.id])).rows[0]).toEqual(corrupt)
    expect((await db.query(`select conname from pg_constraint
      where conrelid = 'public.complaints'::regclass and conname = 'complaints_appointment_patient_fk'`)).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)