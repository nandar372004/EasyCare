// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
const directory = join(process.cwd(), 'supabase/migrations')
const name = '20261003090000_family_foundation.sql'
const healthReadMigration = '20261003100000_family_health_read_access.sql'
const carePlanMigration = '20261003110000_clinical_smart_care_plans.sql'
const carePlanReconciliationMigration = '20261003120000_care_plan_source_reconciliation.sql'
const automaticReconciliationMigration = '20261003130000_care_plan_event_driven_reconciliation.sql'
const familyCarePlanMigration = '20261003140000_family_care_plan_read_projection.sql'
const rollingCarePlanMigration = '20261004110000_care_plan_rolling_occurrence_horizon.sql'
const stagingRepairMigration = '20261008090000_phase_j_staging_read_contract_repair.sql'
const alertPrivilegeMigration = '20261008091000_phase_j_monitoring_alert_read_privileges.sql'
const followUpPrivilegeMigration = '20261008092000_phase_j_follow_up_read_privileges.sql'
const familyPatientCarePlanMigration = '20261013140000_family_patient_owned_care_plan_readout.sql'
const uid = n => `99000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let db, patients = [], before, migrationCount
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args)).rows[0].result
async function actor(n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
async function addMember(group, recipient = 2) {
  await actor(recipient); const code = await rpc('create_family_join_code')
  await actor(1); const invitation = await rpc('invite_family_member',[group,code,'mother'])
  await actor(recipient); await rpc('respond_family_invitation',[invitation,true])
  const member = (await db.query('select * from public.get_family_members($1)',[group])).rows.find(r=>r.is_self)
  return { member: member.id, invitation, code }
}
async function family() { await actor(1); const group=await rpc('create_family_group',['Recorded Family']); const result=await addMember(group); return {group,...result} }
async function grant(member, permissions = { records:true }, days = 1) {
  return rpc('grant_family_authorization',[member,JSON.stringify(permissions),new Date(Date.now()+days*86400000).toISOString()])
}
async function planTask({ type, title, day, time, vitalType = null, medicationId = null, scheduleId = null, appointmentId = null, followUpId = null, grace = 60, manualAcknowledgement = false }) {
  await actor(5)
  const plan=await rpc('create_care_plan_draft',[patients[0],null,`Plan ${title}`,null,null,'Asia/Yangon',null,null])
  const task=await rpc('add_care_plan_task',[plan,type,title,null,true,manualAcknowledgement,'one_time',day,null,null,[time],'Asia/Yangon',vitalType,medicationId,scheduleId,appointmentId,followUpId,null])
  if (grace !== 60) { await actor(0,'service_role'); await db.query('update care_plan_tasks set grace_minutes=$1 where id=$2',[grace,task]); await actor(5) }
  await rpc('approve_care_plan_version',[plan,null])
  await rpc('transition_care_plan',[plan,'activate',null])
  await rpc('extend_care_plan_occurrences',[plan,day])
  if (await rpc('extend_care_plan_occurrences',[plan,day]) !== 0) throw new Error('Care plan occurrence generation was not idempotent')
  return { plan, task }
}
beforeAll(async () => {
  db=new PGlite({extensions:{btree_gist,pgcrypto}})
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema storage; create table storage.buckets(id text primary key,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;`)
  const migrations=readdirSync(directory).filter(n=>n.endsWith('.sql') && n<name).sort()
  migrationCount=migrations.length
  for(const file of migrations) await db.exec(readFileSync(join(directory,file),'utf8'))
  await db.exec('create unique index patient_medications_id_patient_fixture_key on public.patient_medications(id,patient_id)')
  await db.exec('alter table public.patient_medications add column if not exists instructions text')
  for (const file of [
    '20261005110000_patient_reported_health_intake.sql',
    '20261012100000_patient_medication_checkins.sql',
    '20261012110000_patient_owned_health_goals.sql',
    '20261012120000_patient_owned_monitoring_plans.sql',
    '20261012130000_patient_owned_lifestyle_plans.sql',
    '20261012180000_patient_monitoring_measurements.sql',
  ]) await db.exec(readFileSync(join(directory,file),'utf8'))
  for(const n of [1,2,3,4]) {
    await db.query('insert into auth.users(id) values($1)',[uid(n)])
    patients.push(await rpc('create_patient_registration',[JSON.stringify({userId:uid(n),fullName:`Recorded person ${n}`,phone:`+95999000000${n}`,dateOfBirth:n===4?'2015-01-01':'1990-01-01',medicalProfile:{}})]))
    await db.query("insert into vital_readings(patient_id,heart_rate,recorded_at,source) values($1,80,statement_timestamp(),'manual')",[patients.at(-1)])
  }
  await db.query('insert into auth.users(id) values($1)',[uid(5)])
  await db.query("insert into profiles(id,role,full_name) values($1,'doctor','Recorded clinician')",[uid(5)])
  const provider=(await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values($1,'doctor','verified',25000) returning id",[uid(5)])).rows[0].id
  const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation','2026-12-01T09:00Z','2026-12-01T09:30Z') returning id",[provider])).rows[0].id
  await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code) values($1,$2,$3,'teleconsultation','2026-12-01T09:00Z','2026-12-01T09:30Z','video','FAMILY-TEST')",[patients[0],provider,slot])
  await db.query("insert into family_authorizations(patient_id,family_profile_id,status,authorized_at,can_view_records) values($1,$2,'active',statement_timestamp(),true)",[patients[2],uid(1)])
  before={
    patientConstraints:(await db.query("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.patients'::regclass order by conname")).rows,
    fk:(await db.query("select conname,conrelid::regclass::text as child,pg_get_constraintdef(oid) as definition from pg_constraint where confrelid='public.patients'::regclass order by conname")).rows,
    providerFunction:(await db.query("select pg_get_functiondef('public.is_appointment_provider(uuid)'::regprocedure) as definition")).rows[0].definition,
    policy:(await db.query("select * from pg_policies where tablename not in ('family_authorizations') order by tablename,policyname")).rows,
    helper:(await db.query("select pg_get_functiondef('public.can_access_patient(uuid,text)'::regprocedure) as definition")).rows[0].definition,
  }
  await db.exec(readFileSync(join(directory,name),'utf8'))
  await db.exec(readFileSync(join(directory,healthReadMigration),'utf8'))
  await db.exec(readFileSync(join(directory,carePlanMigration),'utf8'))
  await db.exec(readFileSync(join(directory,carePlanReconciliationMigration),'utf8'))
  await db.exec(readFileSync(join(directory,automaticReconciliationMigration),'utf8'))
  await db.exec(readFileSync(join(directory,familyCarePlanMigration),'utf8'))
  await db.exec(readFileSync(join(directory,rollingCarePlanMigration),'utf8'))
  await db.exec(readFileSync(join(directory,familyPatientCarePlanMigration),'utf8'))
  await db.exec(readFileSync(join(directory,stagingRepairMigration),'utf8'))
},30000)
beforeEach(async()=>db.exec('begin'))
afterEach(async()=>db.exec('rollback'))
afterAll(async()=>db?.close())

