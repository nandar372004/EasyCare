// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261001100000_follow_up_patient_integrity.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/follow_up_relationship_validation.sql'), 'utf8')
const uid = n => `84000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
  const patients = [], providers = [], encounters = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: 'Follow-up integrity test patient', phone: `+95984000000${n}`,
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
    [patients[i], providers[i], `2026-10-0${i + 1}T09:00Z`, `2026-10-0${i + 1}T09:30Z`, `RX-INTEGRITY-${i}`])).rows[0].id
    encounters.push((await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      values ($1,$2,$3,'teleconsultation') returning id`, [appointment, patients[i], providers[i]])).rows[0].id)
  }
  const prescription = (await db.query(`insert into public.prescriptions(encounter_id,patient_id,doctor_provider_id,instructions)
    values ($1,$2,$3,'Existing valid instructions') returning *`, [encounters[0], patients[0], providers[0]])).rows[0]
  for (const [n,role] of [[6,'coordinator'],[7,'main_admin'],[8,'caregiver'],[9,'family']]) {
    await db.query('insert into public.profiles(id,role,full_name) values ($1,$2,$3)',[uid(n),role,'Follow-up test staff'])
  }
  const coordinator=(await db.query('insert into public.care_coordinators(profile_id) values ($1) returning id',[uid(6)])).rows[0].id
  await db.query('update public.patients set primary_coordinator_id=$1 where id=$2',[coordinator,patients[0]])
  const caregiver=(await db.query("insert into public.providers(profile_id,provider_type,verification_status) values ($1,'caregiver','verified') returning id",[uid(8)])).rows[0].id
  const request=(await db.query("insert into public.care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms) values ($1,$2,'teleconsultation','Test') returning id",[patients[0],uid(1)])).rows[0].id
  for(const provider of [providers[2],caregiver]) await db.query("insert into public.care_assignments(care_request_id,provider_id,assigned_by_profile_id,status) values ($1,$2,$3,'accepted')",[request,provider,uid(3)])
  await db.query("insert into public.family_authorizations(patient_id,family_profile_id,status,can_view_records) values ($1,$2,'active',true)",[patients[0],uid(9)])
  const followups=[]
  for(const [patient,encounter,assignee] of [[patients[0],encounters[0],uid(3)],[patients[1],encounters[1],uid(4)],[patients[0],encounters[0],uid(1)],[patients[1],encounters[1],uid(1)]]) {
    followups.push((await db.query("insert into public.follow_ups(patient_id,encounter_id,assigned_to_profile_id,follow_up_type,instructions) values ($1,$2,$3,'call','Existing instructions') returning *",[patient,encounter,assignee])).rows[0])
  }
  return { db, patients, providers, encounters, prescription, followups }

}

