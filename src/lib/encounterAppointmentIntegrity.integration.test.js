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
const migration = readFileSync(join(directory, '20261002090000_encounter_appointment_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/encounter_appointment_validation.sql'), 'utf8')
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
  const patients = [], providers = [], encounters = []
  for (const n of [1, 2]) {
    patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: uid(n), fullName: 'Prescription integrity test patient', phone: `+95987000000${n}`,
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
  await db.exec(readFileSync(join(directory,migrationName),'utf8'))
  return { db, patients, providers, encounters, prescription }
}


// Historical fixtures are inserted before Repair 4, then Repairs 4 and 5 run in order.
describe('Encounter appointment patient integrity',()=>{
  let db,patients,providers,encounters,prescription,appointment,oldRows,oldPolicies;
  async function actor(n,role='authenticated'){
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uid(n):'']);
    if(n||role!=='authenticated')await db.exec(`set local role ${role}`);
  }
  const insert=(patient=patients[0],provider=providers[0],app=appointment)=>db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values ($1,$2,$3,'teleconsultation') returning id",[app,patient,provider]);
  beforeAll(async()=>{
    ({db,patients,providers,encounters,prescription}=await baseline());
    await db.query('update providers set consultation_fee_mmk=30000 where id=$1',[providers[0]]);
    const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2033-01-01T09:00Z','2033-01-01T09:30Z') returning id",[providers[0]])).rows[0].id;
    appointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code,fee_amount) values ($1,$2,$3,'teleconsultation','video','2033-01-01T09:00Z','2033-01-01T09:30Z','ENCOUNTER-AUDIT',0) returning id",[patients[0],providers[0],slot])).rows[0].id;
    oldRows=(await db.query('select * from care_encounters order by id')).rows;
    oldPolicies=(await db.query("select * from pg_policies where policyname<>'encounters_provider_manage' order by schemaname,tablename,policyname")).rows;
    await db.exec(migration);
  },60000);
  beforeEach(()=>db.exec('begin'));
  afterEach(()=>db.exec('rollback'));
  afterAll(()=>db?.close());
  it('preserves valid historical rows, other RLS policies, and validates FK',async()=>{
    expect((await db.query('select * from care_encounters order by id')).rows).toEqual(oldRows);
    expect((await db.query("select * from pg_policies where policyname<>'encounters_provider_manage' order by schemaname,tablename,policyname")).rows).toEqual(oldPolicies);
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='care_encounters_appointment_patient_fk'")).rows).toEqual([{convalidated:true,condeferrable:false}]);
    expect((await db.exec(validation)).map(r=>r.rows)).toEqual([[],[]]);
  });
  it('allows priced appointment -> encounter -> prescription -> follow-up -> patient reads',async()=>{
    expect(Number((await db.query('select fee_amount from appointments where id=$1',[appointment])).rows[0].fee_amount)).toBe(30000);
    await actor(3);const encounter=(await insert()).rows[0].id;
    const rx=(await db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id',[encounter,patients[0],providers[0]])).rows[0].id;
    const fu=(await db.query("insert into follow_ups(encounter_id,patient_id,assigned_to_profile_id,follow_up_type) values ($1,$2,$3,'call') returning id",[encounter,patients[0],uid(3)])).rows[0].id;
    expect((await db.query("update care_encounters set care_plan='Reviewed' where id=$1 returning id",[encounter])).rows).toHaveLength(1);
    await actor(1);
    for(const [table,id] of [['care_encounters',encounter],['prescriptions',rx],['follow_ups',fu]])expect((await db.query(`select id from ${table} where id=$1`,[id])).rows).toHaveLength(1);
    await actor(2);expect((await db.query('select id from care_encounters where id=$1',[encounter])).rows).toEqual([]);
  });
  it('blocks the exact forged encounter then prescription exploit at encounter INSERT',async()=>{
    await actor(3);await db.exec('savepoint attack');
    await expect(insert(patients[1])).rejects.toMatchObject({code:'42501'});
    await db.exec('rollback to savepoint attack');await actor(null);
    expect((await db.query('select id from care_encounters where appointment_id=$1',[appointment])).rows).toEqual([]);
  });
  it.each(['postgres','service_role'])('%s cannot insert inconsistent patient even with RLS bypass',async role=>{
    await actor(null,role==='postgres'?'authenticated':role);
    await expect(insert(patients[1])).rejects.toMatchObject({code:'23503',constraint:'care_encounters_appointment_patient_fk'});
  });
  it.each(['patient_id','appointment_id'])('service-role UPDATE cannot corrupt %s',async field=>{
    const encounter=(await insert()).rows[0].id;
    const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2033-01-02T09:00Z','2033-01-02T09:30Z') returning id",[providers[0]])).rows[0].id;
    const otherAppointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code) values ($1,$2,$3,'teleconsultation','video','2033-01-02T09:00Z','2033-01-02T09:30Z','OTHER-PATIENT') returning id",[patients[1],providers[0],slot])).rows[0].id;
    // The target appointment is valid and unused: only patient-pair integrity fails.
    await actor(null,'service_role');
    await expect(db.query(`update care_encounters set ${field}=$1 where id=$2`,[field==='patient_id'?patients[1]:otherAppointment,encounter])).rejects.toMatchObject({code:'23503',constraint:'care_encounters_appointment_patient_fk'});
  });
  it('doctor cannot change valid encounter patient',async()=>{
    await actor(3);const encounter=(await insert()).rows[0].id;
    await expect(db.query('update care_encounters set patient_id=$1 where id=$2',[patients[1],encounter])).rejects.toMatchObject({code:'42501'});
  });
  it('parent appointment patient change is blocked even without prescriptions/follow-ups',async()=>{
    await insert();await actor(null,'service_role');
    await expect(db.query('update appointments set patient_id=$1 where id=$2',[patients[1],appointment])).rejects.toMatchObject({code:'23001'});
  });
  it.each([4,1,null])('unauthorized actor %s cannot create encounter',async n=>{
    await actor(n,n?'authenticated':'anon');await expect(insert()).rejects.toMatchObject({code:'42501'});
  });
  it.each(['suspended','inactive'])('%s provider cannot invoke helper or create encounter',async status=>{
    await db.query('update profiles set status=$1 where id=$2',[status,uid(3)]);await actor(3);
    expect((await db.query('select can_manage_care_encounter($1,$2,$3) as allowed',[appointment,patients[0],providers[0]])).rows[0].allowed).toBe(false);
    await expect(insert()).rejects.toMatchObject({code:'42501'});
  });
  it('provider cannot substitute another encounter provider',async()=>{
    await actor(3);await expect(insert(patients[0],providers[1])).rejects.toMatchObject({code:'42501'});
  });
  it('preserves explicit administrator different-provider workflow with matching patient',async()=>{
    await db.query('insert into auth.users(id) values ($1)',[uid(7)]);
    await db.query("insert into profiles(id,role,full_name) values ($1,'main_admin','Audit administrator')",[uid(7)]);
    await actor(7);expect((await insert(patients[0],providers[1])).rows).toHaveLength(1);
  });
  it('Repair 1 downstream patient mismatch remains rejected',async()=>{
    const encounter=(await insert()).rows[0].id;await actor(null,'service_role');
    await expect(db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3)',[encounter,patients[1],providers[0]])).rejects.toMatchObject({code:'23503',constraint:'prescriptions_encounter_patient_fk'});
  });
  it('Repair 2 downstream patient mismatch remains rejected',async()=>{
    const encounter=(await insert()).rows[0].id;await actor(null,'service_role');
    await expect(db.query("insert into follow_ups(encounter_id,patient_id,follow_up_type) values ($1,$2,'call')",[encounter,patients[1]])).rejects.toMatchObject({code:'23503',constraint:'follow_ups_encounter_patient_fk'});
  });
});

it('reports historical forged encounter and downstream prescription, then aborts migration atomically',async()=>{
  const {db,patients,providers,encounters}=await baseline();
  try {
    // Existing encounter B has no prescriptions/follow-ups; forge it to patient A.
    await db.query('update care_encounters set patient_id=$1 where id=$2',[patients[0],encounters[1]]);
    await db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3)',[encounters[1],patients[0],providers[1]]);
    const before=(await db.query('select * from care_encounters order by id')).rows;
    const reports=await db.exec(validation);expect(reports[0].rows).toHaveLength(1);expect(reports[0].rows[0].structural_blocker).toBe(true);expect(reports[1].rows).toHaveLength(1);
    await expect(db.exec(migration)).rejects.toMatchObject({code:'23514',message:expect.stringContaining('Encounter repair stopped')});
    await db.exec('rollback');expect((await db.query('select * from care_encounters order by id')).rows).toEqual(before);
    expect((await db.query("select conname from pg_constraint where conname='care_encounters_appointment_patient_fk'")).rows).toEqual([]);
  } finally {await db.close();}
},60000);
