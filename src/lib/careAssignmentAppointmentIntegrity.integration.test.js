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
const migrationName = '20261002180000_care_assignment_appointment_patient_integrity.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/care_assignment_validation.sql'), 'utf8')
const uid = n => `8a000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  for (const n of [1, 2, 3, 4, 5, 6]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])

  const patients = [], providers = [], requests = [], appointments = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: `Care assignment patient ${n}`, phone: `+95980000000${n}`,
      dateOfBirth: '1990-01-01', medicalProfile: {},
    })])).rows[0].id)
  }
  for (const n of [3, 4, 5]) {
    const role = n === 5 ? 'nurse' : 'doctor'
    await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)', [uid(n), role, `Test ${role}`])
    providers.push((await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,$2,'verified') returning id",
      [uid(n), role])).rows[0].id)
  }
  await db.query('insert into public.profiles(id, role, full_name) values ($1,$2,$3)',
    [uid(6), 'coordinator', 'Test coordinator'])
  const coordinator = (await db.query("insert into public.care_coordinators(profile_id) values ($1) returning id",
    [uid(6)])).rows[0].id

  for (const provider of providers) {
    await db.query('update public.providers set consultation_fee_mmk = 30000 where id = $1', [provider])
  }
  for (const n of [1, 2]) {
    requests.push((await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Synthetic care request') returning id`, [patients[n - 1], uid(n)])).rows[0].id)
  }

  // Historical rows, created before Repair 4 pricing enforcement.
  // Care request A and standalone appointment A (no care_request_id) model the real
  // coordinator flow: match first, book afterwards.
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,'teleconsultation','2026-09-01T09:00Z','2026-09-01T09:30Z','video','ASSIGN-HIST-0') returning id`,
  [patients[0], providers[0]])).rows[0].id)
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,$3,'teleconsultation','2026-09-02T09:00Z','2026-09-02T09:30Z','video','ASSIGN-HIST-1') returning id`,
  [patients[0], providers[0], requests[0]])).rows[0].id)
  appointments.push((await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
    scheduled_start,scheduled_end,consultation_channel,booking_code)
    values ($1,$2,'teleconsultation','2026-09-03T09:00Z','2026-09-03T09:30Z','video','ASSIGN-HIST-2') returning id`,
  [patients[1], providers[1]])).rows[0].id)

  const assignments = []
  // Pre-existing valid rows: one assignment awaiting an appointment, one linked to the
  // matching Patient A appointment (standalone, NULL care_request_id).
  assignments.push((await db.query(`insert into public.care_assignments(care_request_id,provider_id,assigned_by_profile_id,status)
    values ($1,$2,$3,'assigned') returning id`, [requests[0], providers[0], uid(6)])).rows[0].id)
  assignments.push((await db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
    values ($1,$2,$3,$4,'accepted') returning id`, [requests[0], appointments[1], providers[0], uid(6)])).rows[0].id)

  const encounters = [(await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
    values ($1,$2,$3,'teleconsultation') returning id`, [appointments[1], patients[0], providers[0]])).rows[0].id]

  await db.query('update public.care_requests set coordinator_id=$1 where id=any($2::uuid[])', [coordinator, requests])

  for (const name of readdirSync(directory)
    .filter(n => n.endsWith('.sql') && n > baselineCutoff && n < migrationName).sort()) {
    await db.exec(readFileSync(join(directory, name), 'utf8'))
  }

  return { db, patients, providers, requests, appointments, assignments, encounters, coordinator }
}

async function actor(db, n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}

describe('Care assignment to appointment patient integrity', () => {
  let db, patients, providers, requests, appointments, assignments, encounters, coordinator
  let history, policies

  const newSlot = async (provider = providers[0]) => {
    const index = await db.query('select count(*)::int as n from public.provider_availability')
    const minutes = index.rows[0].n * 90
    const start = new Date(Date.UTC(2031, 2, 4, 8, minutes, 0)).toISOString()
    const end = new Date(Date.UTC(2031, 2, 4, 8, minutes + 30, 0)).toISOString()
    return (await db.query(`insert into public.provider_availability(provider_id,service_type,start_at,end_at)
      values ($1,'teleconsultation',$2,$3) returning id,start_at,end_at`, [provider, start, end])).rows[0]
  }

  const book = async (patient = patients[0], provider = providers[0], careRequest = null) => {
    const slot = await newSlot(provider)
    return (await db.query(`insert into public.appointments(patient_id,provider_id,care_request_id,provider_availability_id,
      appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,$4,'teleconsultation','video',$5,$6,$7)
      returning id,patient_id,care_request_id,fee_amount,currency,status`,
    [patient, provider, careRequest, slot.id, slot.start_at, slot.end_at, `ASSIGN-BOOK-${slot.id}`])).rows[0]
  }

  const assign = (careRequest, appointment = null, provider = providers[0], status = 'assigned') =>
    db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,$4,$5) returning id,care_request_id,appointment_id,provider_id,status`,
    [careRequest, appointment, provider, uid(6), status])

  // Each negative statement runs inside its own savepoint so one rejection does not
  // abort the surrounding test transaction.
  const denied = async (run, match) => {
    await db.exec('savepoint r14')
    try {
      await expect(run()).rejects.toMatchObject(match)
    } finally {
      await db.exec('rollback to savepoint r14')
    }
  }

  beforeAll(async () => {
    ;({ db, patients, providers, requests, appointments, assignments, encounters, coordinator } = await baseline())
    history = (await db.query('select * from public.care_assignments order by id')).rows
    policies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows
    await db.exec(migration)
  }, 60000)

  beforeEach(() => db.exec('begin'))
  afterEach(() => db.exec('rollback'))
  afterAll(() => db?.close())

  it('preserves historical care assignments and RLS policies, and reports no inconsistencies', async () => {
    expect((await db.query('select * from public.care_assignments order by id')).rows).toEqual(history)
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies)
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([])
    expect(reports[3].rows).toEqual([])
  })

  it('triggers are installed on all three tables of the chain', async () => {
    const triggers = (await db.query(`select tgname from pg_trigger
      where tgname in ('care_assignments_patient_chain','care_requests_assignment_guard','appointments_assignment_guard')
      order by tgname`)).rows
    expect(triggers).toEqual([
      { tgname: 'appointments_assignment_guard' },
      { tgname: 'care_assignments_patient_chain' },
      { tgname: 'care_requests_assignment_guard' },
    ])
    expect((await db.query(`select proname from pg_proc
      where proname = 'check_care_assignment_patient_chain'`)).rows)
      .toEqual([{ proname: 'check_care_assignment_patient_chain' }])
  })

  it('service role links Patient A request to Patient A appointment', async () => {
    await actor(db, null, 'service_role')
    const row = (await assign(requests[0], appointments[0])).rows[0]
    expect(row.care_request_id).toBe(requests[0])
    expect(row.appointment_id).toBe(appointments[0])
  })

  it('the real coordinator flow still works: match first, book and link afterwards', async () => {
    await actor(db, null, 'service_role')
    const matched = (await assign(requests[0], null)).rows[0]
    expect(matched.appointment_id).toBeNull()

    const appointment = await book(patients[0], providers[0], null)
    const linked = (await db.query(`update public.care_assignments set appointment_id=$1 where id=$2
      returning id,appointment_id`, [appointment.id, matched.id])).rows[0]
    expect(linked.appointment_id).toBe(appointment.id)
  })

  it('assignments without an appointment remain supported after the appointment exists', async () => {
    await actor(db, null, 'service_role')
    const appointment = await book(patients[0], providers[0], null)
    const row = (await assign(requests[0], null)).rows[0]
    expect(row.appointment_id).toBeNull()
    expect(appointment.id).toBeDefined()
  })

  it('multiple assignments may belong to one care request', async () => {
    await actor(db, null, 'service_role')
    for (const provider of [providers[0], providers[2]]) {
      const row = (await assign(requests[0], null, provider)).rows[0]
      expect(row.care_request_id).toBe(requests[0])
    }
  })

  it('multiple same-patient assignments may reference one appointment', async () => {
    await actor(db, null, 'service_role')
    const first = (await assign(requests[0], appointments[0], providers[0])).rows[0]
    const second = (await assign(requests[0], appointments[0], providers[2])).rows[0]
    expect(first.appointment_id).toBe(appointments[0])
    expect(second.appointment_id).toBe(appointments[0])
    const reports = await db.exec(validation)
    expect(reports[2].rows.some(r => r.appointment_id === appointments[0])).toBe(true)
  })

  it('coordinator can manage a valid assignment and cannot cross patients', async () => {
    await actor(db, 6)
    const valid = (await assign(requests[0], appointments[0])).rows[0]
    expect(valid.appointment_id).toBe(appointments[0])

    await denied(() => assign(requests[0], appointments[2]), {
      code: '23514', message: expect.stringContaining('Care assignment patient mismatch'),
    })
  })

  it('patient cannot manage care assignments at all', async () => {
    await actor(db, 1)
    await denied(() => assign(requests[0], appointments[0]), { code: '42501' })
    // Structural trigger validation runs before the RLS WITH CHECK policy, so a
    // cross-patient attempt is refused at the relational boundary first.
    await denied(() => assign(requests[0], appointments[2]), {
      code: '23514', message: expect.stringContaining('Care assignment patient mismatch'),
    })
  })

  it('anonymous caller cannot create care assignments and sees none', async () => {
    await actor(db, null, 'anon')
    expect((await db.query('select * from public.care_assignments')).rows).toEqual([])
    await denied(() => assign(requests[0], appointments[0]), { code: '42501' })
  })

  it('exact audit exploit: Patient A request linked to Patient B appointment is denied', async () => {
    await actor(db, null, 'service_role')
    await denied(() => assign(requests[0], appointments[2]), {
      code: '23514', message: expect.stringContaining('Care assignment patient mismatch'),
    })
  })

  it('Patient B request linked to Patient A appointment is denied', async () => {
    await actor(db, null, 'service_role')
    await denied(() => assign(requests[1], appointments[1]), {
      code: '23514', message: expect.stringContaining('Care assignment patient mismatch'),
    })
  })

  it('direct superuser SQL cross-patient INSERT and UPDATE are denied', async () => {
    await actor(db, null, 'service_role')
    const valid = (await assign(requests[0], appointments[0])).rows[0]

    await actor(db, null, 'postgres')
    await denied(() => assign(requests[0], appointments[2]), {
      code: '23514', message: expect.stringContaining('Care assignment patient mismatch'),
    })
    await denied(() => db.query('update public.care_assignments set appointment_id=$1 where id=$2',
      [appointments[2], valid.id]),
    { code: '23514', message: expect.stringContaining('Care assignment patient mismatch') })
    await denied(() => db.query('update public.care_assignments set care_request_id=$1 where id=$2',
      [requests[1], valid.id]),
    { code: '23514', message: expect.stringContaining('Care assignment patient mismatch') })
  })

  it('unrelated assignment column updates keep working', async () => {
    await actor(db, null, 'service_role')
    const row = (await db.query(`update public.care_assignments set status='accepted', responded_at=statement_timestamp()
      where id=$1 returning status,responded_at`, [assignments[1]])).rows[0]
    expect(row.status).toBe('accepted')
  })

  it('care request ownership cannot move while a linked assignment disagrees', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.care_requests set patient_id=$1 where id=$2', [patients[1], requests[0]]),
      { code: '23514', message: expect.stringContaining('Care request reassignment') })
  })

  it('standalone appointment ownership cannot move while a linked assignment disagrees', async () => {
    await actor(db, null, 'service_role')
    const assignment = (await assign(requests[0], appointments[0])).rows[0]
    expect(assignment.appointment_id).toBe(appointments[0])
    await denied(() => db.query('update public.appointments set patient_id=$1 where id=$2', [patients[1], appointments[0]]),
      { code: '23514', message: expect.stringContaining('Appointment patient reassignment') })
  })

  it('parent ownership moves stay allowed when no assignment links the two sides', async () => {
    await actor(db, null, 'service_role')
    const request = (await db.query(`insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms)
      values ($1,$2,'teleconsultation','Unlinked') returning id`, [patients[0], uid(1)])).rows[0].id
    const moved = (await db.query('update public.care_requests set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], request])).rows[0]
    expect(moved.patient_id).toBe(patients[1])

    const spare = await book(patients[0], providers[0], null)
    const movedAppointment = (await db.query('update public.appointments set patient_id=$1 where id=$2 returning patient_id',
      [patients[1], spare.id])).rows[0]
    expect(movedAppointment.patient_id).toBe(patients[1])
  })

  it('deleting a care request or appointment referenced by an assignment stays restricted', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('delete from public.care_requests where id=$1', [requests[0]]), { code: '23001' })
    await denied(() => db.query('delete from public.appointments where id=$1', [appointments[1]]), { code: '23001' })
  })

  it('encounter creation after a valid assignment chain succeeds and stays same-patient', async () => {
    await actor(db, null, 'service_role')
    const appointment = await book(patients[0], providers[0], null)
    const assignment = (await assign(requests[0], appointment.id)).rows[0]
    expect(assignment.appointment_id).toBe(appointment.id)

    const encounter = (await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id,patient_id`, [appointment.id, patients[0], providers[0]])).rows[0]
    expect(encounter.patient_id).toBe(patients[0])
    const reports = await db.exec(validation)
    expect(reports[3].rows).toEqual([])
  })

  it('Repair 5 encounter integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.care_encounters set patient_id=$1 where id=$2', [patients[1], encounters[0]]),
      { code: '23503', constraint: 'care_encounters_appointment_patient_fk' })
  })

  it('Repair 13 care request/appointment integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    await denied(() => db.query('update public.appointments set care_request_id=$1 where id=$2', [requests[1], appointments[0]]),
      { code: '23503', constraint: 'appointments_care_request_patient_fk' })
    const standalone = await book(patients[0], providers[0], null)
    expect(standalone.care_request_id).toBeNull()
  })

  it('Repair 4 pricing integrity still applies after this repair', async () => {
    await actor(db, null, 'service_role')
    const appointment = await book(patients[0], providers[0], null)
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

  it('preflight reports a chained assignment, appointment and encounter consistently', async () => {
    await actor(db, null, 'service_role')
    const appointment = await book(patients[0], providers[0], requests[0])
    const assignment = (await assign(requests[0], appointment.id)).rows[0]
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([])
    expect(reports[3].rows).toEqual([])
    expect(assignment.appointment_id).toBe(appointment.id)
  })
})

it('independent audit exploit is accepted before repair and denied after', async () => {
  const { db, patients, providers, requests, appointments } = await baseline()
  try {
    await db.exec('begin')
    await actor(db, null, 'service_role')
    const before = (await db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,$4,'accepted') returning id,care_request_id,appointment_id`,
    [requests[0], appointments[2], providers[0], uid(6)])).rows[0]
    expect(before.care_request_id).toBe(requests[0])
    expect(before.appointment_id).toBe(appointments[2])
    await db.exec('rollback')
    expect((await db.query('select id from public.care_assignments where appointment_id=$1', [appointments[2]])).rows).toEqual([])

    await db.exec(migration)
    await db.exec('begin')
    await actor(db, null, 'service_role')
    await expect(db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,$4,'accepted')`, [requests[0], appointments[2], providers[0], uid(6)]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('Care assignment patient mismatch') })
    await db.exec('rollback')
    expect((await db.query('select id from public.care_assignments where appointment_id=$1', [appointments[2]])).rows).toEqual([])
    expect(Number((await db.query(`select count(*) from public.care_assignments a
      join public.care_requests r on r.id = a.care_request_id
      join public.appointments p on p.id = a.appointment_id
      where r.patient_id is distinct from p.patient_id`)).rows[0].count)).toBe(0)
  } finally {
    await db.close()
  }
}, 60000)

it('preflight reports the mismatch and migration aborts safely without rewriting data', async () => {
  const { db, providers, requests, appointments } = await baseline()
  try {
    const corrupt = (await db.query(`insert into public.care_assignments(care_request_id,appointment_id,provider_id,assigned_by_profile_id,status)
      values ($1,$2,$3,$4,'accepted') returning *`, [requests[0], appointments[2], providers[0], uid(6)])).rows[0]

    const reports = await db.exec(validation)
    expect(reports[0].rows).toHaveLength(1)
    expect(reports[0].rows[0].reason).toBe('patient_mismatch')

    await expect(db.exec(migration)).rejects.toMatchObject({
      code: '23514', message: expect.stringContaining('Care assignment repair stopped'),
    })
    await db.exec('rollback')

    expect((await db.query('select * from public.care_assignments where id=$1', [corrupt.id])).rows[0]).toEqual(corrupt)
    expect((await db.query(`select proname from pg_proc where proname = 'check_care_assignment_patient_chain'`)).rows).toEqual([])
  } finally {
    await db.close()
  }
}, 60000)