describe('Follow-up patient ownership repair', () => {
  let db, patients, encounters, followups, prescription, policiesBefore, helpersBefore
  const otherPolicies = () => db.query("select * from pg_policies where schemaname='public' and tablename <> 'follow_ups' order by tablename,policyname")
  const sharedHelpers = () => db.query("select proname,pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and proname in ('can_access_patient','current_profile_role','is_main_admin') order by proname")
  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
    await db.exec(`set local role ${role}`)
  }
  const insert = (patient, encounter, assignee) => db.query(`insert into public.follow_ups(patient_id,encounter_id,assigned_to_profile_id,follow_up_type)
    values ($1,$2,$3,'call') returning *`, [patient, encounter, assignee])
  beforeAll(async () => {
    ({ db, patients, encounters, followups, prescription } = await baseline())
    policiesBefore = (await otherPolicies()).rows
    helpersBefore = (await sharedHelpers()).rows
    await db.exec(migration)
  }, 60000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('preserves historical rows, Repair 1, unrelated policies and shared helpers', async () => {
    expect((await db.query('select * from public.follow_ups order by id')).rows).toEqual([...followups].sort((a,b)=>a.id.localeCompare(b.id)))
    expect((await db.query('select * from public.prescriptions where id=$1',[prescription.id])).rows[0]).toEqual(prescription)
    expect((await otherPolicies()).rows).toEqual(policiesBefore)
    expect((await sharedHelpers()).rows).toEqual(helpersBefore)
    expect((await db.query("select convalidated from pg_constraint where conname='follow_ups_encounter_patient_fk'")).rows).toEqual([{convalidated:true}])
  })
  it('reports suspicious patient assignments without rewriting or blocking legitimate reminder rows', async () => {
    const reports = await db.exec(validation)
    expect(reports[0].rows).toEqual([])
    expect(reports[1].rows.map(r=>r.follow_up_id).sort()).toEqual([followups[2].id,followups[3].id].sort())
  })
  it('lets patient A read their follow-ups but not B even when assigned to A', async () => {
    await actor(1)
    expect((await db.query('select id from public.follow_ups order by id')).rows.map(r=>r.id).sort()).toEqual([followups[0].id,followups[2].id].sort())
    expect((await db.query('select id from public.follow_ups where patient_id=$1',[patients[1]])).rows).toEqual([])
  })
  it('preserves authorized family reads without conferring write privileges', async () => {
    await actor(9)
    expect((await db.query('select id from public.follow_ups')).rows).toHaveLength(2)
    await expect(insert(patients[0],encounters[0],uid(9))).rejects.toMatchObject({code:'42501'})
  })
  it.each([3,5,6,8])('retains valid staff %s creation, read, update, completion and delete', async n => {
    await actor(n)
    const row=(await insert(patients[0],encounters[0],uid(n))).rows[0]
    expect((await db.query('select id from public.follow_ups where id=$1',[row.id])).rows).toEqual([{id:row.id}])
    expect((await db.query("update public.follow_ups set status='completed',completed_at=now(),instructions='Reviewed' where id=$1 returning status",[row.id])).rows).toEqual([{status:'completed'}])
    expect((await db.query('delete from public.follow_ups where id=$1 returning id',[row.id])).rows).toEqual([{id:row.id}])
  })
  it('retains administrator creation and reassignment of valid relationships', async () => {
    await actor(7)
    const row=(await insert(patients[0],encounters[0],null)).rows[0]
    expect((await db.query('update public.follow_ups set assigned_to_profile_id=$1 where id=$2 returning assigned_to_profile_id',[uid(3),row.id])).rows).toEqual([{assigned_to_profile_id:uid(3)}])
  })
  it.each([1,3,4])('patient cannot create B follow-up by supplying assignee %s', async n => {
    await actor(1)
    // No RETURNING: the historical bypass must not be masked by SELECT policy.
    await expect(db.query("insert into public.follow_ups(patient_id,encounter_id,assigned_to_profile_id,follow_up_type) values ($1,$2,$3,'call')",[patients[1],encounters[1],uid(n)])).rejects.toMatchObject({code:'42501'})
  })
  it('patient cannot attach own patient ID to another encounter', async () => {
    await actor(1)
    await expect(insert(patients[0],encounters[1],uid(1))).rejects.toMatchObject({code:'42501'})
  })
  it.each([0,2,3])('patient cannot update, move, reassign or delete existing row %s', async index => {
    await actor(1)
    expect((await db.query('update public.follow_ups set patient_id=$1,encounter_id=$2,assigned_to_profile_id=$3 where id=$4 returning id',[patients[1],encounters[1],uid(1),followups[index].id])).rows).toEqual([])
    expect((await db.query('delete from public.follow_ups where id=$1 returning id',[followups[index].id])).rows).toEqual([])
    await actor(null,'service_role')
    expect((await db.query('select * from public.follow_ups where id=$1',[followups[index].id])).rows[0]).toEqual(followups[index])
  })
  it('unrelated doctor cannot create using self-assignment', async () => {
    await actor(4)
    await expect(insert(patients[0],encounters[0],uid(4))).rejects.toMatchObject({code:'42501'})
  })
  it('linked doctor cannot spoof another staff assignee to obtain management rights', async () => {
    await actor(3)
    await expect(insert(patients[0],encounters[0],uid(4))).rejects.toMatchObject({code:'42501'})
  })
  it.each([['patient_id',1],['assigned_to_profile_id',4]])('checks NEW row authorization on staff UPDATE of %s', async (field,n) => {
    await actor(3)
    const query=field==='patient_id'
      ? db.query('update public.follow_ups set patient_id=$1,encounter_id=$2 where id=$3',[patients[n],encounters[n],followups[0].id])
      : db.query('update public.follow_ups set assigned_to_profile_id=$1 where id=$2',[uid(n),followups[0].id])
    await expect(query).rejects.toMatchObject({code:'42501'})
  })
  it('unrelated clinician cannot update/delete existing staff follow-up', async () => {
    await actor(4)
    expect((await db.query("update public.follow_ups set instructions='Unauthorized' where id=$1 returning id",[followups[0].id])).rows).toEqual([])
    expect((await db.query('delete from public.follow_ups where id=$1 returning id',[followups[0].id])).rows).toEqual([])
  })
  it('anonymous users cannot read, update or delete', async () => {
    await actor(null,'anon')
    expect((await db.query('select id from public.follow_ups')).rows).toEqual([])
    expect((await db.query("update public.follow_ups set instructions='Unauthorized' returning id")).rows).toEqual([])
    expect((await db.query('delete from public.follow_ups returning id')).rows).toEqual([])
  })
  it('anonymous users cannot create', async () => {
    await actor(null,'anon')
    await expect(insert(patients[0],encounters[0],null)).rejects.toMatchObject({code:'42501'})
  })
  it('service-role insert still requires matching patient/encounter', async () => {
    await actor(null,'service_role')
    await expect(insert(patients[1],encounters[0],null)).rejects.toMatchObject({code:'23503',constraint:'follow_ups_encounter_patient_fk'})
  })
  it.each(['patient_id','encounter_id'])('service-role UPDATE cannot corrupt %s', async field => {
    await actor(null,'service_role')
    await expect(db.query(`update public.follow_ups set ${field}=$1 where id=$2`,[field==='patient_id'?patients[1]:encounters[1],followups[0].id]))
      .rejects.toMatchObject({code:'23503',constraint:'follow_ups_encounter_patient_fk'})
  })
  it('rejects patient reassignment of an appointment with follow-ups', async () => {
    await actor(null,'service_role')
    await expect(db.query('update public.appointments set patient_id=$1 where id=(select appointment_id from public.care_encounters where id=$2)',[patients[1],encounters[0]]))
      .rejects.toMatchObject({code:'23514'})
  })
  it('rejects moving a followed-up encounter to another patient appointment', async () => {
    await actor(null,'service_role')
    await expect(db.query('update public.care_encounters set appointment_id=(select appointment_id from public.care_encounters where id=$1) where id=$2',[encounters[1],encounters[0]]))
      .rejects.toMatchObject({code:'23514'})
  })
  it('rejects a new follow-up on an otherwise unreferenced inconsistent appointment chain', async () => {
    await actor(null,'service_role')
    const appointment=(await db.query(`insert into public.appointments(patient_id,provider_id,appointment_type,
      scheduled_start,scheduled_end,consultation_channel,booking_code)
      select $1,encounter.provider_id,'teleconsultation','2027-01-01T09:00Z','2027-01-01T09:30Z','video','FOLLOWUP-CHAIN'
      from public.care_encounters as encounter where encounter.id=$2 returning id`,[patients[1],encounters[0]])).rows[0].id
    const encounter=(await db.query(`insert into public.care_encounters(appointment_id,patient_id,provider_id,encounter_type)
      select $1,$2,existing.provider_id,'teleconsultation' from public.care_encounters as existing
      where existing.id=$3 returning id`,[appointment,patients[0],encounters[0]])).rows[0].id
    // This phase does not repair unrelated encounters. It does prevent a new
    // follow-up from depending on their inconsistent parent chain.
    await expect(insert(patients[0],encounter,null)).rejects.toMatchObject({code:'23514'})
  })
  it('retains Repair 1 FK enforcement after Repair 2', async () => {
    await actor(null,'service_role')
    await expect(db.query('update public.prescriptions set patient_id=$1 where id=$2',[patients[1],prescription.id]))
      .rejects.toMatchObject({code:'23503',constraint:'prescriptions_encounter_patient_fk'})
  })
})