describe('Phase J monitoring alert column privilege repair',()=>{
  const repair = () => db.exec(readFileSync(join(directory,alertPrivilegeMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,''))
  const readAlerts = () => db.query("select id,alert_type,severity,status,title,message,detected_at,created_at from monitoring_alerts where patient_id=$1 and status in ('open','acknowledged','escalated') order by created_at desc,id limit 10",[patients[0]])
  const removeReadPrivileges = async () => {
    await db.exec('reset role; revoke select on monitoring_alerts from authenticated')
    const columns=(await db.query("select attname from pg_attribute where attrelid='monitoring_alerts'::regclass and attnum>0 and not attisdropped")).rows.map(row=>`"${row.attname}"`).join(',')
    await db.exec(`revoke select (${columns}) on monitoring_alerts from authenticated`)
  }
  it('repairs missing privileges and preserves policies, clinical rows and write privileges',async()=>{
    await actor(0,'service_role')
    await db.query("insert into monitoring_alerts(patient_id,alert_type,severity,message,title) values($1,'review','warning','Synthetic message','Recorded alert')",[patients[0]])
    await removeReadPrivileges()
    const snapshot = async () => ({
      rows:(await db.query('select to_jsonb(a) as row from monitoring_alerts a order by id')).rows,
      policies:(await db.query("select * from pg_policies where tablename='monitoring_alerts' order by policyname")).rows,
      helper:(await db.query("select pg_get_functiondef('public.can_access_patient(uuid,text)'::regprocedure) as definition")).rows,
      writes:(await db.query("select attname,has_column_privilege('authenticated',attrelid,attname,'INSERT') as insert_access,has_column_privilege('authenticated',attrelid,attname,'UPDATE') as update_access from pg_attribute where attrelid='monitoring_alerts'::regclass and attnum>0 and not attisdropped order by attnum")).rows,
    })
    const beforeRepair=await snapshot()
    await actor(1); await db.exec('savepoint missing_alert_select')
    await expect(readAlerts()).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to missing_alert_select; reset role')
    await repair(); await repair()
    expect(await snapshot()).toEqual(beforeRepair)
    expect((await db.query("select has_table_privilege('authenticated','monitoring_alerts','SELECT') as broad,has_column_privilege('authenticated','monitoring_alerts','patient_id','SELECT') as filter,has_column_privilege('authenticated','monitoring_alerts','vital_reading_id','SELECT') as provenance,has_column_privilege('authenticated','monitoring_alerts','reviewed_by_profile_id','SELECT') as reviewer")).rows[0]).toEqual({broad:false,filter:true,provenance:false,reviewer:false})
    await actor(1)
    expect((await readAlerts()).rows).toHaveLength(1)
    await actor(3)
    expect((await readAlerts()).rows).toEqual([])
  })
  it('restricts shared alerts to explicit scope and denies revoked, expired and foreign-family access',async()=>{
    const {member}=await family()
    await actor(0,'service_role')
    for(const patient of [patients[0],patients[2]]) await db.query("insert into monitoring_alerts(patient_id,alert_type,severity,message) values($1,'review','warning','Synthetic message')",[patient])
    await removeReadPrivileges(); await repair()
    await actor(2)
    expect((await readAlerts()).rows).toEqual([])
    await actor(1); await grant(member,{records:true})
    await actor(2)
    expect((await readAlerts()).rows).toEqual([])
    await actor(1); await grant(member,{alerts:true})
    await actor(2)
    expect((await readAlerts()).rows).toHaveLength(1)
    expect((await db.query('select patient_id,message from monitoring_alerts')).rows.map(row=>row.patient_id)).toEqual([patients[0]])
    await actor(3); await rpc('create_family_group',['Separate family'])
    await actor(3)
    expect((await readAlerts()).rows).toEqual([])
    for(const state of ['revoked','expired']) {
      await actor(0,'service_role')
      if(state==='revoked') await db.query("update family_authorizations set status='revoked',revoked_at=statement_timestamp() where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
      else await db.query("update family_authorizations set status='active',revoked_at=null,authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
      await actor(2)
      expect((await readAlerts()).rows).toEqual([])
    }
  })
  it.each(['disabled','broad'])('refuses privilege repair when RLS is %s',async drift=>{
    await removeReadPrivileges()
    if(drift==='disabled') await db.exec('alter table monitoring_alerts disable row level security')
    else await db.exec('create policy unsafe_alert_read on monitoring_alerts for select to authenticated using (true)')
    await db.exec('savepoint unsafe_alert_rls')
    await expect(repair()).rejects.toThrow('scoped alerts_read RLS contract')
    await db.exec('rollback to unsafe_alert_rls')
    expect((await db.query("select has_column_privilege('authenticated','monitoring_alerts','message','SELECT') as allowed")).rows[0].allowed).toBe(false)
  })
})

describe('full-chain family foundation / PostgreSQL RLS',()=>{
  it('restricts standalone follow-up reads to owner or active records sharing',async()=>{
    const {member}=await family()
    await actor(0,'service_role')
    const appointment=(await db.query('select id,provider_id from appointments where patient_id=$1',[patients[0]])).rows[0]
    const encounter=(await db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values($1,$2,$3,'teleconsultation') returning id",[appointment.id,patients[0],appointment.provider_id])).rows[0].id
    await db.query("insert into follow_ups(encounter_id,patient_id,follow_up_type,due_at) values($1,$2,'call',statement_timestamp()-interval '1 day')",[encounter,patients[0]])
    await db.exec('reset role; revoke select on follow_ups from authenticated')
    const columns=(await db.query("select attname from pg_attribute where attrelid='follow_ups'::regclass and attnum>0 and not attisdropped")).rows.map(row=>`"${row.attname}"`).join(',')
    await db.exec(`revoke select (${columns}) on follow_ups from authenticated`)
    const read=()=>db.query('select id,patient_id,follow_up_type,due_at,status,completed_at from follow_ups')
    await actor(1); await db.exec('savepoint missing_follow_up_select')
    await expect(read()).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to missing_follow_up_select; reset role')
    const snapshot=async()=>({
      rows:(await db.query('select to_jsonb(f) as row from follow_ups f order by id')).rows,
      policies:(await db.query("select * from pg_policies where tablename='follow_ups' order by policyname")).rows,
      writes:(await db.query("select attname,has_column_privilege('authenticated',attrelid,attname,'INSERT') as insert_access,has_column_privilege('authenticated',attrelid,attname,'UPDATE') as update_access from pg_attribute where attrelid='follow_ups'::regclass and attnum>0 and not attisdropped order by attnum")).rows,
      deleteAccess:(await db.query("select has_table_privilege('authenticated','follow_ups','DELETE') as allowed")).rows,
    })
    const beforeRepair=await snapshot()
    const repair=readFileSync(join(directory,followUpPrivilegeMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,'')
    await db.exec(repair); await db.exec(repair)
    expect(await snapshot()).toEqual(beforeRepair)
    expect((await db.query("select has_table_privilege('authenticated','follow_ups','SELECT') as broad,has_column_privilege('authenticated','follow_ups','instructions','SELECT') as instructions,has_column_privilege('authenticated','follow_ups','encounter_id','SELECT') as encounter,has_column_privilege('authenticated','follow_ups','assigned_to_profile_id','SELECT') as assignee")).rows[0]).toEqual({broad:false,instructions:false,encounter:false,assignee:false})
    await actor(1); expect((await read()).rows).toHaveLength(1)
    await actor(2); expect((await read()).rows).toEqual([])
    await actor(1); await grant(member,{records:true})
    await actor(2); expect((await read()).rows.map(row=>row.patient_id)).toEqual([patients[0]])
    await actor(3); expect((await read()).rows).toEqual([])
    await actor(0,'service_role')
    await db.query("update family_authorizations set authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
    await actor(2); expect((await read()).rows).toEqual([])
    await actor(1); await grant(member,{records:true})
    await actor(0,'service_role')
    await db.query("update family_authorizations set status='revoked',revoked_at=statement_timestamp() where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
    await actor(2); expect((await read()).rows).toEqual([])
    await actor(1); await grant(member,{records:true}); await rpc('remove_family_member',[member])
    await actor(2); expect((await read()).rows).toEqual([])
  })
  it.each(['disabled','broad'])('refuses follow-up privilege repair when RLS is %s',async drift=>{
    await db.exec('reset role')
    if(drift==='disabled') await db.exec('alter table follow_ups disable row level security')
    else await db.exec('create policy unsafe_follow_up_read on follow_ups for select to authenticated using (true)')
    await db.exec('savepoint unsafe_follow_up_rls')
    const repair=readFileSync(join(directory,followUpPrivilegeMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,'')
    await expect(db.exec(repair)).rejects.toThrow('authorized follow-up RLS contract')
    await db.exec('rollback to unsafe_follow_up_rls')
  })
  it('preserves and accepts the inspected legacy Staging assignee policy',async()=>{
    await db.exec("reset role; drop policy follow_ups_staff_read on follow_ups; create policy follow_ups_assignee_manage on follow_ups for all to authenticated using (assigned_to_profile_id=auth.uid() or public.is_main_admin()) with check (assigned_to_profile_id=auth.uid() or public.is_main_admin())")
    const policies=(await db.query("select * from pg_policies where tablename='follow_ups' order by policyname")).rows
    await db.exec(readFileSync(join(directory,followUpPrivilegeMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,''))
    expect((await db.query("select * from pg_policies where tablename='follow_ups' order by policyname")).rows).toEqual(policies)
  })
  it('repairs the inspected Staging drift without clinical writes or policy changes',async()=>{
    await db.exec('reset role')
    const policies=(await db.query("select * from pg_policies order by schemaname,tablename,policyname")).rows
    const truth=(await db.query("select pg_get_functiondef('public.care_plan_occurrence_is_complete(uuid)'::regprocedure) as completion, pg_get_functiondef('public.get_care_plan_progress(uuid,timestamptz)'::regprocedure) as progress")).rows
    const appointment=(await db.query('select to_jsonb(a) as row from appointments a')).rows
    await db.exec(`revoke select(updated_at) on appointments from authenticated;
      alter table monitoring_alerts drop column title;
      alter table monitoring_alerts drop column detected_at;
      drop function public.get_family_care_plan_readout(uuid,uuid);
      drop function public.get_care_plan_occurrences(uuid);
      drop function public.list_my_care_plan_summaries();`)
    const base=readFileSync(join(directory,carePlanMigration),'utf8')
    const oldDetail=base.match(/create (?:or replace )?function public\.get_care_plan_detail\([\s\S]*?\$\$;/)[0]
    await db.exec('drop function public.get_care_plan_detail(uuid)')
    await db.exec(oldDetail)
    await actor(1)
    await db.exec('savepoint missing_privilege')
    await expect(db.query('select id,patient_id,scheduled_start,scheduled_end,status,created_at,updated_at from appointments')).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to missing_privilege')
    await db.exec('reset role')
    await db.exec(readFileSync(join(directory,stagingRepairMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,''))
    expect((await db.query("select * from pg_policies order by schemaname,tablename,policyname")).rows).toEqual(policies)
    expect((await db.query("select pg_get_functiondef('public.care_plan_occurrence_is_complete(uuid)'::regprocedure) as completion, pg_get_functiondef('public.get_care_plan_progress(uuid,timestamptz)'::regprocedure) as progress")).rows).toEqual(truth)
    expect((await db.query('select to_jsonb(a) as row from appointments a')).rows).toEqual(appointment)
    expect((await db.query("select has_table_privilege('authenticated','appointments','SELECT') as broad,has_column_privilege('authenticated','appointments','updated_at','SELECT') as column_read,has_column_privilege('authenticated','appointments','updated_at','UPDATE') as write")).rows[0]).toEqual({broad:false,column_read:true,write:false})
    await actor(1)
    expect((await db.query('select id,patient_id,scheduled_start,scheduled_end,status,created_at,updated_at from appointments')).rows).toHaveLength(1)
    expect((await db.query('select id,alert_type,severity,status,title,message,detected_at,created_at from monitoring_alerts')).rows).toEqual([])
    expect(await rpc('list_my_care_plan_summaries')).toEqual([])
    await actor(3)
    expect((await db.query('select id,updated_at from appointments')).rows).toEqual([])
  })
  it('refuses the repair if appointment RLS is disabled',async()=>{
    await db.exec('reset role; alter table appointments disable row level security; savepoint unsafe_rls')
    await expect(db.exec(readFileSync(join(directory,stagingRepairMigration),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,''))).rejects.toThrow('scoped appointment RLS contract')
    await db.exec('rollback to unsafe_rls')
    expect((await db.query("select relrowsecurity from pg_class where oid='appointments'::regclass")).rows[0].relrowsecurity).toBe(false)
  })
  it('allows alert readout only for explicit active family scope and hides revoked or expired rows',async()=>{
    const {group,member}=await family()
    await actor(0,'service_role')
    await db.query("insert into monitoring_alerts(patient_id,alert_type,severity,message,title) values($1,'review','warning','Synthetic alert','Shared alert')",[patients[0]])
    await actor(1); await grant(member,{alerts:true})
    await actor(2)
    expect((await db.query('select title,message,detected_at,created_at from monitoring_alerts')).rows).toHaveLength(1)
    await actor(3)
    expect((await db.query('select title,message from monitoring_alerts')).rows).toEqual([])
    for(const state of ['revoked','expired']) {
      await actor(0,'service_role')
      if(state==='revoked') await db.query("update family_authorizations set status='revoked',revoked_at=statement_timestamp() where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
      else await db.query("update family_authorizations set status='active',revoked_at=null,authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
      await actor(2)
      expect((await db.query('select title,message from monitoring_alerts')).rows).toEqual([])
    }
  })
  it('replays all 44 historical migrations plus the forward migration and preserves identity/FKs',async()=>{
    expect(migrationCount).toBe(44)
    expect((await db.query("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.patients'::regclass order by conname")).rows).toEqual(before.patientConstraints)
    const after=(await db.query("select conname,conrelid::regclass::text as child,pg_get_constraintdef(oid) as definition from pg_constraint where confrelid='public.patients'::regclass order by conname")).rows
    expect(after.filter(r=>r.child!=='family_group_members' && r.child!=='care_plans')).toEqual(before.fk)
    expect(after.some(r=>r.child==='family_group_members')).toBe(true)
    expect(after.some(r=>r.child==='care_plans')).toBe(true)
    expect((await db.query('select id from patients where profile_id<>auth_user_id or auth_user_id is null')).rows).toEqual([])
    expect((await db.query("select has_function_privilege('authenticated','public.reconcile_care_plan_patient_internal(uuid)','execute') as internal_access")).rows[0].internal_access).toBe(false)
    expect((await db.query("select tgname from pg_trigger where not tgisinternal and tgname like '%care_plan_reconcile' order by tgname")).rows.map(row=>row.tgname)).toEqual([
      'appointments_care_plan_reconcile','follow_ups_care_plan_reconcile','medication_events_care_plan_reconcile','vital_readings_care_plan_reconcile',
    ])
  })
  it('preserves existing RLS/helper semantics and adds only the scoped family read policies',async()=>{
    expect((await db.query("select pg_get_functiondef('public.is_appointment_provider(uuid)'::regprocedure) as definition")).rows[0].definition).toBe(before.providerFunction)
    const familyReadPolicies = new Set(['appointments:appointments_family_read','patient_medications:patient_medications_family_read','medication_schedules:medication_schedules_family_read'])
    const after=(await db.query("select * from pg_policies where tablename not in ('family_authorizations','family_groups','family_group_members','family_join_codes','family_invitations','care_plans','care_plan_versions','care_plan_goals','care_plan_tasks','care_plan_task_occurrences','care_plan_events') order by tablename,policyname")).rows
    expect(after.filter(row => familyReadPolicies.has(`${row.tablename}:${row.policyname}`))).toHaveLength(3)
    const preserved=after.filter(row => !familyReadPolicies.has(`${row.tablename}:${row.policyname}`))
    expect(preserved).toEqual(before.policy)
    const helper=(await db.query("select pg_get_functiondef('public.can_access_patient(uuid,text)'::regprocedure) as definition")).rows[0].definition
    expect(helper.slice(helper.indexOf('or exists (\n      select 1 from public.providers'))).toBe(before.helper.slice(before.helper.indexOf('or exists (\n      select 1 from public.providers')))
  })
  it('resolves clinical UUIDs only for accepted members in the caller family',async()=>{
    const {group}=await family()
    await actor(1)
    const rows=(await db.query('select * from public.get_family_health_members($1)',[group])).rows
    expect(rows).toHaveLength(2)
    expect(rows.find(row=>row.is_self).patient_id).toBe(patients[0])
    expect(rows.find(row=>!row.is_self).patient_id).toBe(patients[1])
    await actor(3)
    await expect(db.query('select * from public.get_family_health_members($1)',[group])).rejects.toMatchObject({code:'42501'})
  })
  it('grants read-only appointment and medication rows only for their explicit family scopes',async()=>{
    const {group}=await family()
    let appointmentId, medicationId
    await actor(0,'service_role')
    const provider=(await db.query('select id from providers where profile_id=$1',[uid(5)])).rows[0].id
    const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation','2026-12-02T09:00Z','2026-12-02T09:30Z') returning id",[provider])).rows[0].id
    appointmentId=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code) values($1,$2,$3,'teleconsultation','2026-12-02T09:00Z','2026-12-02T09:30Z','video','MOTHER-TEST') returning id",[patients[1],provider,slot])).rows[0].id
    medicationId=(await db.query("insert into patient_medications(patient_id,medication_name,status) values($1,'Synthetic Medication','active') returning id",[patients[1]])).rows[0].id
    await db.query("insert into medication_schedules(patient_medication_id,time_of_day) values($1,'09:00')",[medicationId])

    await actor(1)
    expect((await db.query('select id from appointments where patient_id=$1',[patients[1]])).rows).toEqual([])
    expect((await db.query('select id from patient_medications where patient_id=$1',[patients[1]])).rows).toEqual([])
    expect((await db.query('select id from vital_readings where patient_id=$1',[patients[1]])).rows).toEqual([])

    await actor(2)
    const viewer=(await db.query('select * from public.get_family_health_members($1)',[group])).rows.find(row=>!row.is_self)
    await grant(viewer.member_id,{appointments:true,medications:true})
    await actor(1)
    expect((await db.query('select id from appointments where patient_id=$1',[patients[1]])).rows).toEqual([{id:appointmentId}])
    expect((await db.query('select id from patient_medications where patient_id=$1',[patients[1]])).rows).toEqual([{id:medicationId}])
    expect((await db.query('select id from medication_schedules where patient_medication_id=$1',[medicationId])).rows).toHaveLength(1)
    expect((await db.query('select id from vital_readings where patient_id=$1',[patients[1]])).rows).toEqual([])
    expect((await db.query('select id from appointments where patient_id=$1',[patients[2]])).rows).toEqual([])
    await db.exec('savepoint denied_appointment_update')
    await expect(db.query("update appointments set status='cancelled' where id=$1",[appointmentId])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied_appointment_update')
    await db.exec('savepoint denied_medication_update')
    await expect(db.query("update patient_medications set medication_name='Changed by family' where id=$1",[medicationId])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied_medication_update')

    await actor(2)
    const auth=(await db.query("select id from family_authorizations where patient_id=$1 and family_profile_id=$2",[patients[1],uid(1)])).rows[0].id
    await rpc('revoke_family_authorization',[auth])
    await actor(1)
    expect((await db.query('select id from appointments where patient_id=$1',[patients[1]])).rows).toEqual([])
    expect((await db.query('select id from patient_medications where patient_id=$1',[patients[1]])).rows).toEqual([])
  })
  it('allows own group/membership reads but denies unrelated enumeration',async()=>{
    await actor(1); const group=await rpc('create_family_group',['My Family'])
    expect((await db.query('select * from get_my_family_groups()')).rows).toHaveLength(1)
    expect((await db.query('select id from family_group_members')).rows).toHaveLength(1)
    await actor(3)
    expect((await db.query('select id from family_groups')).rows).toEqual([])
    expect((await db.query('select id from family_group_members')).rows).toEqual([])
    await expect(db.query('select * from get_family_members($1)',[group])).rejects.toMatchObject({code:'42501'})
  })
  it('requires the intended account to accept and acceptance grants no clinical permission',async()=>{
    await actor(1); const group=await rpc('create_family_group',['My Family'])
    await actor(2); const code=await rpc('create_family_join_code')
    await actor(1); const invitation=await rpc('invite_family_member',[group,code,'mother'])
    expect((await db.query('select * from get_family_members($1)',[group])).rows).toHaveLength(1)
    await actor(3)
    expect((await db.query('select id from family_invitations')).rows).toEqual([])
    await db.exec('savepoint denied')
    await expect(rpc('respond_family_invitation',[invitation,true])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied')
    await actor(2); await rpc('respond_family_invitation',[invitation,true])
    expect((await db.query('select * from get_family_members($1)',[group])).rows).toHaveLength(2)
    await actor(1)
    expect(await rpc('can_access_patient',[patients[1],'view'])).toBe(false)
    expect((await db.query('select id from vital_readings where patient_id=$1',[patients[1]])).rows).toEqual([])
    await actor(0,'service_role')
    expect((await db.query('select id from family_authorizations where patient_id=$1',[patients[1]])).rows).toEqual([])
  })
  it.each(['family_groups','family_group_members','family_invitations','family_authorizations'])('rejects unsafe direct writes to %s',async table=>{
    await actor(1)
    await expect(db.query(`delete from public.${table}`)).rejects.toMatchObject({code:'42501'})
  })
  it('rejects forged membership and invitations with arbitrary UUIDs',async()=>{
    await actor(1)
    await db.exec('savepoint denied')
    await expect(db.query("insert into family_group_members(family_group_id,patient_id,relationship,role,added_by) values($1,$2,'other','owner',$3)",[uid(77),patients[1],uid(1)])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied')
    const group=await rpc('create_family_group',['Mine'])
    await expect(rpc('invite_family_member',[group,patients[1],'mother'])).rejects.toMatchObject({code:'42501'})
  })
  it('an active explicit grant applies only to selected scopes and patient',async()=>{
    const {member}=await family(); await actor(2)
    const owner=(await db.query('select * from get_family_members((select family_group_id from family_group_members where id=$1))',[member])).rows.find(r=>!r.is_self)
    await grant(owner.id,{records:true,alerts:false})
    await actor(1)
    expect(await rpc('can_access_patient',[patients[1],'view'])).toBe(true)
    expect(await rpc('can_access_patient',[patients[1],'appointments'])).toBe(false)
    expect(await rpc('can_access_patient',[patients[1],'medications'])).toBe(false)
    expect(await rpc('can_access_patient',[patients[1],'alerts'])).toBe(false)
    expect(await rpc('can_access_patient',[patients[3],'view'])).toBe(false)
    expect((await db.query('select id from vital_readings where patient_id=$1',[patients[1]])).rows).toHaveLength(1)
  })
  it.each(['revoked','expired','pending','withdrawn'])('denies %s authorization through real RLS',async state=>{
    const {member}=await family(); await actor(1); const id=await grant(member)
    if(state==='revoked') await rpc('revoke_family_authorization',[id])
    else {
      await actor(0,'service_role')
      if(state==='expired') await db.query("update family_authorizations set authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 second' where id=$1",[id])
      if(state==='pending') await db.query("update family_authorizations set status='pending' where id=$1",[id])
      if(state==='withdrawn') await db.query("update consents set status='withdrawn',withdrawn_at=statement_timestamp() where id=(select consent_id from family_authorizations where id=$1)",[id])
    }
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'view'])).toBe(false)
    expect((await db.query('select id from vital_readings where patient_id=$1',[patients[0]])).rows).toEqual([])
  })
  it('cannot self-grant to foreign data or revoke another patient grant',async()=>{
    const {member}=await family(); await actor(1); const id=await grant(member)
    expect(await rpc('can_access_patient',[patients[1],'view'])).toBe(false)
    await actor(3)
    await db.exec('savepoint denied')
    await expect(grant(member)).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied')
    await expect(rpc('revoke_family_authorization',[id])).rejects.toMatchObject({code:'42501'})
  })
  it('removing membership revokes group grants without deleting clinical history and is audited',async()=>{
    const {group,member}=await family(); await actor(1); const id=await grant(member)
    await rpc('remove_family_member',[member])
    await actor(2)
    expect((await db.query('select * from get_my_family_groups()')).rows).toEqual([])
    expect(await rpc('can_access_patient',[patients[0],'view'])).toBe(false)
    expect(await rpc('can_access_patient',[patients[1],'view'])).toBe(true)
    await actor(0,'service_role')
    expect((await db.query('select id from vital_readings where patient_id in ($1,$2)',[patients[0],patients[1]])).rows).toHaveLength(2)
    expect((await db.query('select status,revoked_by from family_authorizations where id=$1',[id])).rows[0]).toEqual({status:'revoked',revoked_by:uid(1)})
    expect((await db.query("select id from audit_logs where entity_table='family_group_members' and entity_id=$1 and action='update'",[member])).rows).toHaveLength(1)
    expect((await db.query('select id from family_groups where id=$1',[group])).rows).toHaveLength(1)
  })
  it('allows leaving while preventing member removal of others or the owner',async()=>{
    const {group,member}=await family(); await actor(2)
    const owner=(await db.query('select * from get_family_members($1)',[group])).rows.find(r=>r.role==='owner')
    await db.exec('savepoint denied')
    await expect(rpc('remove_family_member',[owner.id])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied')
    await rpc('remove_family_member',[member])
    expect((await db.query('select * from get_my_family_groups()')).rows).toEqual([])
  })
  it('declines/cancels invitations and prevents code reuse or expired acceptance',async()=>{
    await actor(1); const group=await rpc('create_family_group',['Mine'])
    await actor(2); const code=await rpc('create_family_join_code')
    await actor(1); const id=await rpc('invite_family_member',[group,code,'parent'])
    await db.exec('savepoint denied'); await expect(rpc('invite_family_member',[group,code,'parent'])).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to savepoint denied')
    await actor(2); await rpc('respond_family_invitation',[id,false])
    expect((await db.query('select * from get_my_family_invitations()')).rows[0].status).toBe('declined')
    const nextCode=await rpc('create_family_join_code')
    await actor(1); const next=await rpc('invite_family_member',[group,nextCode,'parent'])
    await actor(0,'service_role'); await db.query("update family_invitations set created_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' where id=$1",[next])
    await actor(2); expect((await db.query('select * from get_my_family_invitations()')).rows.find(row=>row.id===next).status).toBe('expired')
    await expect(rpc('respond_family_invitation',[next,true])).rejects.toMatchObject({code:'42501'})
  })
  it('cancels pending invitations and prevents non-owner invitation or member removal',async()=>{
    const {group}=await family()
    await actor(3); const code=await rpc('create_family_join_code')
    await actor(1); const invite=await rpc('invite_family_member',[group,code,'other'])
    await rpc('cancel_family_invitation',[invite])
    await actor(3)
    await db.exec('savepoint denied'); await expect(rpc('respond_family_invitation',[invite,true])).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to savepoint denied')
    const another=await rpc('create_family_join_code')
    await actor(2)
    await expect(rpc('invite_family_member',[group,another,'other'])).rejects.toMatchObject({code:'42501'})
  })
  it('stores only code digests and rejects consumed, superseded and expired codes',async()=>{
    await actor(1); const group=await rpc('create_family_group',['Mine'])
    await actor(2); const old=await rpc('create_family_join_code'); const current=await rpc('create_family_join_code')
    await db.exec('savepoint denied'); await expect(db.query('select * from family_join_codes')).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to savepoint denied')
    await actor(0,'service_role')
    const stored=(await db.query('select code_hash from family_join_codes')).rows
    expect(stored.every(row=>/^[a-f0-9]{64}$/.test(row.code_hash) && row.code_hash!==old && row.code_hash!==current)).toBe(true)
    await db.query("update family_join_codes set created_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where consumed_at is null")
    await actor(1)
    await db.exec('savepoint denied'); await expect(rpc('invite_family_member',[group,old,'other'])).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to savepoint denied')
    await expect(rpc('invite_family_member',[group,current,'other'])).rejects.toMatchObject({code:'42501'})
  })
  it('audits scope changes and preserves membership-independent legacy delegation on removal',async()=>{
    const {member}=await family(); await actor(1)
    const id=await grant(member,{records:true,medications:true})
    await grant(member,{alerts:true})
    await rpc('remove_family_member',[member])
    expect(await rpc('can_access_patient',[patients[2],'view'])).toBe(true)
    await actor(0,'service_role')
    expect((await db.query("select action from audit_logs where entity_table='family_authorizations' and entity_id=$1 order by action",[id])).rows.map(row=>row.action)).toEqual(['insert','update','update'])
    expect((await db.query("select status from consents where patient_id=$1 and consent_type='family_access'",[patients[0]])).rows).toEqual([{status:'withdrawn'},{status:'withdrawn'}])
  })
  it('rejects cross-patient consent references even for trusted writers',async()=>{
    const {member}=await family(); await actor(1); const id=await grant(member)
    await actor(0,'service_role')
    const consent=(await db.query('select id from consents where patient_id=$1 limit 1',[patients[1]])).rows[0].id
    await expect(db.query('update family_authorizations set consent_id=$1 where id=$2',[consent,id])).rejects.toMatchObject({code:'23503'})
  })
  it('preserves legacy delegated and patient-own access',async()=>{
    await actor(1)
    expect(await rpc('can_access_patient',[patients[0],'view'])).toBe(true)
    expect(await rpc('can_access_patient',[patients[2],'view'])).toBe(true)
  })
  it('preserves verified related provider access and rejects suspended providers',async()=>{
    await actor(5); expect(await rpc('can_access_patient',[patients[0],'clinical'])).toBe(true)
    await actor(0,'service_role'); await db.query("update profiles set status='suspended' where id=$1",[uid(5)])
    await actor(5); expect(await rpc('can_access_patient',[patients[0],'clinical'])).toBe(false)
  })
  it('keeps anonymous RPC execution denied and no-login/minor accounts unsupported',async()=>{
    await actor(0,'anon')
    await db.exec('savepoint denied'); await expect(rpc('create_family_group',['Anonymous'])).rejects.toMatchObject({code:'42501'}); await db.exec('rollback to savepoint denied')
    await actor(4); await expect(rpc('create_family_join_code')).rejects.toMatchObject({code:'42501'})
  })
  it('requires explicit boolean scopes and bounded future expiry',async()=>{
    const {member}=await family(); await actor(1)
    await db.exec('savepoint denied'); await expect(grant(member,{unknown:true})).rejects.toMatchObject({code:'22023'}); await db.exec('rollback to savepoint denied')
    await expect(grant(member,{},-1)).rejects.toMatchObject({code:'22023'})
  })
  it('requires explicit care_plans scope, grants read-only access and fails closed for unknown permissions',async()=>{
    const {member}=await family()
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Recovery plan',null,'Follow clinician instructions','Asia/Yangon',null,null])
    await actor(1)
    expect((await rpc('get_care_plan_detail',[plan])).plan.id).toBe(plan)
    await actor(2)
    expect(await rpc('get_care_plan_detail',[plan])).toBeNull()
    await actor(1)
    const owner=(await db.query('select * from get_family_members((select family_group_id from family_group_members where id=$1))',[member])).rows.find(row=>row.is_self===false)
    await grant(owner.id,{records:true})
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'care_plans'])).toBe(false)
    expect(await rpc('can_access_patient',[patients[0],'made_up_scope'])).toBe(false)
    await actor(1)
    const viewer=(await db.query('select * from get_family_members((select family_group_id from family_group_members where id=$1))',[member])).rows.find(row=>row.is_self)
    await grant(member,{care_plans:true})
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'care_plans'])).toBe(true)
    expect((await rpc('get_care_plan_detail',[plan])).plan.id).toBe(plan)
    await db.exec('savepoint denied_care_plan_write')
    await expect(db.query("update care_plans set status='active' where id=$1",[plan])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied_care_plan_write')
    await actor(1)
    const grantId=(await db.query('select id from family_authorizations where patient_id=$1 and family_profile_id=$2',[patients[0],uid(2)])).rows[0].id
    await rpc('revoke_family_authorization',[grantId])
    await actor(2)
    expect(await rpc('get_care_plan_detail',[plan])).toBeNull()
  })
  it.each(['expired','revoked','removed','withdrawn','legacy'])('denies family Care Plan access when authorization is %s or missing',async state=>{
    const {member}=await family()
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Family access fixture',null,null,'Asia/Yangon',null,null])
    await actor(1)
    const authorization=await grant(member,state==='legacy'?{records:true}:{care_plans:true})
    if(state==='expired') {
      await actor(0,'service_role')
      await db.query("update family_authorizations set authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 second' where id=$1",[authorization])
    }
    if(state==='revoked') await rpc('revoke_family_authorization',[authorization])
    if(state==='removed') await rpc('remove_family_member',[member])
    if(state==='withdrawn') {
      await actor(0,'service_role')
      await db.query("update consents set status='withdrawn',withdrawn_at=statement_timestamp() where id=(select consent_id from family_authorizations where id=$1)",[authorization])
    }
    await actor(2)
    expect(await rpc('get_care_plan_detail',[plan])).toBeNull()
  })
  it('enforces provider-authored lifecycle, immutable published versions and derived no-task progress',async()=>{
    await actor(1)
    await db.exec('savepoint patient_cannot_create_plan')
    await expect(rpc('create_care_plan_draft',[patients[0],null,'Forbidden',null,null,'Asia/Yangon',null,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint patient_cannot_create_plan')
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Recovery plan',null,'Follow clinician instructions','Asia/Yangon',null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'activate',null])
    expect((await rpc('get_care_plan_progress',[plan,null])).today.state).toBe('no_tasks_due')
    await db.exec('savepoint terminal_reopen')
    await rpc('transition_care_plan',[plan,'complete',null])
    await db.exec('savepoint attempt_reopen')
    await expect(rpc('transition_care_plan',[plan,'resume',null])).rejects.toMatchObject({code:'22023'})
    await db.exec('rollback to savepoint attempt_reopen')
    await db.exec('rollback to savepoint terminal_reopen')
  })
  it('fails provider authoring closed for inactive, suspended, unverified, unrelated and non-doctor clinicians',async()=>{
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Provider matrix',null,null,'Asia/Yangon',null,null])
    for (const status of ['suspended','inactive']) {
      await actor(0,'service_role')
      await db.query('update profiles set status=$1 where id=$2',[status,uid(5)])
      await actor(5)
      await db.exec(`savepoint denied_${status}`)
      await expect(rpc('transition_care_plan',[plan,'activate',null])).rejects.toMatchObject({code:'42501'})
      await db.exec(`rollback to savepoint denied_${status}`)
    }
    await actor(0,'service_role')
    await db.query("update profiles set status='active' where id=$1",[uid(5)])
    await db.query("update providers set verification_status='pending' where profile_id=$1",[uid(5)])
    await actor(5)
    await db.exec('savepoint denied_unverified')
    await expect(rpc('transition_care_plan',[plan,'activate',null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied_unverified')

    await actor(0,'service_role')
    await db.query("update providers set verification_status='verified' where profile_id=$1",[uid(5)])
    await db.exec('reset role')
    for (const n of [6,7]) await db.query('insert into auth.users(id) values($1)',[uid(n)])
    await db.exec('set local role service_role')
    await db.query("insert into profiles(id,role,full_name) values($1,'doctor','Unrelated clinician'),($2,'nurse','Related nurse')",[uid(6),uid(7)])
    const unrelated=(await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values($1,'doctor','verified',25000) returning id",[uid(6)])).rows[0].id
    const nurse=(await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values($1,'nurse','verified',25000) returning id",[uid(7)])).rows[0].id
    const request=(await db.query("insert into care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms) values($1,$2,'nurse_home_visit','clinical authorization fixture') returning id",[patients[0],uid(1)])).rows[0].id
    await db.query("insert into care_assignments(care_request_id,provider_id,assigned_by_profile_id,status,assigned_at) values($1,$2,$3,'assigned',statement_timestamp())",[request,nurse,uid(1)])
    await actor(6)
    await db.exec('savepoint unrelated_provider')
    await expect(rpc('create_care_plan_draft',[patients[0],null,'Unrelated',null,null,'Asia/Yangon',null,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint unrelated_provider')
    await actor(7)
    expect((await db.query('select public.can_access_patient($1,$2) as allowed',[patients[0],'clinical'])).rows[0].allowed).toBe(true)
    await db.exec('savepoint nurse_authority')
    await expect(rpc('create_care_plan_draft',[patients[0],null,'Nurse authored',null,null,'Asia/Yangon',null,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint nurse_authority')
    expect(unrelated).toBeTruthy()
  })
  it('reconciles a taken medication event to one exact compatible occurrence idempotently',async()=>{
    const scheduledLocal=(await db.query("select x::date as d,to_char(x,'HH24:MI') as t from (select (statement_timestamp() at time zone 'Asia/Yangon')-interval '10 minutes' as x) local_time")).rows[0]
    const { d: day, t: time } = scheduledLocal
    await actor(0,'service_role')
    const medication=(await db.query("insert into patient_medications(patient_id,medication_name,status,created_by_profile_id) values($1,'Reconciliation medicine','active',$2) returning id",[patients[0],uid(5)])).rows[0].id
    const schedule=(await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone) values($1,'09:00','Asia/Yangon') returning id",[medication])).rows[0].id
    const first=await planTask({type:'medication',title:'Dose one',day,time,medicationId:medication,scheduleId:schedule})
    const second=await planTask({type:'medication',title:'Dose two',day,time,medicationId:medication,scheduleId:schedule})
    await actor(0,'service_role')
    const due=(await db.query('select scheduled_at from care_plan_task_occurrences where task_id=$1',[first.task])).rows[0].scheduled_at
    const eventIds=[]
    for (const status of ['pending','missed','skipped','unknown']) eventIds.push((await db.query('insert into medication_events(schedule_id,patient_id,scheduled_at,status,confirmed_by_profile_id) values($1,$2,$3,$4,$5) returning id',[schedule,patients[0],due,status,uid(1)])).rows[0].id)
    eventIds.push((await db.query("insert into medication_events(schedule_id,patient_id,scheduled_at,status,confirmed_by_profile_id) values($1,$2,$3,'pending',$4) returning id",[schedule,patients[0],due,uid(1)])).rows[0].id)
    await db.query("update medication_events set status='taken' where id=$1",[eventIds.at(-1)])
    const wrongMedication=(await db.query("insert into patient_medications(patient_id,medication_name,status,created_by_profile_id) values($1,'Different medicine','active',$2) returning id",[patients[0],uid(5)])).rows[0].id
    const wrongSchedule=(await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone) values($1,'09:00','Asia/Yangon') returning id",[wrongMedication])).rows[0].id
    const wrongEvent=(await db.query("insert into medication_events(schedule_id,patient_id,scheduled_at,status) values($1,$2,$3,'taken') returning id",[wrongSchedule,patients[0],due])).rows[0].id
    const otherPatientMedication=(await db.query("insert into patient_medications(patient_id,medication_name,status,created_by_profile_id) values($1,'Other patient medicine','active',$2) returning id",[patients[1],uid(5)])).rows[0].id
    const otherPatientSchedule=(await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone) values($1,'09:00','Asia/Yangon') returning id",[otherPatientMedication])).rows[0].id
    const crossPatientEvent=(await db.query("insert into medication_events(schedule_id,patient_id,scheduled_at,status) values($1,$2,$3,'taken') returning id",[otherPatientSchedule,patients[1],due])).rows[0].id
    await actor(1)
    expect(await rpc('reconcile_care_plan_occurrences',[first.plan])).toBe(0)
    expect(await rpc('reconcile_care_plan_occurrences',[first.plan])).toBe(0)
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where medication_event_id=$1',[eventIds.at(-1)])).rows[0].n).toBe(1)
    expect((await db.query('select task_id,medication_event_id,status from care_plan_task_occurrences where task_id in ($1,$2) order by task_id',[first.task,second.task])).rows.filter(row=>row.medication_event_id!==null)).toHaveLength(1)
    expect((await db.query('select count(*)::int as count from care_plan_events where plan_id in ($1,$2) and event_type=\'occurrence_completed\'',[first.plan,second.plan])).rows[0].count).toBe(1)
    const winningPlan=(await db.query('select plan_id from care_plan_task_occurrences where medication_event_id=$1',[eventIds.at(-1)])).rows[0].plan_id
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where medication_event_id=$1',[wrongEvent])).rows[0].n).toBe(0)
    const completedOccurrence=(await db.query('select id from care_plan_task_occurrences where medication_event_id=$1',[eventIds.at(-1)])).rows[0].id
    await db.exec('savepoint cross_patient_medication_event')
    await expect(db.query('update care_plan_task_occurrences set medication_event_id=$1 where id=$2',[crossPatientEvent,completedOccurrence])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_medication_event')
    expect((await db.query('select status from medication_events where id=$1',[eventIds.at(-1)])).rows[0].status).toBe('taken')
    await actor(1)
    expect((await rpc('get_care_plan_progress',[winningPlan,null])).plan_to_date.completed).toBe(1)
    await actor(0,'service_role')
    await db.query("update medication_events set status='skipped' where id=$1",[eventIds.at(-1)])
    await actor(1)
    expect((await rpc('get_care_plan_progress',[winningPlan,null])).plan_to_date.completed).toBe(0)
    expect(await rpc('reconcile_care_plan_occurrences',[winningPlan])).toBe(0)
    await actor(0,'service_role')
    expect((await db.query('select medication_event_id,status from care_plan_task_occurrences where medication_event_id=$1',[eventIds.at(-1)])).rows[0]).toEqual({medication_event_id:eventIds.at(-1),status:'completed'})
    const currentVersion=(await db.query('select current_version_id from care_plans where id=$1',[first.plan])).rows[0].current_version_id
    await db.exec('savepoint cross_patient_task')
    await expect(db.query("insert into care_plan_tasks(plan_id,version_id,patient_id,task_type,title,starts_on) values($1,$2,$3,'custom','forged task',current_date)",[first.plan,currentVersion,patients[1]])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_task')
    const occurrenceTask=(await db.query('select id from care_plan_tasks where id=$1',[first.task])).rows[0].id
    await db.exec('savepoint cross_patient_occurrence')
    await expect(db.query("insert into care_plan_task_occurrences(task_id,plan_id,version_id,patient_id,occurrence_key,scheduled_at,local_due_date,local_due_time,timezone,required) values($1,$2,$3,$4,'cross-patient',statement_timestamp(),current_date,'09:00','Asia/Yangon',true)",[occurrenceTask,first.plan,currentVersion,patients[1]])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_occurrence')
    await actor(5)
    await rpc('create_care_plan_version',[first.plan,'Integrity check',null,null,'Source reference checks',null])
    await db.exec('savepoint cross_patient_schedule')
    await expect(rpc('add_care_plan_task',[first.plan,'medication','wrong schedule',null,true,false,'one_time',day,null,null,['09:00'],'Asia/Yangon',null,medication,otherPatientSchedule,null,null,null])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_schedule')
    await db.exec('savepoint cross_patient_medication')
    await expect(rpc('add_care_plan_task',[first.plan,'medication','wrong patient medicine',null,true,false,'one_time',day,null,null,['09:00'],'Asia/Yangon',null,otherPatientMedication,otherPatientSchedule,null,null,null])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_medication')
    await actor(0,'service_role')
    await db.exec('savepoint event_append_only')
    await expect(db.query("update care_plan_events set reason='rewritten' where plan_id=$1 and source_id=$2",[winningPlan,eventIds.at(-1)])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint event_append_only')
    const {member}=await family()
    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    const restrictedDetail=await rpc('get_care_plan_detail',[winningPlan])
    const restrictedOccurrences=await rpc('get_care_plan_occurrences',[winningPlan])
    const restrictedEvents=await rpc('get_care_plan_events',[winningPlan])
    expect(restrictedDetail.tasks[0].medication).toBeNull()
    expect(JSON.stringify([restrictedDetail,restrictedOccurrences,restrictedEvents])).not.toContain(eventIds.at(-1))
    expect(JSON.stringify([restrictedDetail,restrictedOccurrences,restrictedEvents])).not.toContain(medication)
    await db.exec('savepoint hidden_occurrence_columns')
    await expect(db.query('select medication_event_id from care_plan_task_occurrences')).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint hidden_occurrence_columns')
    await db.exec('savepoint hidden_event_columns')
    await expect(db.query('select source_id from care_plan_events')).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint hidden_event_columns')
    await db.exec('savepoint family_cannot_complete_other_adult')
    await expect(rpc('acknowledge_care_plan_occurrence',[restrictedOccurrences[0].id,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint family_cannot_complete_other_adult')
    await actor(1); await grant(member,{care_plans:true,medications:true})
    await actor(2)
    const authorizedOccurrences=await rpc('get_care_plan_occurrences',[winningPlan])
    expect(authorizedOccurrences.some(item=>item.source?.id===eventIds.at(-1))).toBe(true)
    await db.exec('savepoint denied_family_task_write')
    await expect(db.query("update care_plan_tasks set title='family edit' where id=$1",[first.task])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied_family_task_write')
  })
  it('assigns an overlapping vital reading once to the nearest typed occurrence and keeps family source details masked',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    const early=await planTask({type:'vital_check',title:'Early blood pressure',day,time:'08:00',vitalType:'blood_pressure',grace:120})
    const late=await planTask({type:'vital_check',title:'Late blood pressure',day,time:'10:00',vitalType:'blood_pressure',grace:120})
    await actor(0,'service_role')
    const due=(await db.query('select scheduled_at from care_plan_task_occurrences where task_id=$1',[late.task])).rows[0].scheduled_at
    const readingAt=await db.query("select $1::timestamptz - interval '20 minutes' as t",[due])
    const reading=(await db.query("insert into vital_readings(patient_id,source,systolic_bp,diastolic_bp,recorded_at,recorded_by_profile_id) values($1,'manual',120,80,$2,$3) returning id",[patients[0],readingAt.rows[0].t,uid(1)])).rows[0].id
    await db.query("insert into vital_readings(patient_id,source,heart_rate,recorded_at,recorded_by_profile_id) values($1,'manual',72,$2,$3)",[patients[0],readingAt.rows[0].t,uid(1)])
    await db.query("insert into vital_readings(patient_id,source,systolic_bp,diastolic_bp,recorded_at,recorded_by_profile_id) values($1,'manual',118,78,$2::timestamptz-interval '5 hours',$3)",[patients[0],readingAt.rows[0].t,uid(1)])
    await actor(1)
    expect(await rpc('reconcile_care_plan_occurrences',[late.plan])).toBe(0)
    expect(await rpc('reconcile_care_plan_occurrences',[late.plan])).toBe(0)
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where vital_reading_id=$1',[reading])).rows[0].n).toBe(1)
    await actor(1)
    const projection=await rpc('get_care_plan_occurrences',[late.plan])
    expect(projection.some(item=>item.source?.reading?.id===reading)).toBe(true)
    await actor(0,'service_role')
    const rows=(await db.query('select task_id,vital_reading_id,status from care_plan_task_occurrences where task_id in ($1,$2)',[early.task,late.task])).rows
    expect(rows.filter(row=>row.vital_reading_id===reading)).toHaveLength(1)
    expect(rows.find(row=>row.task_id===late.task).vital_reading_id).toBe(reading)
    expect(rows.find(row=>row.task_id===early.task).status).toBe('pending')
    const foreignReading=(await db.query('select id from vital_readings where patient_id=$1 limit 1',[patients[1]])).rows[0].id
    const linkedOccurrence=(await db.query('select id from care_plan_task_occurrences where vital_reading_id=$1',[reading])).rows[0].id
    await db.exec('savepoint cross_patient_vital')
    await expect(db.query('update care_plan_task_occurrences set vital_reading_id=$1 where id=$2',[foreignReading,linkedOccurrence])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_vital')
    const {member}=await family()
    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    const familyProjection=await rpc('get_care_plan_occurrences',[late.plan])
    expect(familyProjection.every(item=>item.source===null)).toBe(true)
    expect(JSON.stringify(familyProjection)).not.toContain(reading)
    await actor(1); await grant(member,{care_plans:true,records:true})
    await actor(2)
    expect((await rpc('get_care_plan_occurrences',[late.plan])).some(item=>item.source?.reading?.id===reading && item.source.reading.systolic_bp===120)).toBe(true)
  })
  it('reconciles only the exact completed appointment and ignores every non-completed status',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date+1 as d")).rows[0].d
    await actor(0,'service_role')
    const provider=(await db.query('select id from providers where profile_id=$1',[uid(5)])).rows[0].id
    const cases=[]
    for (const [index,status] of ['pending','confirmed','cancelled','no_show','rescheduled','completed'].entries()) {
      const time=`${String(8+index).padStart(2,'0')}:00`
      const due=(await db.query("select ($1::date+$2::time) at time zone 'Asia/Yangon' as due",[day,time])).rows[0].due
      const end=(await db.query("select $1::timestamptz+interval '30 minutes' as due",[due])).rows[0].due
      const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation',$2,$3) returning id",[provider,due,end])).rows[0].id
      const initialStatus=status==='completed'?'confirmed':status
      const appointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,status,cancelled_at) values($1,$2,$3,'teleconsultation',$4,$5,'video',$6,$7::public.appointment_status,case when $7::public.appointment_status='cancelled' then statement_timestamp() else null end) returning id",[patients[0],provider,slot,due,end,`RECON-${index}`,initialStatus])).rows[0].id
      cases.push({status,appointment,time})
    }
    const foreignDue=(await db.query("select ($1::date+time '16:00') at time zone 'Asia/Yangon' as due",[day])).rows[0].due
    const foreignEnd=(await db.query("select $1::timestamptz+interval '30 minutes' as due",[foreignDue])).rows[0].due
    const foreignSlot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation',$2,$3) returning id",[provider,foreignDue,foreignEnd])).rows[0].id
    const foreignAppointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,status) values($1,$2,$3,'teleconsultation',$4,$5,'video','RECON-FOREIGN','completed') returning id",[patients[1],provider,foreignSlot,foreignDue,foreignEnd])).rows[0].id
    const tasks=[]
    for (const item of cases) tasks.push({ ...item, ...await planTask({type:'appointment',title:`Appointment ${item.status}`,day,time:item.time,appointmentId:item.appointment}) })
    await actor(0,'service_role')
    await db.query("update appointments set status='completed' where id=$1",[cases.find(item=>item.status==='completed').appointment])
    await actor(1)
    expect(await rpc('reconcile_care_plan_occurrences',[tasks[0].plan])).toBe(0)
    expect(await rpc('reconcile_care_plan_occurrences',[tasks[0].plan])).toBe(0)
    await actor(0,'service_role')
    const rows=[]
    for (const item of tasks) rows.push((await db.query('select appointment_id,status from care_plan_task_occurrences where task_id=$1',[item.task])).rows[0])
    expect(rows.filter(row=>row.appointment_id!==null)).toHaveLength(1)
    expect(rows.filter(row=>row.status==='completed')).toHaveLength(1)
    const completedTask=tasks.find(item=>item.status==='completed')
    expect((await db.query('select appointment_id from care_plan_task_occurrences where task_id=$1',[completedTask.task])).rows[0].appointment_id).toBe(completedTask.appointment)
    const completedOccurrence=(await db.query('select id from care_plan_task_occurrences where task_id=$1',[completedTask.task])).rows[0].id
    await db.exec('savepoint cross_patient_appointment')
    await expect(db.query('update care_plan_task_occurrences set appointment_id=$1 where id=$2',[foreignAppointment,completedOccurrence])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_appointment')
    await actor(5)
    await rpc('create_care_plan_version',[completedTask.plan,'Appointment integrity check',null,null,'Source reference check',null])
    await db.exec('savepoint cross_patient_appointment_task')
    await expect(rpc('add_care_plan_task',[completedTask.plan,'appointment','Wrong patient appointment',null,true,false,'one_time',day,null,null,['16:00'],'Asia/Yangon',null,null,null,foreignAppointment,null,null])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_appointment_task')
    const {member}=await family()
    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    const restricted=await rpc('get_care_plan_detail',[completedTask.plan])
    const restrictedOccurrences=await rpc('get_care_plan_occurrences',[completedTask.plan])
    expect(restricted.tasks[0].appointment).toBeNull()
    expect(restrictedOccurrences.every(item=>item.source===null)).toBe(true)
    expect(JSON.stringify([restricted,restrictedOccurrences])).not.toContain(completedTask.appointment)
    await actor(1); await grant(member,{care_plans:true,appointments:true})
    await actor(2)
    expect((await rpc('get_care_plan_detail',[completedTask.plan])).tasks[0].appointment.id).toBe(completedTask.appointment)
  })
  it('reconciles only completed same-patient follow-ups through the existing follow-up lifecycle',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date+1 as d")).rows[0].d
    await actor(0,'service_role')
    const provider=(await db.query('select id from providers where profile_id=$1',[uid(5)])).rows[0].id
    const due=(await db.query("select ($1::date+time '11:00') at time zone 'Asia/Yangon' as due",[day])).rows[0].due
    const end=(await db.query("select $1::timestamptz+interval '30 minutes' as due",[due])).rows[0].due
    const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation',$2,$3) returning id",[provider,due,end])).rows[0].id
    const appointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,status) values($1,$2,$3,'teleconsultation',$4,$5,'video','FOLLOWUP-BASE','completed') returning id",[patients[0],provider,slot,due,end])).rows[0].id
    const encounter=(await db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values($1,$2,$3,'teleconsultation') returning id",[appointment,patients[0],provider])).rows[0].id
    const completed=(await db.query("insert into follow_ups(encounter_id,patient_id,assigned_to_profile_id,follow_up_type,due_at,status) values($1,$2,$3,'call',$4,'pending') returning id",[encounter,patients[0],uid(5),due])).rows[0].id
    const pendingDue=(await db.query("select $1::timestamptz+interval '1 hour' as due",[due])).rows[0].due
    const pending=(await db.query("insert into follow_ups(encounter_id,patient_id,assigned_to_profile_id,follow_up_type,due_at,status) values($1,$2,$3,'monitoring',$4,'pending') returning id",[encounter,patients[0],uid(5),pendingDue])).rows[0].id
    const foreignDue=(await db.query("select ($1::date+time '15:00') at time zone 'Asia/Yangon' as due",[day])).rows[0].due
    const foreignEnd=(await db.query("select $1::timestamptz+interval '30 minutes' as due",[foreignDue])).rows[0].due
    const foreignSlot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation',$2,$3) returning id",[provider,foreignDue,foreignEnd])).rows[0].id
    const foreignAppointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,status) values($1,$2,$3,'teleconsultation',$4,$5,'video','FOLLOWUP-FOREIGN','completed') returning id",[patients[1],provider,foreignSlot,foreignDue,foreignEnd])).rows[0].id
    const foreignEncounter=(await db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values($1,$2,$3,'teleconsultation') returning id",[foreignAppointment,patients[1],provider])).rows[0].id
    const foreignFollowUp=(await db.query("insert into follow_ups(encounter_id,patient_id,assigned_to_profile_id,follow_up_type,due_at,status,completed_at) values($1,$2,$3,'call',$4,'completed',statement_timestamp()) returning id",[foreignEncounter,patients[1],uid(5),foreignDue])).rows[0].id
    const completedTask=await planTask({type:'follow_up',title:'Completed follow-up',day,time:'11:00',followUpId:completed})
    const pendingTask=await planTask({type:'follow_up',title:'Pending follow-up',day,time:'12:00',followUpId:pending})
    await actor(0,'service_role')
    await db.query("update follow_ups set status='completed',completed_at=statement_timestamp() where id=$1",[completed])
    await actor(1)
    expect(await rpc('reconcile_care_plan_occurrences',[completedTask.plan])).toBe(0)
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where follow_up_id=$1',[completed])).rows[0].n).toBe(1)
    expect((await db.query('select follow_up_id,status from care_plan_task_occurrences where task_id in ($1,$2) order by task_id',[completedTask.task,pendingTask.task])).rows.filter(row=>row.follow_up_id!==null)).toHaveLength(1)
    expect((await db.query('select follow_up_id from care_plan_task_occurrences where task_id=$1',[pendingTask.task])).rows[0].follow_up_id).toBeNull()
    const linked=(await db.query('select id from care_plan_task_occurrences where follow_up_id=$1',[completed])).rows[0].id
    await db.exec('savepoint cross_patient_followup')
    await expect(db.query('update care_plan_task_occurrences set follow_up_id=$1 where id=$2',[foreignFollowUp,linked])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_followup')
    await actor(5)
    await db.exec('savepoint cross_patient_encounter')
    await expect(rpc('create_care_plan_draft',[patients[0],foreignEncounter,'Wrong encounter',null,null,'Asia/Yangon',null,null])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint cross_patient_encounter')
    await actor(2)
    await db.exec('savepoint family_reconcile_denied')
    await expect(rpc('reconcile_care_plan_occurrences',[completedTask.plan])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint family_reconcile_denied')
  })
  it('generates supported recurrence idempotently within a timezone-aware 30-day horizon and preserves old-version history',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    const weekday=(await db.query("select extract(dow from $1::date)::smallint as dow",[day])).rows[0].dow
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Recurrence plan',null,null,'Asia/Yangon',null,null])
    const makeTask=(title,recurrence,days,times)=>rpc('add_care_plan_task',[plan,'activity',title,null,true,false,recurrence,day,null,days,times,'Asia/Yangon',null,null,null,null,null,null])
    const once=await makeTask('Once','one_time',null,['08:00'])
    const daily=await makeTask('Daily','daily',null,['09:00'])
    const weekly=await makeTask('Selected weekdays','selected_weekdays',[weekday],['10:00'])
    const slots=await makeTask('Multiple slots','multiple_daily_slots',null,['08:00','20:00'])
    await actor(0,'service_role')
    const medication=(await db.query("insert into patient_medications(patient_id,medication_name,status,created_by_profile_id) values($1,'Scheduled recurrence medicine','active',$2) returning id",[patients[0],uid(5)])).rows[0].id
    const schedules=[]
    for(const time of ['07:00','19:00']) schedules.push((await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone,valid_from) values($1,$2,'Asia/Yangon',$3) returning id",[medication,time,day])).rows[0].id)
    await actor(5)
    const scheduledTask=await rpc('add_care_plan_task',[plan,'medication','Scheduled doses',null,true,false,'source_schedule',day,null,null,['09:00'],'Asia/Yangon',null,medication,schedules[0],null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'activate',null])
    const beyond=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date+80 as d")).rows[0].d
    expect(await rpc('extend_care_plan_occurrences',[plan,beyond])).toBe(0)
    expect(await rpc('extend_care_plan_occurrences',[plan,beyond])).toBe(0)
    await actor(0,'service_role')
    const rows=(await db.query('select task_id,local_due_date,local_due_time,timezone,scheduled_at from care_plan_task_occurrences where plan_id=$1',[plan])).rows
    expect(rows.filter(row=>row.task_id===once)).toHaveLength(1)
    expect(rows.filter(row=>row.task_id===daily)).toHaveLength(31)
    expect(rows.filter(row=>row.task_id===slots)).toHaveLength(62)
    const scheduledRows=rows.filter(row=>row.task_id===scheduledTask)
    expect(scheduledRows).toHaveLength(31)
    expect(new Set(scheduledRows.map(row=>row.local_due_time))).toEqual(new Set(['07:00:00']))
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1 and extract(dow from local_due_date)::smallint<>$2',[weekly,weekday])).rows[0].n).toBe(0)
    expect((await db.query("select count(*)::int as n from care_plan_task_occurrences where plan_id=$1 and (timezone<>'Asia/Yangon' or local_due_date>$2::date+30)",[plan,day])).rows[0].n).toBe(0)
    expect((await db.query("select count(*)::int as n from care_plan_task_occurrences where plan_id=$1 and scheduled_at<>((local_due_date+local_due_time) at time zone timezone)",[plan])).rows[0].n).toBe(0)
    const historicCount=rows.length
    await actor(5)
    const nextDay=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date+1 as d")).rows[0].d
    await rpc('create_care_plan_version',[plan,'Revised plan',null,null,'Additional instructions',null])
    await rpc('add_care_plan_task',[plan,'instruction','New version action',null,true,false,'one_time',nextDay,null,null,['11:00'],'Asia/Yangon',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('extend_care_plan_occurrences',[plan,nextDay])
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where plan_id=$1',[plan])).rows[0].n).toBe(historicCount+1)
  })
  it('keeps maintenance server-only, batches active plans, and respects task and plan end bounds',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Bounded maintenance plan',null,null,'Asia/Yangon',null,null])
    const task=await rpc('add_care_plan_task',[plan,'activity','Bounded daily action',null,true,false,'daily',day,null,null,['08:00'],'Asia/Yangon',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await actor(0,'service_role')
    await db.query("update care_plans set target_end_at=(($1::date+time '23:59') at time zone 'Asia/Yangon') where id=$2",[day,plan])
    await actor(5)
    await rpc('transition_care_plan',[plan,'activate',null])
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1',[task])).rows[0].n).toBe(1)
    const result=await rpc('maintain_care_plan_occurrence_horizons',[null,100])
    expect(result.processed).toBeGreaterThan(0)
    expect(result.generated).toBe(0)
    expect(result.failures).toEqual([])
    expect((await db.query("select count(*)::int as n from care_plan_task_occurrences where task_id=$1 and scheduled_at>(select target_end_at from care_plans where id=$2)",[task,plan])).rows[0].n).toBe(0)
    expect(await rpc('maintain_care_plan_occurrence_horizons',['ffffffff-ffff-ffff-ffff-ffffffffffff',1])).toMatchObject({processed:0,generated:0,failures:[]})
    await actor(2)
    await db.exec('savepoint maintenance_browser_denied')
    await expect(rpc('maintain_care_plan_occurrence_horizons',[null,1])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to maintenance_browser_denied')
  })
  it('isolates one broken plan and returns a stable batch cursor',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    await actor(5)
    const makeActive=async title=>{
      const plan=await rpc('create_care_plan_draft',[patients[0],null,title,null,null,'Asia/Yangon',null,null])
      const task=await rpc('add_care_plan_task',[plan,'activity',title,null,true,false,'daily',day,null,null,['09:00'],'Asia/Yangon',null,null,null,null,null,null])
      await rpc('approve_care_plan_version',[plan,null])
      await rpc('transition_care_plan',[plan,'activate',null])
      return {plan,task}
    }
    const broken=await makeActive('Invalid timezone plan')
    const healthy=await makeActive('Healthy maintenance plan')
    await actor(0,'service_role')
    await db.query("update care_plans set timezone='Not/A_Real_Zone' where id=$1",[broken.plan])
    const result=await rpc('maintain_care_plan_occurrence_horizons',[null,50])
    expect(result.processed).toBe(2)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({plan_id:broken.plan,sqlstate:'22023'})
    expect(result.next_after_id).toBe([broken.plan,healthy.plan].sort().at(-1))
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1',[healthy.task])).rows[0].n).toBe(31)
  })
  it('pages exactly 51 active plans as 50 then 1 without skips or repeats',async()=>{
    await actor(0,'service_role')
    const provider=(await db.query('select id from providers where profile_id=$1',[uid(5)])).rows[0].id
    const plans=[]
    for(let index=1;index<=51;index++){
      const suffix=String(index).padStart(12,'0')
      const plan=`20000000-0000-4000-8000-${suffix}`
      const version=`30000000-0000-4000-8000-${suffix}`
      await db.query("insert into care_plans(id,patient_id,responsible_provider_id,created_by_profile_id,status,timezone) values($1,$2,$3,$4,'active','Asia/Yangon')",[plan,patients[0],provider,uid(5)])
      await db.query("insert into care_plan_versions(id,plan_id,patient_id,version_no,title,author_profile_id,author_provider_id,status,approved_by_profile_id,approved_at) values($1,$2,$3,1,'Paging fixture',$4,$5,'published',$4,statement_timestamp())",[version,plan,patients[0],uid(5),provider])
      await db.query('update care_plans set current_version_id=$1 where id=$2',[version,plan])
      plans.push(plan)
    }
    const first=await rpc('maintain_care_plan_occurrence_horizons',[null,50])
    expect(first).toMatchObject({processed:50,generated:0,failures:[],has_more:true,next_after_id:plans[49]})
    const second=await rpc('maintain_care_plan_occurrence_horizons',[first.next_after_id,50])
    expect(second).toMatchObject({processed:1,generated:0,failures:[],has_more:false,next_after_id:plans[50]})
    expect(new Set([...plans.slice(0,50),...plans.slice(50)]).size).toBe(51)
    expect([...plans].sort()).toEqual(plans)
  })
  it('serializes repeated extension requests without creating duplicate occurrence keys',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Repeated requests',null,null,'Asia/Yangon',null,null])
    const task=await rpc('add_care_plan_task',[plan,'activity','Daily check',null,true,false,'daily',day,null,null,['08:00'],'Asia/Yangon',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'activate',null])
    const results=await Promise.all(Array.from({length:10},()=>rpc('extend_care_plan_occurrences',[plan,null])))
    expect(results.every(count=>count===0)).toBe(true)
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n,count(distinct occurrence_key)::int as distinct_n from care_plan_task_occurrences where task_id=$1',[task])).rows[0]).toEqual({n:31,distinct_n:31})
  })
  it.runIf(new Date() >= new Date('2026-10-02T00:00:00Z') && new Date() <= new Date('2026-11-03T23:59:59Z'))('preserves 08:00 New York local intent across the November DST transition',async()=>{
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'DST recurrence',null,null,'Asia/Yangon',null,null])
    const task=await rpc('add_care_plan_task',[plan,'activity','Local morning task',null,true,false,'daily','2026-10-31',null,null,['08:00'],'America/New_York',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'activate',null])
    await actor(0,'service_role')
    const rows=(await db.query("select local_due_date,local_due_time,timezone,scheduled_at from care_plan_task_occurrences where task_id=$1 and local_due_date between '2026-10-31' and '2026-11-02' order by local_due_date",[task])).rows
    expect(rows.map(row=>row.local_due_time)).toEqual(['08:00:00','08:00:00','08:00:00'])
    expect(rows.map(row=>row.timezone)).toEqual(['America/New_York','America/New_York','America/New_York'])
    expect((await db.query("select extract(epoch from ($2::timestamptz-$1::timestamptz))::int/3600 as hours",[rows[0].scheduled_at,rows[1].scheduled_at])).rows[0].hours).toBe(25)
  })
  it('stops horizon generation while paused or terminal and resumes only the bounded current version',async()=>{
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    await actor(5)
    const plan=await rpc('create_care_plan_draft',[patients[0],null,'Lifecycle horizon plan',null,null,'Asia/Yangon',null,null])
    const oldTask=await rpc('add_care_plan_task',[plan,'activity','Daily action',null,true,false,'daily',day,null,null,['08:00'],'Asia/Yangon',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'activate',null])
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1',[oldTask])).rows[0].n).toBe(31)
    const historical=(await db.query("select id from care_plan_task_occurrences where task_id=$1 and local_due_date=$2::date order by id limit 1",[oldTask,day])).rows[0].id
    await actor(5)
    await rpc('transition_care_plan',[plan,'pause','temporary pause'])
    await actor(0,'service_role')
    await rpc('maintain_care_plan_occurrence_horizons',[null,50])
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1',[oldTask])).rows[0].n).toBe(31)
    await actor(5)
    const nextDay=(await db.query('select $1::date+1 as d',[day])).rows[0].d
    await rpc('create_care_plan_version',[plan,'Replacement',null,null,'Replace daily action',null])
    const replacementTask=await rpc('add_care_plan_task',[plan,'instruction','New version task',null,true,false,'one_time',nextDay,null,null,['11:00'],'Asia/Yangon',null,null,null,null,null,null])
    await rpc('approve_care_plan_version',[plan,null])
    await rpc('transition_care_plan',[plan,'resume',null])
    await actor(0,'service_role')
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where task_id=$1',[replacementTask])).rows[0].n).toBe(1)
    expect((await db.query('select status,completed_at from care_plan_task_occurrences where id=$1',[historical])).rows[0]).toEqual({status:'pending',completed_at:null})
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where plan_id=$1 and version_id<>(select current_version_id from care_plans where id=$1)',[plan])).rows[0].n).toBe(31)
    await actor(5)
    await rpc('transition_care_plan',[plan,'complete','care completed'])
    await actor(0,'service_role')
    const terminalCount=(await db.query('select count(*)::int as n from care_plan_task_occurrences where plan_id=$1',[plan])).rows[0].n
    await rpc('maintain_care_plan_occurrence_horizons',[null,50])
    expect((await db.query('select count(*)::int as n from care_plan_task_occurrences where plan_id=$1',[plan])).rows[0].n).toBe(terminalCount)
    expect((await db.query("select count(*)::int as n from care_plan_task_occurrences where id=$1 and status='completed'",[historical])).rows[0].n).toBe(0)
  })
  it('allows one patient acknowledgement for eligible manual tasks and emits only one event',async()=>{
    const due=(await db.query("select x::date as d,to_char(x,'HH24:MI') as t from (select (statement_timestamp() at time zone 'Asia/Yangon')-interval '10 minutes' as x) local_time")).rows[0]
    const {plan}=await planTask({type:'instruction',title:'Rest as instructed',day:due.d,time:due.t,manualAcknowledgement:true})
    await actor(0,'service_role')
    const occurrence=(await db.query('select id from care_plan_task_occurrences where plan_id=$1',[plan])).rows[0].id
    await actor(1)
    await rpc('acknowledge_care_plan_occurrence',[occurrence,'Completed as instructed'])
    await db.exec('savepoint duplicate_manual_ack')
    await expect(rpc('acknowledge_care_plan_occurrence',[occurrence,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint duplicate_manual_ack')
    expect((await rpc('get_care_plan_progress',[plan,null])).plan_to_date.completed).toBe(1)
    await actor(0,'service_role')
    expect((await db.query("select count(*)::int as n from care_plan_events where occurrence_id=$1 and event_type='occurrence_completed'",[occurrence])).rows[0].n).toBe(1)
  })
  it('requires explicit family care_plans permission and keeps the projection read-only',async()=>{
    const {group,member}=await family()
    const targetMember=(await db.query('select member_id from public.get_family_health_members($1) where not is_self',[group])).rows[0].member_id
    await actor(2)
    await db.exec('savepoint family_plan_membership_only')
    await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to family_plan_membership_only')
    await db.exec('savepoint family_plan_patient_uuid_rejected')
    await expect(rpc('get_family_care_plan_readout',[group,patients[0]])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to family_plan_patient_uuid_rejected')
    for (const scope of ['records','medications','appointments']) {
      await actor(1); await grant(member,{[scope]:true})
      await actor(2); await db.exec(`savepoint family_plan_${scope}_only`)
      await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
      await db.exec(`rollback to family_plan_${scope}_only`)
    }
    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    expect(await rpc('get_family_care_plan_readout',[group,targetMember])).toEqual([])

    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    const {plan,task}=await planTask({type:'instruction',title:'Family read-only task',day,time:'09:00',manualAcknowledgement:true})
    await actor(2)
    const readout=await rpc('get_family_care_plan_readout',[group,targetMember])
    expect(readout).toHaveLength(1)
    expect(readout[0].plan.status).toBe('active')
    expect(readout[0].tasks.find(row=>row.id===task).title).toBe('Family read-only task')
    const occurrence=readout[0].occurrences[0]
    await db.exec('savepoint family_plan_ack_denied')
    await expect(rpc('acknowledge_care_plan_occurrence',[occurrence.id,null])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to family_plan_ack_denied')
    for (const intent of ['pause','complete']) {
      await db.exec(`savepoint family_plan_${intent}_denied`)
      await expect(rpc('transition_care_plan',[plan,intent,null])).rejects.toMatchObject({code:'42501'})
      await db.exec(`rollback to family_plan_${intent}_denied`)
    }
    await db.exec('savepoint family_plan_reconcile_denied')
    await expect(rpc('reconcile_care_plan_occurrences',[plan])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to family_plan_reconcile_denied')
    for (const [table,statement] of [
      ['medication_events',"update medication_events set status='taken' where patient_id=$1"],
      ['vital_readings',"update vital_readings set heart_rate=81 where patient_id=$1"],
      ['appointments',"update appointments set status='cancelled',cancelled_at=statement_timestamp() where patient_id=$1"],
      ['follow_ups',"update follow_ups set status='cancelled',completed_at=null where patient_id=$1"],
    ]) {
      await db.exec(`savepoint family_source_${table}_denied`)
      try {
        const result=await db.query(statement,[patients[0]])
        expect(result.rowCount).toBe(0)
      } catch (failure) { expect(failure.code).toBe('42501') }
      await db.exec(`rollback to family_source_${table}_denied`)
    }

    await actor(0,'service_role')
    await db.query('update family_authorizations set authorized_at=statement_timestamp()-interval \'2 days\',expires_at=statement_timestamp()-interval \'1 day\' where patient_id=$1 and family_profile_id=$2',[patients[0],uid(2)])
    await actor(2); await db.exec('savepoint expired_family_plan_denied')
    await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to expired_family_plan_denied')

    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    expect((await rpc('get_family_care_plan_readout',[group,targetMember])).length).toBe(1)
    await actor(0,'service_role')
    const authorizationId=(await db.query('select id from family_authorizations where patient_id=$1 and family_profile_id=$2',[patients[0],uid(2)])).rows[0].id
    await actor(1); await rpc('revoke_family_authorization',[authorizationId])
    await actor(2); await db.exec('savepoint revoked_family_plan_denied')
    await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to revoked_family_plan_denied')

    await actor(1); await grant(member,{care_plans:true})
    await actor(0,'service_role')
    await db.query("update consents set status='withdrawn',withdrawn_at=statement_timestamp() where id=(select consent_id from family_authorizations where patient_id=$1 and family_profile_id=$2)",[patients[0],uid(2)])
    await actor(2); await db.exec('savepoint withdrawn_family_plan_denied')
    await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to withdrawn_family_plan_denied')

    await actor(1); await grant(member,{care_plans:true}); await rpc('remove_family_member',[member])
    await actor(2); await db.exec('savepoint removed_family_plan_denied')
    await expect(rpc('get_family_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to removed_family_plan_denied')
  })
  it('projects only the selected patient-owned Care Plan after active care_plans authorization',async()=>{
    const {group,member}=await family()
    const targetMember=(await db.query('select member_id from public.get_family_health_members($1) where not is_self',[group])).rows[0].member_id
    await actor(0,'service_role')
    await db.query("insert into patient_health_goals(patient_id,title) values($1,'Target goal'),($2,'Viewer private goal')",[patients[0],patients[1]])
    await actor(2); await db.exec('savepoint patient_owned_care_plan_membership_only')
    await expect(rpc('get_family_patient_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to patient_owned_care_plan_membership_only')
    await db.exec('savepoint patient_uuid_is_not_membership_id')
    await expect(rpc('get_family_patient_care_plan_readout',[group,patients[0]])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to patient_uuid_is_not_membership_id')
    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    const readout=await rpc('get_family_patient_care_plan_readout',[group,targetMember])
    expect(readout.health_goals.map(goal=>goal.title)).toEqual(['Target goal'])
    expect(readout.access).toEqual({medications:false,appointments:false,records:false})
    expect(readout.medications).toEqual([])
    await actor(3); const unrelatedGroup=await rpc('create_family_group',['Unrelated family'])
    await actor(2); await db.exec('savepoint unrelated_family_care_plan_denied')
    await expect(rpc('get_family_patient_care_plan_readout',[unrelatedGroup,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to unrelated_family_care_plan_denied')
    await actor(0,'service_role')
    await db.query("update family_authorizations set authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where patient_id=$1 and family_profile_id=$2",[patients[0],uid(2)])
    await actor(2); await db.exec('savepoint expired_patient_owned_care_plan_denied')
    await expect(rpc('get_family_patient_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to expired_patient_owned_care_plan_denied')
    await actor(1); await grant(member,{care_plans:true})
    await actor(0,'service_role')
    const authorizationId=(await db.query('select id from family_authorizations where patient_id=$1 and family_profile_id=$2',[patients[0],uid(2)])).rows[0].id
    await actor(1); await rpc('revoke_family_authorization',[authorizationId])
    await actor(2); await db.exec('savepoint revoked_patient_owned_care_plan_denied')
    await expect(rpc('get_family_patient_care_plan_readout',[group,targetMember])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to revoked_patient_owned_care_plan_denied')
  })
  it('returns only the linked source details allowed by independent family scopes',async()=>{
    const {group,member}=await family()
    await actor(0,'service_role')
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as d")).rows[0].d
    const provider=(await db.query('select id from providers where profile_id=$1',[uid(5)])).rows[0].id
    const medication=(await db.query("insert into patient_medications(patient_id,medication_name,dose,status,created_by_profile_id) values($1,'Maskable medicine','1 tablet','active',$2) returning id",[patients[0],uid(5)])).rows[0].id
    const schedule=(await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone) values($1,'08:00','Asia/Yangon') returning id",[medication])).rows[0].id
    const medicationPlan=await planTask({type:'medication',title:'Dose instruction',day,time:'08:00',medicationId:medication,scheduleId:schedule})
    await actor(0,'service_role')
    const medicationDue=(await db.query('select scheduled_at from care_plan_task_occurrences where task_id=$1',[medicationPlan.task])).rows[0].scheduled_at
    await db.query("insert into medication_events(schedule_id,patient_id,scheduled_at,status,confirmed_by_profile_id) values($1,$2,$3,'taken',$4)",[schedule,patients[0],medicationDue,uid(5)])

    const vitalPlan=await planTask({type:'vital_check',title:'Blood pressure task',day,time:'10:00',vitalType:'blood_pressure'})
    await actor(0,'service_role')
    const vitalDue=(await db.query('select scheduled_at from care_plan_task_occurrences where task_id=$1',[vitalPlan.task])).rows[0].scheduled_at
    await db.query("insert into vital_readings(patient_id,source,systolic_bp,diastolic_bp,recorded_at,recorded_by_profile_id) values($1,'manual',121,81,$2,$3)",[patients[0],vitalDue,uid(5)])

    const appointmentDue=(await db.query("select ((($1::date+time '12:00') at time zone 'Asia/Yangon')) as due",[day])).rows[0].due
    const appointmentEnd=(await db.query("select $1::timestamptz+interval '30 minutes' as due",[appointmentDue])).rows[0].due
    const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values($1,'teleconsultation',$2,$3) returning id",[provider,appointmentDue,appointmentEnd])).rows[0].id
    const appointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,status) values($1,$2,$3,'teleconsultation',$4,$5,'video','FAMILY-CARE-PLAN','pending') returning id",[patients[0],provider,slot,appointmentDue,appointmentEnd])).rows[0].id
    const appointmentPlan=await planTask({type:'appointment',title:'Clinic appointment',day,time:'12:00',appointmentId:appointment})
    await actor(0,'service_role')
    const encounter=(await db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values($1,$2,$3,'teleconsultation') returning id",[appointment,patients[0],provider])).rows[0].id
    const followupDue=(await db.query("select (($1::date+time '13:00') at time zone 'Asia/Yangon') as due",[day])).rows[0].due
    const followUp=(await db.query("insert into follow_ups(encounter_id,patient_id,assigned_to_profile_id,follow_up_type,due_at,instructions,status) values($1,$2,$3,'call',$4,'Private follow-up record detail','pending') returning id",[encounter,patients[0],uid(5),followupDue])).rows[0].id
    const followupPlan=await planTask({type:'follow_up',title:'Follow-up action',day,time:'13:00',followUpId:followUp})

    await actor(1); await grant(member,{care_plans:true})
    await actor(2)
    const targetMember=(await db.query('select member_id from public.get_family_health_members($1) where not is_self',[group])).rows[0].member_id
    const masked=await rpc('get_family_care_plan_readout',[group,targetMember])
    const byTask=taskId=>masked.flatMap(item=>item.tasks.map(task=>({task,item}))).find(row=>row.task.id===taskId)
    expect(byTask(medicationPlan.task).task.medication).toBeNull()
    expect(byTask(appointmentPlan.task).task.appointment).toBeNull()
    expect(byTask(followupPlan.task).task.follow_up).toBeNull()
    expect(byTask(vitalPlan.task).item.occurrences.find(row=>row.task_id===vitalPlan.task).source).toBeNull()
    expect(JSON.stringify(masked)).not.toContain('Maskable medicine')
    expect(JSON.stringify(masked)).not.toContain('"systolic_bp"')
    expect(JSON.stringify(masked)).not.toContain('Private follow-up record detail')

    await actor(1); await grant(member,{care_plans:true,medications:true,records:true,appointments:true})
    await actor(2)
    const shared=await rpc('get_family_care_plan_readout',[group,targetMember])
    const sharedByTask=taskId=>shared.flatMap(item=>item.tasks.map(task=>({task,item}))).find(row=>row.task.id===taskId)
    expect(sharedByTask(medicationPlan.task).task.medication.medication_name).toBe('Maskable medicine')
    expect(sharedByTask(appointmentPlan.task).task.appointment.id).toBe(appointment)
    expect(sharedByTask(followupPlan.task).task.follow_up.instructions).toBe('Private follow-up record detail')
    expect(sharedByTask(vitalPlan.task).item.occurrences.find(row=>row.task_id===vitalPlan.task).source.reading.systolic_bp).toBe(121)
    expect(sharedByTask(medicationPlan.task).item.occurrences.find(row=>row.task_id===medicationPlan.task).source.type).toBe('medication_event')
  })
})



describe('forward-only rollback of dual-role family repair', () => {
  const prior = JSON.parse(readFileSync(join(process.cwd(), 'scripts/dual-role-family-prior-definitions.json'), 'utf8').replace(/^\uFEFF/, ''))
  const runMigration = async name => {
    await db.exec('reset role')
    await db.exec(readFileSync(join(directory, name), 'utf8').replace(/^begin;/, '').replace(/commit;\s*$/, ''))
  }
  const repair = () => runMigration('20261008093000_dual_role_family_patient_capability.sql')
  const rollback = () => runMigration('20261008094000_revert_dual_role_family_patient_capability.sql')
  const restoreHistoricalBaseline = async () => {
    await db.exec('reset role')
    for (const row of prior) await db.exec(row.definition.replace(/^create function/m,'create or replace function')+';')
  }
  const makeDual = async () => {
    await db.exec('reset role')
    const sql = readFileSync(join(directory, '20261003150000_provider_workspace_foundation.sql'), 'utf8')
    const start = sql.indexOf('create function public.get_my_provider_identity()')
    await db.exec(sql.slice(start, sql.indexOf('$$;',start)+3).replace('create function','create or replace function'))
    await db.query("update profiles set role='nurse' where id=$1",[uid(2)])
    return (await db.query("insert into providers(profile_id,provider_type,verification_status) values($1,'nurse','verified') returning id",[uid(2)])).rows[0].id
  }
  const denied = async (name,args=[]) => {
    await db.exec('savepoint rollback_denial')
    await expect(rpc(name,args)).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to rollback_denial')
  }
  it('restores exact historical definitions and ACLs while preserving policies, identities, clinical rows and unrelated grants',async()=>{
    await restoreHistoricalBaseline()
    const functions = () => db.query("select proname,pg_get_functiondef(oid) as definition,proacl,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('require_family_patient','get_family_health_members','get_family_care_plan_readout') order by proname")
    const snapshot = async () => ({
      policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
      tableGrants:(await db.query('select * from information_schema.role_table_grants order by table_schema,table_name,grantee,privilege_type')).rows,
      columnGrants:(await db.query('select * from information_schema.role_column_grants order by table_schema,table_name,column_name,grantee,privilege_type')).rows,
      patient:(await db.query('select * from patients order by id')).rows,
      provider:(await db.query('select * from providers order by id')).rows,
      vitals:(await db.query('select * from vital_readings order by id')).rows,
      followUps:(await db.query('select * from follow_ups order by id')).rows,
      alerts:(await db.query('select * from monitoring_alerts order by id')).rows,
      access:(await db.query("select pg_get_functiondef('public.can_access_patient(uuid,text)'::regprocedure) as definition")).rows,
    })
    const beforeFunctions=(await functions()).rows
    const before=await snapshot()
    await repair()
    expect((await functions()).rows).not.toEqual(beforeFunctions)
    await rollback(); await rollback()
    expect((await functions()).rows).toEqual(beforeFunctions)
    expect(await snapshot()).toEqual(before)
  })
  it('keeps patient-only invitation generation and acceptance working after rollback',async()=>{
    await repair(); await rollback(); await actor(1)
    expect(await rpc('create_family_join_code')).toMatch(/^[0-9a-f-]{36}$/)
    const {group}=await family()
    await actor(2)
    expect((await db.query('select * from get_family_members($1)',[group])).rows).toHaveLength(2)
    expect((await db.query('select * from get_family_health_members($1)',[group])).rows).toHaveLength(2)
  })
  it('returns dual-role invitations to denial while preserving verified provider workspace identity',async()=>{
    const provider=await makeDual()
    await repair(); await actor(2)
    expect(await rpc('create_family_join_code')).toMatch(/^[0-9a-f-]{36}$/)
    await rollback(); await actor(2)
    await denied('create_family_join_code')
    await denied('create_family_group',['Dual-role family'])
    expect((await db.query('select provider_id from get_my_provider_identity()')).rows).toEqual([{provider_id:provider}])
    await actor(5); await denied('create_family_join_code')
  })
  it('restores patient-only health-directory filtering without removing existing membership or grants',async()=>{
    await makeDual(); await repair()
    const {group,member}=await family()
    await actor(1); const authorization=await grant(member,{records:true})
    await rollback(); await actor(1)
    const members=(await db.query('select * from get_family_health_members($1)',[group])).rows
    expect(members.map(row=>row.patient_id)).toEqual([patients[0]])
    await denied('get_family_care_plan_readout',[group,member])
    await actor(2); await denied('get_family_health_members',[group])
    await actor(0,'service_role')
    expect((await db.query('select status from family_group_members where id=$1',[member])).rows).toEqual([{status:'active'}])
    expect((await db.query('select status from family_authorizations where id=$1',[authorization])).rows).toEqual([{status:'active'}])
  })
  it('retains unrelated invitation denial and cross-family health isolation',async()=>{
    await repair(); await rollback()
    await actor(1); const group=await rpc('create_family_group',['Private family'])
    await actor(2); const code=await rpc('create_family_join_code')
    await actor(3); await denied('invite_family_member',[group,code,'mother'])
    await actor(1); const invitation=await rpc('invite_family_member',[group,code,'mother'])
    await actor(3); await denied('respond_family_invitation',[invitation,true])
    await denied('get_family_health_members',[group])
    expect((await db.query('select patient_id from vital_readings')).rows).toEqual([{patient_id:patients[2]}])
  })
  it('preserves patient authorization and denial after revocation, expiry and member removal',async()=>{
    await repair(); await rollback()
    const {member}=await family()
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'records'])).toBe(false)
    await actor(1); const authorization=await grant(member,{records:true})
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'records'])).toBe(true)
    expect(await rpc('can_access_patient',[patients[0],'care_plans'])).toBe(false)
    for(const state of ['revoked','expired','removed']) {
      await actor(0,'service_role')
      if(state==='revoked') await db.query("update family_authorizations set status='revoked',revoked_at=statement_timestamp() where id=$1",[authorization])
      if(state==='expired') await db.query("update family_authorizations set status='active',revoked_at=null,authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 day' where id=$1",[authorization])
      if(state==='removed') {
        await db.query("update family_authorizations set authorized_at=statement_timestamp(),expires_at=statement_timestamp()+interval '1 day' where id=$1",[authorization])
        await db.query("update family_group_members set status='removed',removed_at=statement_timestamp() where id=$1",[member])
      }
      await actor(2)
      expect(await rpc('can_access_patient',[patients[0],'records'])).toBe(false)
    }
  })
})

describe('Friend and Lover database vocabulary',()=>{
  const migrate = async()=>{
    await db.exec('reset role')
    await db.exec(readFileSync(join(directory,'20261009090000_family_friend_lover_relationships.sql'),'utf8').replace(/^begin;/,'').replace(/commit;\s*$/,''))
  }
  it.each(['friend','lover'])('accepts %s invitations through the authorized RPC and retains it on membership',async relationship=>{
    await migrate(); await actor(1)
    const group=await rpc('create_family_group',['Relationship test'])
    await actor(2); const code=await rpc('create_family_join_code')
    await actor(1); const invite=await rpc('invite_family_member',[group,code,relationship])
    await actor(2); await rpc('respond_family_invitation',[invite,true])
    await actor(0,'service_role')
    expect((await db.query('select relationship from family_invitations where id=$1',[invite])).rows).toEqual([{relationship}])
    expect((await db.query('select relationship from family_group_members where family_group_id=$1 and patient_id=$2',[group,patients[1]])).rows).toEqual([{relationship}])
    await actor(2)
    expect(await rpc('can_access_patient',[patients[0],'records'])).toBe(false)
  })
  it('preserves all original invitation values',async()=>{
    await migrate(); await actor(1); const group=await rpc('create_family_group',['Old values'])
    await actor(0,'service_role')
    for(const relationship of ['spouse','mother','father','parent','child','sibling','guardian','other']) {
      const result=await db.query('insert into family_invitations(family_group_id,invited_profile_id,invited_by,relationship) values($1,$2,$3,$4) returning relationship',[group,uid(2),uid(1),relationship])
      expect(result.rows).toEqual([{relationship}])
    }
  })
  it('preserves all original membership values including self and dependent',async()=>{
    await migrate(); await actor(0,'service_role')
    for(const relationship of ['self','spouse','mother','father','parent','child','sibling','guardian','dependent','other']) {
      const group=(await db.query("insert into family_groups(display_name,created_by) values('Member values',$1) returning id",[uid(1)])).rows[0].id
      expect((await db.query("insert into family_group_members(family_group_id,patient_id,relationship,role,added_by) values($1,$2,$3,'member',$4) returning relationship",[group,patients[1],relationship,uid(1)])).rows).toEqual([{relationship}])
    }
  })
  it.each(['family_invitations','family_group_members'])('keeps invalid relationship rejection on %s',async table=>{
    await migrate(); await actor(1); const group=await rpc('create_family_group',['Invalid value'])
    await actor(0,'service_role'); await db.exec('savepoint invalid_relationship')
    const query=table==='family_invitations'
      ? 'insert into family_invitations(family_group_id,invited_profile_id,invited_by,relationship) values($1,$2,$3,$4)'
      : "insert into family_group_members(family_group_id,patient_id,added_by,relationship,role) values($1,$2,$3,$4,'member')"
    await expect(db.query(query,[group,table==='family_invitations'?uid(2):patients[1],uid(1),'invalid'])).rejects.toMatchObject({code:'23514'})
    await db.exec('rollback to invalid_relationship')
  })
  it('does not alter existing data, RLS, function authorization or grants',async()=>{
    await family(); await db.exec('reset role')
    const snapshot=async()=>({
      invitations:(await db.query('select * from family_invitations order by id')).rows,
      members:(await db.query('select * from family_group_members order by id')).rows,
      policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
      access:(await db.query("select pg_get_functiondef('public.can_access_patient(uuid,text)'::regprocedure) as definition")).rows,
      grants:(await db.query('select * from information_schema.role_table_grants order by table_schema,table_name,grantee,privilege_type')).rows,
    })
    const before=await snapshot(); await migrate()
    expect(await snapshot()).toEqual(before)
  })
})
