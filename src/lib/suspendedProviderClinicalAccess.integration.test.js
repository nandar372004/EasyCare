// @vitest-environment node
// Real PostgreSQL constraints/RLS; only managed Auth/Storage infrastructure is simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261001110000_suspended_provider_clinical_access.sql'
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/provider_clinical_access_validation.sql'), 'utf8')
const uid = n => `85000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Follow-up integrity test patient', phone: `+95985000000${n}`,
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


describe('Suspended provider clinical access',()=>{
  let db,patients,providers,encounters,followups,prescription,appointment;
  async function actor(n,role='authenticated') {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uid(n):'']);
    await db.exec(`set local role ${role}`);
  }
  const add=(patient=patients[0],encounter=encounters[0],assignee=uid(3))=>db.query("insert into public.follow_ups(patient_id,encounter_id,assigned_to_profile_id,follow_up_type) values ($1,$2,$3,'call') returning id",[patient,encounter,assignee]);
  beforeAll(async()=>{
    ({db,patients,providers,encounters,followups,prescription}=await baseline());
    appointment=(await db.query('select appointment_id from public.care_encounters where id=$1',[encounters[0]])).rows[0].appointment_id;
    await db.query("insert into public.patient_conditions(patient_id,condition_name,status,recorded_by) values ($1,'Test condition','active',$2)",[patients[0],uid(3)]);
    await db.query("insert into public.patient_allergies(patient_id,allergen,recorded_by) values ($1,'Test allergen',$2)",[patients[0],uid(3)]);
    await db.query('insert into auth.users(id) values ($1)',[uid(10)]);
    await db.query("insert into profiles(id,role,full_name) values ($1,'clinic_admin','Test clinic admin')",[uid(10)]);
    const clinic=(await db.query("insert into partner_clinics(name,status) values ('Test clinic','active') returning id")).rows[0].id;
    await db.query("insert into clinic_staff(clinic_id,profile_id,clinic_role) values ($1,$2,'sub_admin')",[clinic,uid(10)]);
    await db.query("insert into clinic_staff(clinic_id,profile_id,provider_id,clinic_role) values ($1,$2,$3,'doctor')",[clinic,uid(3),providers[0]]);
    await db.exec(migration);
  },60000);
  beforeEach(()=>db.exec('begin'));
  afterEach(()=>db.exec('rollback'));
  afterAll(()=>db?.close());
  it('executes read-only preflight and preserves Repair 1/2 constraints and data',async()=>{
    await db.exec(validation);
    expect((await db.query('select * from prescriptions where id=$1',[prescription.id])).rows[0]).toEqual(prescription);
    expect((await db.query("select convalidated from pg_constraint where conname in ('prescriptions_encounter_patient_fk','follow_ups_encounter_patient_fk')")).rows).toEqual([{convalidated:true},{convalidated:true}]);
  });
  it.each([3,5,6,8])('active related clinical staff %s can create/read/update/delete their follow-up',async n=>{
    await actor(n);
    const id=(await add(patients[0],encounters[0],uid(n))).rows[0].id;
    expect((await db.query('select id from follow_ups where id=$1',[id])).rows).toHaveLength(1);
    expect((await db.query("update follow_ups set instructions='Reviewed' where id=$1 returning id",[id])).rows).toHaveLength(1);
    expect((await db.query('delete from follow_ups where id=$1 returning id',[id])).rows).toHaveLength(1);
  });
  it('active related doctor can create a prescription',async()=>{
    await actor(3);
    expect((await db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',[encounters[0],patients[0],providers[0]])).rows).toHaveLength(1);
  });
  it.each(['active','suspended'])('unrelated %s doctor has no relationship-based access',async status=>{
    await db.query('update profiles set status=$1 where id=$2',[status,uid(4)]);
    await actor(4);
    expect((await db.query('select id from patient_conditions where patient_id=$1',[patients[0]])).rows).toEqual([]);
    expect((await db.query('update follow_ups set instructions=$1 where id=$2 returning id',['Forbidden',followups[0].id])).rows).toEqual([]);
    await expect(add(patients[0],encounters[0],uid(4))).rejects.toMatchObject({code:'42501'});
  });
  const states=[['profile','suspended'],['profile','inactive'],['provider','suspended'],['provider','pending'],['provider','rejected']];
  it.each(states)('%s %s denies related SELECT/UPDATE/DELETE and all helper paths',async(kind,status)=>{
    await db.query(kind==='profile'?'update profiles set status=$1 where id=$2':'update providers set verification_status=$1 where profile_id=$2',[status,uid(3)]);
    await actor(3);
    for(const table of ['care_encounters','patient_conditions','patient_allergies','prescriptions','follow_ups','consents']) {
      expect((await db.query(`select id from ${table}`)).rows,table).toEqual([]);
    }
    expect((await db.query("select public.clinical_identity_is_current() as identity,public.can_access_patient($1,'clinical') as access,public.is_appointment_provider($2) as appointment,public.can_manage_follow_up($1,$3) as followup",[patients[0],appointment,uid(3)])).rows[0]).toEqual({identity:false,access:false,appointment:false,followup:false});
    expect((await db.query("update care_encounters set care_plan='Forbidden' where id=$1 returning id",[encounters[0]])).rows).toEqual([]);
    expect((await db.query('delete from follow_ups where id=$1 returning id',[followups[0].id])).rows).toEqual([]);
  });
  it.each(states)('%s %s cannot INSERT by existing encounter assignment',async(kind,status)=>{
    await db.query(kind==='profile'?'update profiles set status=$1 where id=$2':'update providers set verification_status=$1 where profile_id=$2',[status,uid(3)]);
    await actor(3);
    await expect(add()).rejects.toMatchObject({code:'42501'});
  });
  it.each([5,8])('suspended assigned provider %s cannot regain access through care assignments',async n=>{
    await db.query("update profiles set status='suspended' where id=$1",[uid(n)]);
    await actor(n);
    expect((await db.query("select can_access_patient($1,'clinical') as allowed",[patients[0]])).rows[0].allowed).toBe(false);
    await expect(add(patients[0],encounters[0],uid(n))).rejects.toMatchObject({code:'42501'});
  });
  it('role alone without provider identity fails closed',async()=>{
    await db.query('update providers set profile_id=null where id=$1',[providers[0]]);
    await actor(3);
    expect((await db.query('select clinical_identity_is_current() as allowed')).rows[0].allowed).toBe(false);
    await expect(add()).rejects.toMatchObject({code:'42501'});
  });
  it('cannot borrow another provider ID',async()=>{
    await actor(4);
    await expect(db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3)',[encounters[0],patients[0],providers[0]])).rejects.toMatchObject({code:'42501'});
  });
  it.each(['active','inactive'])('clinic staff %s controls only clinic-related access',async status=>{
    await db.query('update clinic_staff set status=$1 where profile_id=$2',[status,uid(10)]);
    await actor(10);
    expect((await db.query("select can_access_patient($1,'alerts') as allowed",[patients[0]])).rows[0].allowed).toBe(status==='active');
    expect((await db.query("select can_access_patient($1,'alerts') as allowed",[patients[1]])).rows[0].allowed).toBe(false);
  });
  it('inactive linked clinician membership blocks clinic access but not independent doctor relationship',async()=>{
    await db.query("update clinic_staff set status='inactive' where profile_id=$1",[uid(3)]);
    await actor(10);
    expect((await db.query("select can_access_patient($1,'alerts') as allowed",[patients[0]])).rows[0].allowed).toBe(false);
    await actor(3);
    expect((await db.query("select can_access_patient($1,'clinical') as allowed",[patients[0]])).rows[0].allowed).toBe(true);
  });
  it('suspended clinic administrator cannot use active membership',async()=>{
    await db.query("update profiles set status='suspended' where id=$1",[uid(10)]);
    await actor(10);
    expect((await db.query("select can_access_patient($1,'alerts') as allowed",[patients[0]])).rows[0].allowed).toBe(false);
  });
  it('patient role with an inconsistent verified provider record cannot use clinical privileges',async()=>{
    await db.query("update profiles set role='patient' where id=$1",[uid(3)]);
    await actor(3);
    expect((await db.query('select id from care_encounters')).rows).toEqual([]);
    expect((await db.query("select can_access_patient($1,'clinical') as allowed",[patients[0]])).rows[0].allowed).toBe(false);
  });
  it('suspended doctor cannot use prescription INSERT policy',async()=>{
    await db.query("update profiles set status='suspended' where id=$1",[uid(3)]);
    await actor(3);
    await expect(db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3)',[encounters[0],patients[0],providers[0]])).rejects.toMatchObject({code:'42501'});
  });
  it('pending provider cannot use doctor role to insert a condition',async()=>{
    await db.query("update providers set verification_status='pending' where profile_id=$1",[uid(3)]);
    await actor(3);
    await expect(db.query("insert into patient_conditions(patient_id,condition_name,status,recorded_by) values ($1,'Forbidden','active',$2)",[patients[0],uid(3)])).rejects.toMatchObject({code:'42501'});
  });
  it('active doctor can update own encounter but cannot move it to another provider',async()=>{
    await actor(3);
    expect((await db.query("update care_encounters set care_plan='Reviewed' where id=$1 returning id",[encounters[0]])).rows).toHaveLength(1);
    await expect(db.query('update care_encounters set provider_id=$1 where id=$2',[providers[1],encounters[0]])).rejects.toMatchObject({code:'42501'});
  });
  it('cannot change provider profile identity',async()=>{
    await actor(3);
    await expect(db.query('update providers set profile_id=$1 where id=$2',[uid(4),providers[0]])).rejects.toThrow();
  });
  it.each([1,9])('preserves patient/family %s clinical reads and denies foreign patient',async n=>{
    await actor(n);
    expect((await db.query('select id from patient_conditions')).rows).toHaveLength(1);
    expect((await db.query("select can_access_patient($1,'clinical') as allowed",[patients[1]])).rows[0].allowed).toBe(false);
  });
  it('anonymous reads nothing and cannot insert',async()=>{
    await actor(null,'anon');
    expect((await db.query('select id from patient_conditions')).rows).toEqual([]);
    await expect(add()).rejects.toMatchObject({code:'42501'});
  });
  it('missing authenticated identity fails closed',async()=>{
    await actor(99);
    expect((await db.query('select clinical_identity_is_current() as allowed')).rows[0].allowed).toBe(false);
  });
  it('NULL authentication fails closed and anonymous users cannot execute authorization helpers',async()=>{
    await actor(null);
    expect((await db.query('select clinical_identity_is_current() as allowed')).rows[0].allowed).toBe(false);
    await actor(null,'anon');
    await expect(db.query('select clinical_identity_is_current()')).rejects.toMatchObject({code:'42501'});
  });
  it('suspended doctor cannot self-reactivate their profile',async()=>{
    await db.query("update profiles set status='suspended' where id=$1",[uid(3)]);
    await actor(3);
    await expect(db.query("update profiles set status='active' where id=$1",[uid(3)])).rejects.toThrow('Profile role and status are administratively managed');
  });
  it.each(['inactive','unavailable'])('non-active coordinator %s cannot manage assigned follow-ups',async status=>{
    await db.query('update care_coordinators set status=$1 where profile_id=$2',[status,uid(6)]);
    await actor(6);
    await expect(add(patients[0],encounters[0],uid(6))).rejects.toMatchObject({code:'42501'});
  });
  it.each(['prescriptions','follow_ups'])('Repair 1/2 %s patient integrity still enforced after Repair 3',async table=>{
    await expect(db.query(`update ${table} set patient_id=$1 where id=$2`,[patients[1],table==='prescriptions'?prescription.id:followups[0].id])).rejects.toMatchObject({code:'23503'});
  });
  it('all clinical restrictive policies cover old and new rows and do not grant access',async()=>{
    const rows=(await db.query("select * from pg_policies where policyname='clinical_identity_required'")).rows;
    expect(rows).toHaveLength(27);
    for(const row of rows){expect(row.permissive).toBe('RESTRICTIVE');expect(row.cmd).toBe('ALL');expect(row.qual).toContain('clinical_identity_is_current');expect(row.with_check).toContain('clinical_identity_is_current');}
  });
});

it('reproduces the old suspended encounter read and proves migration closes it without data changes',async()=>{
  const {db,encounters}=await baseline();
  try {
    await db.query("update profiles set status='suspended' where id=$1",[uid(3)]);
    const before=(await db.query('select * from care_encounters order by id')).rows;
    await db.exec('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(3)]);
    await db.exec('set local role authenticated');
    expect((await db.query('select id from care_encounters where id=$1',[encounters[0]])).rows).toHaveLength(1);
    await db.exec('rollback');
    await db.exec(migration);
    expect((await db.query('select * from care_encounters order by id')).rows).toEqual(before);
    await db.exec('begin');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(3)]);
    await db.exec('set local role authenticated');
    expect((await db.query('select id from care_encounters where id=$1',[encounters[0]])).rows).toEqual([]);
    await db.exec('rollback');
  } finally {await db.close();}
},60000);
