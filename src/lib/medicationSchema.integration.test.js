// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; managed Auth and Storage schemas are simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929140000_medication_schema_improvements.sql'
const uid = (n) => `77000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 7 medication improvements', () => {
  let db, patients, providers, encounters, medications, schedules, events, medicationsBefore, patientsBefore, encountersBefore, policiesBefore

  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
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
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `)
    await db.exec(`
      create schema storage;
      create table storage.buckets(id text primary key, public boolean not null default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, unique(bucket_id, name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
      -- Deliberately broad legacy policies: restrictive guards must still protect clinical files.
      create policy legacy_all on storage.objects for all to anon, authenticated using (true) with check (true);
    `)
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    patients = []
    for (const n of [1, 2]) {
      patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
        userId: uid(n), fullName: 'Synthetic Lab Patient', phone: `+95975000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: {},
      })])).rows[0].id)
    }
    providers = {}
    for (const [n, role] of [[3, 'doctor'], [4, 'nurse'], [5, 'doctor'], [6, 'family'], [7, 'main_admin']]) {
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [uid(n), role, `Synthetic ${role}`])
      if (n <= 5) providers[n] = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [uid(n), role])).rows[0].id
    }
    encounters = []
    for (const i of [0, 1]) {
      const appointment = (await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
        scheduled_start, scheduled_end, consultation_channel, booking_code)
        values ($1, $2, 'teleconsultation', $3, $4, 'video', $5) returning id`,
      [patients[i], providers[i === 0 ? 3 : 5], `2026-09-${20 + i}T09:00Z`, `2026-09-${20 + i}T09:30Z`, `ECA-LAB-${i}`])).rows[0].id
      encounters.push((await db.query("insert into public.care_encounters(appointment_id, patient_id, provider_id, encounter_type) values ($1, $2, $3, 'teleconsultation') returning id", [appointment, patients[i], providers[i === 0 ? 3 : 5]])).rows[0].id)
    }
    const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [patients[0], uid(1)])).rows[0].id
    await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, providers[4], uid(3)])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', true)", [patients[0], uid(6)])
    patientsBefore = (await db.query('select * from public.patients order by id')).rows
    encountersBefore = (await db.query('select * from public.care_encounters order by id')).rows
    policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    medications = []; schedules = []; events = []
    for (const i of [0,1]) {
      const prescription = (await db.query('insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',
        [encounters[i],patients[i],providers[i === 0 ? 3 : 5]])).rows[0].id
      const item = (await db.query("insert into public.prescription_items(prescription_id,medication_name) values ($1,'Synthetic medication') returning id",[prescription])).rows[0].id
      medications.push((await db.query("insert into public.patient_medications(patient_id,prescription_item_id,medication_name,start_date) values ($1,$2,'Synthetic medication','2026-01-01') returning id",[patients[i],item])).rows[0].id)
      schedules.push((await db.query("insert into public.medication_schedules(patient_medication_id,time_of_day,days_of_week,timezone,valid_from) values ($1,'08:00',array[0,1,2,3,4,5,6]::smallint[],'Asia/Yangon','2026-01-01') returning id",[medications[i]])).rows[0].id)
      events.push((await db.query("insert into public.medication_events(schedule_id,patient_id,scheduled_at) values ($1,$2,'2026-09-29 08:00+06:30') returning id",[schedules[i],patients[i]])).rows[0].id)
    }
    await db.query("insert into public.patient_medications(patient_id,medication_name,status) values ($1,'Historical stopped medication','discontinued')",[patients[0]])
    await db.query("insert into public.medication_events(schedule_id,patient_id,scheduled_at,status) values ($1,$2,'2026-09-28 08:00+06:30','missed')",[schedules[0],patients[0]])
    medicationsBefore = (await db.query('select * from public.patient_medications order by id')).rows
    await db.exec(readFileSync(join(directory,migrationName),'utf8'))
  },60000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('preserves historical medication data and all existing policies', async () => {
    const rows = (await db.query('select * from public.patient_medications order by id')).rows
    expect(rows.map(({prescribing_provider_id,reason_for_medication,discontinued_at,discontinued_reason,...old}) => old)).toEqual(medicationsBefore)
    expect(rows.every(r => r.prescribing_provider_id === null && r.discontinued_at === null)).toBe(true)
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(patientsBefore)
    expect((await db.query('select * from public.care_encounters order by id')).rows).toEqual(encountersBefore)
    expect((await db.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows).toEqual(policiesBefore)
  })
  it('passes read-only FK, RLS and patient-link validation queries', async () => {
    const checks = await db.exec(readFileSync(join(process.cwd(),'supabase/scripts/medication_schema_validation.sql'),'utf8'))
    for (const check of checks) expect(check.rows).toEqual([])
  })
  it('retrieves only current medications', async () => {
    await actor(1)
    expect((await db.query("select id from public.patient_medications where status='active' and (start_date is null or start_date <= date '2026-09-29') and (end_date is null or end_date >= date '2026-09-29')")).rows).toEqual([{id:medications[0]}])
  })
  it('retrieves today’s schedule using local timezone, weekday and validity dates', async () => {
    await db.query("insert into public.medication_schedules(patient_medication_id,time_of_day,days_of_week,valid_from,valid_until) values ($1,'09:00',array[1]::smallint[],'2026-01-01','2026-09-28')",[medications[0]])
    await actor(1)
    const rows = (await db.query(`select s.id from public.medication_schedules s
      join public.patient_medications m on m.id=s.patient_medication_id
      cross join lateral (select (timestamptz '2026-09-28 20:00Z' at time zone s.timezone)::date as today) d
      where m.status='active' and (m.start_date is null or m.start_date<=d.today) and (m.end_date is null or m.end_date>=d.today)
      and (s.valid_from is null or s.valid_from<=d.today) and (s.valid_until is null or s.valid_until>=d.today)
      and (s.days_of_week is null or extract(dow from d.today)::smallint=any(s.days_of_week))`)).rows
    expect(rows).toEqual([{id:schedules[0]}])
    expect((await db.query(`select id from public.medication_events where scheduled_at >= timestamptz '2026-09-29 00:00+06:30'
      and scheduled_at < timestamptz '2026-09-30 00:00+06:30'`)).rows).toEqual([{id:events[0]}])
  })
  it.each(['taken','skipped'])('allows patient confirmation as %s and stamps identity/time', async status => {
    await actor(1)
    const row = (await db.query('select * from public.record_medication_event_status($1,$2)',[events[0],status])).rows[0]
    expect(row).toMatchObject({id:events[0],status,patient_id:patients[0],schedule_id:schedules[0],confirmed_by_profile_id:uid(1)})
    expect(row.confirmed_at).toBeTruthy()
  })
  it('retrieves history and derives adherence from events without another table', async () => {
    await actor(1)
    await db.query("select public.record_medication_event_status($1,'taken')",[events[0]])
    expect((await db.query('select status from public.medication_events order by scheduled_at')).rows).toEqual([{status:'missed'},{status:'taken'}])
    // Explicit denominator: known outcomes only; pending/unknown are not counted.
    expect((await db.query(`select count(*) filter(where status='taken')::float /
      nullif(count(*) filter(where status in ('taken','missed','skipped')),0) as adherence from public.medication_events`)).rows[0].adherence).toBe(0.5)
  })
  it.each([1,2])('isolates patient %s across medications, schedules, events and prescriptions', async n => {
    await actor(n)
    expect((await db.query('select id from public.medication_schedules')).rows).toEqual([{id:schedules[n-1]}])
    for (const table of ['patient_medications','medication_events','prescriptions']) {
      expect((await db.query(`select distinct patient_id from public.${table}`)).rows).toEqual([{patient_id:patients[n-1]}])
    }
    expect((await db.query('select id from public.prescription_items')).rows).toHaveLength(1)
    await expect(db.query("select public.record_medication_event_status($1,'taken')",[events[n===1 ? 1 : 0]])).rejects.toMatchObject({code:'42501'})
  })
  it.each([3,6,7])('does not permit clinician/family/admin %s to impersonate patient confirmation', async n => {
    await actor(n)
    await expect(db.query("select public.record_medication_event_status($1,'taken')",[events[0]])).rejects.toMatchObject({code:'42501'})
  })
  it.each(['pending','missed','unknown'])('preserves server status %s but rejects it through patient RPC', async status => {
    await db.query('update public.medication_events set status=$1 where id=$2',[status,events[0]])
    await actor(1)
    expect((await db.query('select status from public.medication_events where id=$1',[events[0]])).rows[0].status).toBe(status)
    await expect(db.query('select public.record_medication_event_status($1,$2)',[events[0],status])).rejects.toMatchObject({code:'42501'})
  })
  it('rejects confirmation when legacy event patient and schedule disagree', async () => {
    await db.query('update public.medication_events set schedule_id=$1 where id=$2',[schedules[1],events[0]])
    await actor(1)
    await expect(db.query("select public.record_medication_event_status($1,'taken')",[events[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('denies anonymous RPC access and event reads', async () => {
    await actor(null,'anon')
    expect((await db.query('select id from public.medication_events')).rows).toEqual([])
    await expect(db.query("select public.record_medication_event_status($1,'taken')",[events[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('blocks direct event tampering even with broad grants', async () => {
    await db.exec('grant all on public.medication_events to authenticated')
    await actor(1)
    expect((await db.query("update public.medication_events set status='taken', confirmed_by_profile_id=$1 returning id",[uid(2)])).rows).toEqual([])
    expect((await db.query('delete from public.medication_events returning id')).rows).toEqual([])
  })
  it('supports safe discontinuation and provider attribution', async () => {
    await db.query("update public.patient_medications set status='discontinued', discontinued_at=now(), discontinued_reason='Course ended', reason_for_medication='Synthetic reason', prescribing_provider_id=$1 where id=$2",[providers[3],medications[0]])
    await actor(1)
    expect((await db.query('select prescribing_provider_id,discontinued_reason from public.patient_medications where id=$1',[medications[0]])).rows[0]).toEqual({prescribing_provider_id:providers[3],discontinued_reason:'Course ended'})
  })
  it.each([
    ['reason_for_medication',"' '"],['discontinued_reason',"' '"],['discontinued_at',"'infinity'"],['discontinued_at','now()'],['discontinued_reason',"'Stopped'"],
  ])('checks invalid %s metadata', async (column,value) => {
    await expect(db.query(`update public.patient_medications set ${column}=${value} where id=$1`,[medications[0]])).rejects.toMatchObject({code:'23514'})
  })
  it.each([
    ['patient_medications','prescribing_provider_id'],['patient_medications','patient_id'],['patient_medications','prescription_item_id'],
    ['medication_schedules','patient_medication_id'],['medication_events','patient_id'],['medication_events','schedule_id'],['medication_events','confirmed_by_profile_id'],
    ['prescriptions','encounter_id'],['prescriptions','patient_id'],['prescriptions','doctor_provider_id'],['prescription_items','prescription_id'],
  ])('enforces FK %s.%s', async (table,column) => {
    await expect(db.query(`update public.${table} set ${column}=$1`,[uid(99)])).rejects.toMatchObject({code:'23503'})
  })
})
