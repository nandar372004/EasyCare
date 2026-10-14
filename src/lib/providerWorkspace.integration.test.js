// @vitest-environment node
// Executes the provider workspace migration and RPCs against PostgreSQL semantics.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrations = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261004100000_provider_patient_relationship_hardening.sql'
const reconciliationMigration = '20261006110000_reconcile_provider_family_care_plan_authorization.sql'
const aclFixMigration = '20261006120000_provider_workspace_patient_list_acl.sql'
const phaseHMigration = '20261006140000_patient_medical_document_intake.sql'
const uid = n => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db, patient1, patient2, provider1, provider2, scopeProvider, appointment1, assignment1, medicationId, scheduleId, patientListBodyBeforeAcl

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist, pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema storage; create table storage.buckets(id text primary key, name text unique, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;`)
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n < migrationName).sort()) await db.exec(readFileSync(join(migrations, name), 'utf8'))
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4),($5)', [uid(1), uid(2), uid(3), uid(4), uid(6)])
  patient1 = (await db.query('select public.create_patient_registration($1::jsonb) id', [JSON.stringify({ userId: uid(1), fullName: 'Authorized Patient', phone: '+959860000001', dateOfBirth: '1990-01-01', medicalProfile: {} })])).rows[0].id
  patient2 = (await db.query('select public.create_patient_registration($1::jsonb) id', [JSON.stringify({ userId: uid(2), fullName: 'Other Patient', phone: '+959860000002', dateOfBirth: '1991-01-01', medicalProfile: {} })])).rows[0].id
  await db.query("insert into profiles(id,role,full_name) values ($1,'doctor','Doctor One'),($2,'doctor','Doctor Two'),($3,'doctor','Family Scope Test Doctor')", [uid(3), uid(4), uid(6)])
  provider1 = (await db.query("insert into providers(profile_id,provider_type,verification_status,display_name,consultation_fee_mmk) values ($1,'doctor','verified','Dr One',0) returning id", [uid(3)])).rows[0].id
  provider2 = (await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values ($1,'doctor','verified',0) returning id", [uid(4)])).rows[0].id
  scopeProvider = (await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values ($1,'doctor','verified',0) returning id", [uid(6)])).rows[0].id
  const slot = (await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at,status) values ($1,'teleconsultation',statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 30 minutes','available') returning id", [provider1])).rows[0].id
  const appt = await db.query(`insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code)
    select $1,$2,id,service_type,start_at,end_at,'video','PW-ONE' from provider_availability where id=$3 returning id`, [patient1, provider1, slot])
  appointment1 = appt.rows[0].id
  const scopeSlot = (await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at,status) values ($1,'teleconsultation',statement_timestamp()+interval '2 days',statement_timestamp()+interval '2 days 30 minutes','available') returning id", [scopeProvider])).rows[0].id
  await db.query(`insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code)
    select $1,$2,id,service_type,start_at,end_at,'video','PW-SCOPE' from provider_availability where id=$3`, [patient1, scopeProvider, scopeSlot])
  const request = await db.query("insert into care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms) values ($1,$2,'teleconsultation','Test') returning id", [patient2, uid(2)])
  assignment1 = (await db.query("insert into care_assignments(care_request_id,provider_id,assigned_by_profile_id,status) values ($1,$2,$3,'accepted') returning id", [request.rows[0].id, provider1, uid(3)])).rows[0].id
  const request2 = await db.query("insert into care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms) values ($1,$2,'teleconsultation','Test') returning id", [patient1, uid(1)])
  await db.query("insert into care_assignments(care_request_id,provider_id,assigned_by_profile_id,status) values ($1,$2,$3,'assigned')", [request2.rows[0].id, provider2, uid(4)])
  medicationId = (await db.query("insert into patient_medications(patient_id,medication_name,dose,created_by_profile_id) values ($1,'Existing medication','10 mg',$2) returning id", [patient1,uid(1)])).rows[0].id
  scheduleId = (await db.query("insert into medication_schedules(patient_medication_id,time_of_day,timezone) values ($1,'08:00','Asia/Yangon') returning id", [medicationId])).rows[0].id
  await db.exec(readFileSync(join(migrations, migrationName), 'utf8'))
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n > migrationName && n < reconciliationMigration).sort()) {
    await db.exec(readFileSync(join(migrations, name), 'utf8'))
  }
  await db.exec(readFileSync(join(migrations, reconciliationMigration), 'utf8'))
  patientListBodyBeforeAcl = (await db.query("select pg_get_functiondef('public.list_my_clinical_patients()'::regprocedure) as definition")).rows[0].definition
  await db.exec(readFileSync(join(migrations, aclFixMigration), 'utf8'))
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n > aclFixMigration && n < phaseHMigration).sort()) {
    await db.exec(readFileSync(join(migrations, name), 'utf8'))
  }
  await db.exec(readFileSync(join(migrations, phaseHMigration), 'utf8'))
}, 120000)

afterAll(async () => db?.close())

async function as(userId) {
  await db.exec('begin')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ? uid(userId) : ''])
  await db.exec('set local role authenticated')
}
async function clinicalAccess(userId, targetPatient) {
  await as(userId)
  const allowed = (await db.query("select public.can_access_patient($1,'clinical') as allowed", [targetPatient])).rows[0].allowed
  await db.exec('rollback')
  return allowed
}

describe('provider workspace identity and patient projection', () => {
  it('replays the clinical document foundation through Phase H on the current authorization chain', async () => {
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='clinical_documents' order by ordinal_position")).rows.map(row => row.column_name)
    expect(columns).toContain('original_filename')
    expect(columns).toContain('storage_bucket')
    expect(columns).toContain('source')
    expect(columns).toContain('status')
    expect(columns).toContain('removed_at')
    expect((await db.query("select public.can_access_patient($1,'clinical') as allowed", [patient2])).rows[0].allowed).toBe(false)
  })

  it('revokes public patient-list execution while preserving the canonical body and authenticated access', async () => {
    const privileges = (await db.query(`select
      has_function_privilege('anon','public.list_my_clinical_patients()','execute') as anon_exec,
      has_function_privilege('authenticated','public.list_my_clinical_patients()','execute') as authenticated_exec,
      coalesce(bool_or(acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as public_exec
      from pg_proc function
      cross join lateral aclexplode(function.proacl) acl
      where function.oid='public.list_my_clinical_patients()'::regprocedure`)).rows[0]
    expect(privileges).toEqual({ anon_exec: false, authenticated_exec: true, public_exec: false })
    expect((await db.query("select pg_get_functiondef('public.list_my_clinical_patients()'::regprocedure) as definition")).rows[0].definition).toBe(patientListBodyBeforeAcl)
  })

  it('keeps Family record and Care Plan scopes separate and requires valid group membership', async () => {
    await as(6)
    const planId = (await db.query("select public.create_care_plan_draft($1,null,'Family scope plan',null,null,'Asia/Yangon',statement_timestamp(),null) as id", [patient1])).rows[0].id
    await db.query('select public.approve_care_plan_version($1,null)', [planId])
    await db.query("select public.transition_care_plan($1,'activate',null)", [planId])
    await db.exec('commit')

    const groupId = (await db.query("insert into family_groups(display_name,created_by) values('Reconciliation test', $1) returning id", [uid(1)])).rows[0].id
    await db.query("insert into family_group_members(family_group_id,patient_id,relationship,role,added_by) values($1,$2,'self','owner',$3),($1,$4,'mother','member',$3)", [groupId, patient1, uid(1), patient2])
    const consentId = (await db.query("insert into consents(patient_id,granted_by_profile_id,consent_type,version,status) values($1,$2,'family_access','reconciliation-test','granted') returning id", [patient1, uid(1)])).rows[0].id
    const authorizationId = (await db.query(`insert into family_authorizations(patient_id,family_profile_id,relationship,status,authorized_at,expires_at,
      can_view_records,can_view_care_plans,source_family_group_id,consent_id)
      values($1,$2,'mother','active',statement_timestamp(),statement_timestamp()+interval '1 day',true,false,$3,$4) returning id`, [patient1, uid(2), groupId, consentId])).rows[0].id

    await as(2)
    expect((await db.query("select public.can_access_patient($1,'records') as allowed", [patient1])).rows[0].allowed).toBe(true)
    expect((await db.query("select public.can_access_patient($1,'care_plans') as allowed", [patient1])).rows[0].allowed).toBe(false)
    expect((await db.query('select public.list_my_care_plan_summaries() as plans')).rows[0].plans).toEqual([])
    await db.exec('rollback')

    await db.query('update family_authorizations set can_view_care_plans=true where id=$1', [authorizationId])
    await as(2)
    expect((await db.query("select public.can_access_patient($1,'care_plans') as allowed", [patient1])).rows[0].allowed).toBe(true)
    expect((await db.query('select public.list_my_care_plan_summaries() as plans')).rows[0].plans.map(plan => plan.id)).toContain(planId)
    expect((await db.query("select public.can_access_patient($1,'medications') as allowed", [patient1])).rows[0].allowed).toBe(false)
    await db.exec('rollback')

    await db.query("update family_authorizations set authorized_at=statement_timestamp()-interval '2 days',expires_at=statement_timestamp()-interval '1 second' where id=$1", [authorizationId])
    await as(2)
    expect((await db.query("select public.can_access_patient($1,'care_plans') as allowed", [patient1])).rows[0].allowed).toBe(false)
    await db.exec('rollback')
    await db.query("update family_authorizations set expires_at=statement_timestamp()+interval '1 day',status='revoked',revoked_at=statement_timestamp() where id=$1", [authorizationId])
    await as(2)
    expect((await db.query("select public.can_access_patient($1,'care_plans') as allowed", [patient1])).rows[0].allowed).toBe(false)
    await db.exec('rollback')
    await db.query("update family_authorizations set status='active',revoked_at=null where id=$1", [authorizationId])

    await db.query("update family_group_members set status='removed',removed_at=statement_timestamp() where family_group_id=$1 and patient_id=$2", [groupId, patient2])
    await as(2)
    expect((await db.query("select public.can_access_patient($1,'records') as allowed", [patient1])).rows[0].allowed).toBe(false)
    expect((await db.query("select public.can_access_patient($1,'care_plans') as allowed", [patient1])).rows[0].allowed).toBe(false)
    await db.exec('rollback')
  })

  it('resolves only the verified provider mapped to auth.uid()', async () => {
    await as(3)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([{ provider_id: provider1, provider_type: 'doctor', display_name: 'Dr One' }])
    await db.exec('rollback')
  })
  it('lists only the responsible doctor’s plans and creates through auth.uid()-checked RPCs', async () => {
    await as(3)
    const created = await db.query("select public.create_care_plan_draft($1,null,'Clinician plan',null,'Instructions','Asia/Yangon',statement_timestamp(),null) as id", [patient1])
    const planId = created.rows[0].id
    const plans = await db.query('select * from public.list_my_provider_care_plans()')
    expect(plans.rows).toHaveLength(1)
    expect(plans.rows[0]).toMatchObject({ plan_id: planId, patient_id: patient1, patient_name: 'Authorized Patient', status: 'draft', title: 'Clinician plan' })
    const detail = await db.query('select public.get_my_provider_care_plan($1) as plan', [planId])
    expect(detail.rows[0].plan.patient.full_name).toBe('Authorized Patient')
    expect(detail.rows[0].plan.plan.id).toBe(planId)
    await expect(db.query("select public.get_my_provider_care_plan($1)", [uid(999)])).resolves.toBeTruthy()
    await expect(db.query("insert into care_plans(patient_id,responsible_provider_id,created_by_profile_id) values ($1,$2,$3)",[patient1,provider1,uid(3)])).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback')
  })
  it('returns only same-patient minimal medication source data and rejects unrelated patient source reads', async () => {
    await as(3)
    const result = await db.query("select public.list_provider_care_plan_sources($1,'medication') as rows", [patient1])
    expect(result.rows[0].rows).toEqual([expect.objectContaining({ medication_id: medicationId, schedule_id: scheduleId, name: 'Existing medication', dose: '10 mg' })])
    expect(Object.keys(result.rows[0].rows[0]).sort()).toEqual(['days_of_week','dose','medication_id','name','schedule_id','time_of_day','timezone','valid_from','valid_until'])
    await db.exec('rollback')
    await as(4)
    await expect(db.query("select public.list_provider_care_plan_sources($1,'medication')", [patient2])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
  })
  it('returns appointment and accepted assignment relationships with minimal patient fields', async () => {
    await as(3)
    const rows = (await db.query('select * from public.list_my_clinical_patients() order by display_name')).rows
    expect(rows.map(row => [row.display_name, row.relationship_context])).toEqual([['Authorized Patient', 'appointment'], ['Other Patient', 'care_assignment']])
    expect(Object.keys(rows[0]).sort()).toEqual(['display_name', 'patient_id', 'relationship_context'])
    await db.exec('rollback')
  })
  it('isolates patient lists by provider and does not accept caller-selected provider or patient IDs', async () => {
    await as(4)
    const rows = (await db.query('select * from public.list_my_clinical_patients()')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].patient_id).toBe(patient1)
    await expect(db.query('select * from public.list_my_clinical_patients($1)', [provider1])).rejects.toMatchObject({ code: '42883' })
    await db.exec('rollback')
  })
  it('removes a care-assignment patient when the assigned relationship is cancelled', async () => {
    await db.query("update care_assignments set status='cancelled' where id=$1", [assignment1])
    await as(3)
    const rows = (await db.query('select * from public.list_my_clinical_patients()')).rows
    expect(rows.map(row => row.patient_id)).toEqual([patient1])
    await db.exec('rollback')
    await db.query("update care_assignments set status='accepted' where id=$1", [assignment1])
  })
  it.each([['inactive profile', "update profiles set status='inactive' where id=$1"], ['suspended provider', "update providers set verification_status='suspended' where profile_id=$1"], ['unverified provider', "update providers set verification_status='pending' where profile_id=$1"]])('fails closed for %s', async (_label, sql) => {
    await db.query(sql, [uid(3)])
    await as(3)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([])
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows).toEqual([])
    await db.exec('rollback')
    await db.query("update profiles set status='active' where id=$1", [uid(3)])
    await db.query("update providers set verification_status='verified' where profile_id=$1", [uid(3)])
  })
  it('denies patient and anonymous identities provider resolution', async () => {
    await as(1)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([])
    await db.exec('rollback')
    await as(null)
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows).toEqual([])
    await db.exec('rollback')
  })
  it.each(['pending','confirmed','rescheduled'])('grants current access for a future %s appointment', async status => {
    await db.query("update appointments set status=$2,cancelled_at=null where id=$1", [appointment1, status])
    expect(await clinicalAccess(3, patient1)).toBe(true)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it.each(['cancelled','completed','no_show'])('denies access from a %s appointment alone', async status => {
    await db.query("update appointments set status=$2::public.appointment_status,cancelled_at=case when $2::text='cancelled' then statement_timestamp() else null end where id=$1", [appointment1, status])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await as(3)
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows.some(row => row.patient_id === patient1)).toBe(false)
    await db.exec('rollback')
    if (status === 'cancelled') {
      await as(3)
      await expect(db.query("select public.create_care_plan_draft($1,null,'No access',null,null,'Asia/Yangon',statement_timestamp(),null)", [patient1])).rejects.toMatchObject({ code: '42501' })
      await db.exec('rollback')
    }
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('denies access from a stale pending appointment after its scheduled end', async () => {
    const slot = (await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at,status) values ($1,'teleconsultation',statement_timestamp()-interval '2 hours',statement_timestamp()-interval '1 hour','available') returning id", [provider1])).rows[0].id
    await db.query(`insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code)
      select $1,$2,id,service_type,start_at,end_at,'video','PW-STALE' from provider_availability where id=$3`, [patient1, provider1, slot])
    await db.query("update appointments set status='cancelled',cancelled_at=statement_timestamp() where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('does not let a different provider or a guessed patient UUID restore access', async () => {
    expect(await clinicalAccess(4, patient2)).toBe(false)
    expect(await clinicalAccess(3, uid(999))).toBe(false)
    await as(4)
    await expect(db.query("select public.create_care_plan_draft($1,null,'No access',null,null,'Asia/Yangon',statement_timestamp(),null)", [patient2])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
  })
  it('keeps access when one invalid appointment coexists with a valid care assignment', async () => {
    const request = (await db.query("insert into care_requests(patient_id,requested_by_profile_id,service_type,reason_symptoms,status) values ($1,$2,'teleconsultation','Valid assignment','booked') returning id", [patient1, uid(1)])).rows[0].id
    const assignment = (await db.query("insert into care_assignments(care_request_id,provider_id,assigned_by_profile_id,status) values ($1,$2,$3,'accepted') returning id", [request, provider1, uid(3)])).rows[0].id
    await db.query("update appointments set status='cancelled',cancelled_at=statement_timestamp() where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(true)
    await db.query("update care_assignments set status='cancelled' where id=$1", [assignment])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it.each(['suggested','rejected','cancelled'])('does not treat a %s assignment as a current relationship', async status => {
    await db.query('update care_assignments set status=$2 where id=$1', [assignment1, status])
    expect(await clinicalAccess(3, patient2)).toBe(false)
    await db.query("update care_assignments set status='accepted' where id=$1", [assignment1])
  })
  it.each(['assigned','accepted'])('treats a non-terminal %s assignment under an open request as current', async status => {
    await db.query('update care_assignments set status=$2 where id=$1', [assignment1, status])
    expect(await clinicalAccess(3, patient2)).toBe(true)
    await db.query("update care_assignments set status='accepted' where id=$1", [assignment1])
  })
  it.each(['closed','cancelled'])('does not treat an accepted assignment under a %s request as current', async status => {
    await db.query('update care_requests set status=$2 where id=(select care_request_id from care_assignments where id=$1)', [assignment1, status])
    expect(await clinicalAccess(3, patient2)).toBe(false)
    await db.query("update care_requests set status='booked' where id=(select care_request_id from care_assignments where id=$1)", [assignment1])
  })
  it('removes an appointment relationship immediately after valid-to-cancelled transition', async () => {
    expect(await clinicalAccess(3, patient1)).toBe(true)
    await db.query("update appointments set status='cancelled',cancelled_at=statement_timestamp() where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await as(3)
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows.some(row => row.patient_id === patient1)).toBe(false)
    await db.exec('rollback')
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('preserves access through the responsible doctor’s active and paused Care Plan only', async () => {
    await as(3)
    const planId = (await db.query("select public.create_care_plan_draft($1,null,'Ongoing plan',null,null,'Asia/Yangon',statement_timestamp(),null) as id", [patient1])).rows[0].id
    await db.query('select public.approve_care_plan_version($1,null)', [planId])
    await db.query("select public.transition_care_plan($1,'activate',null)", [planId])
    await db.exec('commit')
    await db.query("update appointments set status='completed',cancelled_at=null where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(true)
    await as(3)
    const listed = (await db.query('select * from public.list_my_clinical_patients()')).rows
    expect(listed).toContainEqual(expect.objectContaining({ patient_id: patient1, relationship_context: 'care_plan' }))
    await db.query("select public.create_care_plan_version($1,'Follow-up version',null,null,'ongoing care',null)", [planId])
    await db.query("select public.transition_care_plan($1,'pause',null)", [planId])
    await db.exec('commit')
    expect(await clinicalAccess(3, patient1)).toBe(true)
    await as(3)
    await db.query("select public.transition_care_plan($1,'complete',null)", [planId])
    await db.exec('commit')
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('does not let another doctor borrow an active plan as a patient relationship', async () => {
    await as(3)
    const planId = (await db.query("select public.create_care_plan_draft($1,null,'Assigned patient plan',null,null,'Asia/Yangon',statement_timestamp(),null) as id", [patient2])).rows[0].id
    await db.query('select public.approve_care_plan_version($1,null)', [planId])
    await db.query("select public.transition_care_plan($1,'activate',null)", [planId])
    await db.exec('commit')
    expect(await clinicalAccess(4, patient2)).toBe(false)
    await as(4)
    const denied = async (sql, args) => {
      await db.exec('savepoint expected_denial')
      await expect(db.query(sql, args)).rejects.toMatchObject({ code: '42501' })
      await db.exec('rollback to savepoint expected_denial')
    }
    await denied('select public.provider_has_current_clinical_relationship($1)', [patient2])
    expect((await db.query('select public.get_my_provider_care_plan($1) as plan', [planId])).rows[0].plan).toBeNull()
    await denied("select public.list_provider_care_plan_sources($1,'follow_up')", [patient2])
    await denied("select public.create_care_plan_version($1,'Unauthorized version',null,null,'must fail',null)", [planId])
    await db.exec('rollback')
  })
  it('does not let a cancelled draft create continuing access after its appointment ends', async () => {
    await as(3)
    const planId = (await db.query("select public.create_care_plan_draft($1,null,'Cancelled plan',null,null,'Asia/Yangon',statement_timestamp(),null) as id", [patient1])).rows[0].id
    await db.query("select public.transition_care_plan($1,'cancel',null)", [planId])
    await db.exec('commit')
    await db.query("update appointments set status='completed',cancelled_at=null where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('does not let a discontinued Care Plan create continuing access', async () => {
    await as(3)
    const planId = (await db.query("select public.create_care_plan_draft($1,null,'Discontinued plan',null,null,'Asia/Yangon',statement_timestamp(),null) as id", [patient1])).rows[0].id
    await db.query('select public.approve_care_plan_version($1,null)', [planId])
    await db.query("select public.transition_care_plan($1,'activate',null)", [planId])
    await db.query("select public.transition_care_plan($1,'discontinue',null)", [planId])
    await db.exec('commit')
    await db.query("update appointments set status='completed',cancelled_at=null where id=$1", [appointment1])
    expect(await clinicalAccess(3, patient1)).toBe(false)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
  it('closes stale encounter, note, prescription, and visit-event provider writes', async () => {
    await as(3)
    const encounterId = (await db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values ($1,$2,$3,'teleconsultation') returning id", [appointment1, patient1, provider1])).rows[0].id
    const prescriptionId = (await db.query('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3) returning id', [encounterId, patient1, provider1])).rows[0].id
    await db.exec('commit')
    await db.query("update appointments set status='cancelled',cancelled_at=statement_timestamp() where id=$1", [appointment1])
    await as(3)
    const denied = async (sql, args) => {
      await db.exec('savepoint expected_denial')
      await expect(db.query(sql, args)).rejects.toMatchObject({ code: '42501' })
      await db.exec('rollback to savepoint expected_denial')
    }
    expect((await db.query('delete from care_encounters where id=$1 returning id', [encounterId])).rows).toEqual([])
    await denied("insert into clinical_notes(encounter_id,author_profile_id,note_type,content) values ($1,$2,'assessment','stale')", [encounterId, uid(3)])
    await denied('insert into prescriptions(encounter_id,patient_id,doctor_provider_id) values ($1,$2,$3)', [encounterId, patient1, provider1])
    await denied("insert into prescription_items(prescription_id,medication_name) values ($1,'Unauthorized')", [prescriptionId])
    await denied("insert into visit_status_events(appointment_id,status,actor_profile_id) values ($1,'requested',$2)", [appointment1, uid(3)])
    await db.exec('rollback')
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1", [appointment1])
  })
})