it.each(['follow-up patient','appointment patient'])('aborts safely for inconsistent historical %s', async kind => {
  const {db,patients,encounters}=await baseline()
  try {
    if(kind==='follow-up patient') {
      await db.exec('begin')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(1)])
      await db.exec('set local role authenticated')
      // Prove the old self-assignment exploit accepts a foreign patient's ID.
      await db.query("insert into public.follow_ups(patient_id,encounter_id,assigned_to_profile_id,follow_up_type) values ($1,$2,$3,'call')",[patients[1],encounters[0],uid(1)])
      await db.exec('commit')
    } else await db.query('update public.appointments set patient_id=$1 where id=(select appointment_id from public.care_encounters where id=$2)',[patients[1],encounters[0]])
    const before=(await db.query('select * from public.follow_ups order by id')).rows
    const policies=(await db.query("select * from pg_policies where tablename='follow_ups' order by policyname")).rows
    expect((await db.exec(validation))[0].rows.length).toBeGreaterThan(0)
    await expect(db.exec(migration)).rejects.toMatchObject({code:'23514',message:expect.stringContaining('Follow-up repair stopped')})
    await db.exec('rollback')
    expect((await db.query('select * from public.follow_ups order by id')).rows).toEqual(before)
    expect((await db.query("select * from pg_policies where tablename='follow_ups' order by policyname")).rows).toEqual(policies)
    expect((await db.query("select conname from pg_constraint where conname='follow_ups_encounter_patient_fk'")).rows).toEqual([])
  } finally {await db.close()}
},60000)

