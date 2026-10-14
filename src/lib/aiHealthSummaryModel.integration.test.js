// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; managed Auth and Storage schemas are simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929160000_ai_health_summary_model.sql'
const uid = (n) => `79000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 9 AI summary model', () => {
  let db, patients, providers, encounters, summaries, summariesBefore, conditionsBefore, patientsBefore, encountersBefore, policiesBefore

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
    summaries = []
    for (const i of [0,1]) summaries.push((await db.query(`insert into public.ai_health_summaries
      (patient_id,period_start,period_end,summary_type,summary_text,source_snapshot,review_status,created_at)
      values ($1,'2026-09-28','2026-09-29','daily','Legacy derived summary',$2::jsonb,$3,'2026-09-29 01:00Z') returning id`,
    [patients[i],JSON.stringify({patient_id:patients[i],legacy_payload:['unchanged']}),i===0?'reviewed':'generated'])).rows[0].id)
    await db.query("insert into public.patient_conditions(patient_id,condition_name,status) values ($1,'Existing clinician-recorded condition','active')",[patients[0]])
    summariesBefore = (await db.query('select * from public.ai_health_summaries order by id')).rows
    conditionsBefore = (await db.query('select * from public.patient_conditions order by id')).rows
    await db.exec(readFileSync(join(directory,migrationName),'utf8'))
  },60000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  async function insertSummary(patient=patients[0], id=uid(50)) {
    return (await db.query(`insert into public.ai_health_summaries
      (id,patient_id,period_start,period_end,summary_type,summary_text,overall_status,things_to_watch,recommended_actions,
       urgency_level,source_snapshot,source_data_hash,model_provider,model_name,model_version,prompt_version,generated_at,expires_at)
      values ($1,$2,'2026-09-29','2026-09-30','daily','Derived information only','unassessed','["Synthetic observation"]',
       '[{"action":"Review with care team"}]','unassessed',$3::jsonb,$4,'test-provider','test-model','test-version','prompt-v1',
       '2026-09-30 01:00Z','2026-10-01 01:00Z') returning *`,
    [id,patient,JSON.stringify({patient_id:patient,records:[],captured_at:'2026-09-30T00:00:00Z'}),'a'.repeat(64)])).rows[0]
  }

  it('preserves every old summary column, snapshot and existing clinical record', async () => {
    for (const old of summariesBefore) {
      const current = (await db.query('select * from public.ai_health_summaries where id=$1',[old.id])).rows[0]
      for (const key of Object.keys(old)) expect(current[key]).toEqual(old[key])
      expect(current.generated_at).toEqual(old.created_at)
      expect(current.model_name).toBeNull()
      expect(current.reviewed_by_profile_id).toBeNull()
      expect(current.source_data_hash).toBeNull()
    }
    expect((await db.query('select * from public.patient_conditions order by id')).rows).toEqual(conditionsBefore)
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(patientsBefore)
    expect((await db.query('select * from public.care_encounters order by id')).rows).toEqual(encountersBefore)
    expect((await db.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows).toEqual(policiesBefore)
  })
  it('contains every requested field and enables RLS', async () => {
    const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='ai_health_summaries'")).rows.map(r=>r.column_name)
    expect(columns).toEqual(expect.arrayContaining(['id','patient_id','period_start','period_end','summary_type','overall_status','summary_text','things_to_watch','recommended_actions','urgency_level','source_snapshot','source_data_hash','model_provider','model_name','model_version','prompt_version','generated_at','expires_at','review_status','reviewed_by_profile_id','reviewed_at','superseded_by_id','created_at']))
    expect((await db.query("select relrowsecurity from pg_class where oid='public.ai_health_summaries'::regclass")).rows[0].relrowsecurity).toBe(true)
  })
  it('stores all requested metadata through trusted service writes without creating conditions', async () => {
    await actor(null,'service_role')
    const row = await insertSummary()
    expect(row).toMatchObject({patient_id:patients[0],model_provider:'test-provider',model_name:'test-model',model_version:'test-version',prompt_version:'prompt-v1',review_status:'generated',urgency_level:'unassessed'})
    expect(row.source_snapshot.patient_id).toBe(patients[0])
    expect(row.source_data_hash).toBe('a'.repeat(64))
    expect(row.recommended_actions).toHaveLength(1)
    expect(row.things_to_watch).toHaveLength(1)
    await db.exec('reset role')
    expect((await db.query('select * from public.patient_conditions order by id')).rows).toEqual(conditionsBefore)
  })
  it('preserves old insert payloads and supplies safe new defaults', async () => {
    const row = (await db.query("insert into public.ai_health_summaries(patient_id,period_start,period_end,summary_type,summary_text) values ($1,'2026-10-01','2026-10-02','daily','Legacy payload') returning *",[patients[0]])).rows[0]
    expect(row.generated_at).toBeTruthy()
    expect(row).toMatchObject({things_to_watch:[],recommended_actions:[],urgency_level:'unassessed',source_data_hash:null,source_snapshot:null})
  })
  it.each([[1,0],[2,1],[3,0],[4,0],[5,1],[6,0]])('scopes summary reads for user %s', async (n,i) => {
    await actor(n)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([{id:summaries[i]}])
  })
  it('retains active main-admin access to visible summaries', async () => {
    await actor(7)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toHaveLength(2)
  })
  it('hides hidden summaries even from their patient', async () => {
    await db.query("update public.ai_health_summaries set review_status='hidden' where id=$1",[summaries[0]])
    await actor(1)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it('honors revoked clinical access', async () => {
    await db.query("update public.providers set verification_status='suspended' where id=$1",[providers[3]])
    await actor(3)
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it('denies anonymous access and remains protected under accidental SELECT grants', async () => {
    await actor(null,'anon')
    await db.exec('savepoint denied')
    await expect(db.query('select * from public.ai_health_summaries')).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied; reset role; grant select on public.ai_health_summaries to anon')
    await actor(null,'anon')
    expect((await db.query('select id from public.ai_health_summaries')).rows).toEqual([])
  })
  it.each([1,3,7])('denies browser user %s summary/review writes', async n => {
    await actor(n)
    await expect(db.query("update public.ai_health_summaries set summary_text='spoof' where id=$1",[summaries[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('denies all client mutations even under broad grants', async () => {
    await db.exec('grant all on public.ai_health_summaries to authenticated')
    await actor(1)
    expect((await db.query("update public.ai_health_summaries set summary_text='spoof' returning id")).rows).toEqual([])
    expect((await db.query('delete from public.ai_health_summaries returning id')).rows).toEqual([])
    await expect(insertSummary()).rejects.toMatchObject({code:'42501'})
  })
  it('records attributed review without changing source provenance', async () => {
    await actor(null,'service_role')
    await db.query("update public.ai_health_summaries set review_status='reviewed',reviewed_by_profile_id=$1,reviewed_at='2026-09-30' where id=$2",[uid(3),summaries[0]])
    const row=(await db.query('select * from public.ai_health_summaries where id=$1',[summaries[0]])).rows[0]
    expect(row.reviewed_by_profile_id).toBe(uid(3))
    expect(row.source_snapshot).toEqual(summariesBefore.find(r=>r.id===row.id).source_snapshot)
  })
  it('supports same-period replacement while preserving the old source snapshot', async () => {
    await actor(null,'service_role')
    await db.exec('set constraints ai_summaries_superseded_patient_fk deferred')
    await db.query('update public.ai_health_summaries set superseded_by_id=$1 where id=$2',[uid(60),summaries[0]])
    await db.query(`insert into public.ai_health_summaries(id,patient_id,period_start,period_end,summary_type,summary_text,source_snapshot)
      values ($1,$2,'2026-09-28','2026-09-29','daily','Replacement derived summary','{"revision":2}')`,[uid(60),patients[0]])
    await db.exec('set constraints ai_summaries_superseded_patient_fk immediate')
    expect((await db.query('select id from public.ai_health_summaries where patient_id=$1',[patients[0]])).rows).toHaveLength(2)
    expect((await db.query('select source_snapshot from public.ai_health_summaries where id=$1',[summaries[0]])).rows[0].source_snapshot).toEqual(summariesBefore.find(r=>r.id===summaries[0]).source_snapshot)
  })
  it('rejects two current summaries for the same period', async () => {
    await expect(db.query(`insert into public.ai_health_summaries(patient_id,period_start,period_end,summary_type,summary_text)
      values ($1,'2026-09-28','2026-09-29','daily','Duplicate')`,[patients[0]])).rejects.toMatchObject({code:'23505'})
  })
  it('rejects cross-patient supersession', async () => {
    await expect(db.query('update public.ai_health_summaries set superseded_by_id=$1 where id=$2',[summaries[1],summaries[0]])).rejects.toMatchObject({code:'23503'})
  })
  it('preserves the patient FK', async () => {
    await expect(db.query('update public.ai_health_summaries set patient_id=$1 where id=$2',[uid(99),summaries[0]])).rejects.toMatchObject({code:'23503'})
  })
  it('preserves the period ordering constraint', async () => {
    await expect(db.query('update public.ai_health_summaries set period_end=period_start where id=$1',[summaries[0]])).rejects.toMatchObject({code:'23514'})
  })
  it('rejects review timestamps preceding generation', async () => {
    await expect(db.query("update public.ai_health_summaries set reviewed_by_profile_id=$1,reviewed_at='2026-01-01' where id=$2",[uid(3),summaries[0]])).rejects.toMatchObject({code:'23514'})
  })
  it('withholds service deletion of history', async () => {
    await actor(null,'service_role')
    await expect(db.query('delete from public.ai_health_summaries where id=$1',[summaries[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('rejects self supersession', async () => {
    await expect(db.query('update public.ai_health_summaries set superseded_by_id=id where id=$1',[summaries[0]])).rejects.toMatchObject({code:'23514'})
  })
  it('rejects missing successor and reviewer references', async () => {
    await db.exec('savepoint fk_test')
    await expect(db.query('update public.ai_health_summaries set superseded_by_id=$1 where id=$2',[uid(99),summaries[0]])).rejects.toMatchObject({code:'23503'})
    await db.exec('rollback to savepoint fk_test')
    await expect(db.query("update public.ai_health_summaries set reviewed_by_profile_id=$1,reviewed_at='2026-09-30' where id=$2",[uid(99),summaries[0]])).rejects.toMatchObject({code:'23503'})
  })
  it.each([
    ['things_to_watch',"'{}'::jsonb"],['recommended_actions',"'null'::jsonb"],['source_data_hash',"'invalid'"],
    ['model_provider',"' '"],['model_name',"' '"],['model_version',"' '"],['prompt_version',"' '"],['overall_status',"' '"],
    ['generated_at',"'infinity'"],['expires_at',"'2026-01-01'"],['reviewed_at',"'2026-09-30'"],
  ])('checks invalid %s metadata', async (column,value) => {
    await expect(db.query(`update public.ai_health_summaries set ${column}=${value} where id=$1`,[summaries[0]])).rejects.toMatchObject({code:'23514'})
  })
  it('requires a snapshot when supplying a source hash', async () => {
    await expect(db.query('update public.ai_health_summaries set source_snapshot=null,source_data_hash=$1 where id=$2',['a'.repeat(64),summaries[0]])).rejects.toMatchObject({code:'23514'})
  })
})
