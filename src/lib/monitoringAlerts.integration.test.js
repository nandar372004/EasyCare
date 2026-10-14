// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; managed Auth and Storage schemas are simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929150000_monitoring_alert_metadata.sql'
const uid = (n) => `78000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 8 monitoring alerts', () => {
  let db, patients, providers, encounters, alerts, alertsBefore, notificationsBefore, vital, patientsBefore, encountersBefore, policiesBefore

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
    vital = (await db.query("insert into public.vital_readings(patient_id,source,recorded_at) values ($1,'manual',now()) returning id",[patients[0]])).rows[0].id
    alerts = []
    for (const i of [0,1]) alerts.push((await db.query(`insert into public.monitoring_alerts
      (patient_id,vital_reading_id,alert_type,severity,message,created_at)
      values ($1,$2,'synthetic_condition','info','Synthetic condition; not a medical rule','2026-09-28 08:00Z') returning id`,
    [patients[i],i===0 ? vital : null])).rows[0].id)
    await db.query("insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body) values ($1,$2,'health_alert','in_app','Existing delivery','Synthetic')",[uid(1),patients[0]])
    alertsBefore = (await db.query('select * from public.monitoring_alerts order by id')).rows
    notificationsBefore = (await db.query('select * from public.notifications order by id')).rows
    await db.exec(readFileSync(join(directory,migrationName),'utf8'))
  },60000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('preserves old alert fields, patient data, encounters and notifications', async () => {
    const rows = (await db.query('select * from public.monitoring_alerts order by id')).rows
    expect(rows.map(({source_type,source_id,title,rule_code,detected_at,...old})=>old)).toEqual(alertsBefore)
    expect((await db.query('select * from public.notifications order by id')).rows).toEqual(notificationsBefore)
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(patientsBefore)
    expect((await db.query('select * from public.care_encounters order by id')).rows).toEqual(encountersBefore)
    expect((await db.query("select * from pg_policies where schemaname='public' and policyname <> 'alerts_reviewer_update' order by tablename,policyname")).rows).toEqual(policiesBefore.filter(p=>p.policyname!=='alerts_reviewer_update'))
  })
  it('backfills only known provenance and finite historical detection times', async () => {
    const known = (await db.query('select * from public.monitoring_alerts where id=$1',[alerts[0]])).rows[0]
    expect(known).toMatchObject({source_type:'vital',source_id:vital,title:null,rule_code:null})
    expect(known.detected_at).toEqual(known.created_at)
    expect((await db.query('select source_type,source_id from public.monitoring_alerts where id=$1',[alerts[1]])).rows[0]).toEqual({source_type:null,source_id:null})
  })
  it.each(['vital','lab','medication','appointment','ai','manual'])('supports %s provenance without generating a notification', async type => {
    await db.query(`insert into public.monitoring_alerts(patient_id,alert_type,severity,message,source_type,source_id,title,rule_code)
      values ($1,'synthetic','info','Metadata only',$2,$3,'Synthetic title','TEST_ONLY')`,[patients[0],type,uid(99)])
    expect((await db.query('select * from public.notifications order by id')).rows).toEqual(notificationsBefore)
  })
  it('supports old insert payloads and defaults detection time', async () => {
    const row = (await db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message) values ($1,'legacy','info','Legacy payload') returning *",[patients[0]])).rows[0]
    expect(row.detected_at).toBeTruthy()
    expect(row.source_type).toBeNull()
  })
  it.each([[1,0],[2,1],[3,0],[4,0],[5,1]])('isolates alert reads for user %s', async (n,i) => {
    await actor(n)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([{id:alerts[i]}])
  })
  it('requires family alert permission independently from record-view permission', async () => {
    await db.exec('update public.family_authorizations set can_receive_alerts=false')
    await actor(6)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([])
    await db.exec('reset role; update public.family_authorizations set can_receive_alerts=true')
    await actor(6)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([{id:alerts[0]}])
  })
  it('retains main-admin read authority', async () => {
    await actor(7)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toHaveLength(2)
  })
  it('retains assigned coordinator review access', async () => {
    await db.query('insert into auth.users(id) values ($1)',[uid(8)])
    await db.query("insert into public.profiles(id,role,full_name) values ($1,'coordinator','Synthetic coordinator')",[uid(8)])
    const coordinator = (await db.query('insert into public.care_coordinators(profile_id) values ($1) returning id',[uid(8)])).rows[0].id
    await db.query('update public.patients set primary_coordinator_id=$1 where id=$2',[coordinator,patients[0]])
    await actor(8)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([{id:alerts[0]}])
    expect((await db.query("update public.monitoring_alerts set status='acknowledged',reviewed_by_profile_id=$1 where id=$2 returning id",[uid(8),alerts[0]])).rows).toEqual([{id:alerts[0]}])
  })
  it('denies suspended providers access', async () => {
    await db.query("update public.providers set verification_status='suspended' where id=$1",[providers[3]])
    await actor(3)
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([])
    expect((await db.query('update public.monitoring_alerts set reviewed_by_profile_id=$1 returning id',[uid(3)])).rows).toEqual([])
  })
  it('denies anonymous reads and inserts despite broad default grants', async () => {
    await actor(null,'anon')
    expect((await db.query('select id from public.monitoring_alerts')).rows).toEqual([])
    await expect(db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message) values ($1,'test','info','test')",[patients[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('allows authorized clinician creation and review', async () => {
    await actor(3)
    await db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message,source_type,title) values ($1,'test','info','test','manual','Review')",[patients[0]])
    expect((await db.query("update public.monitoring_alerts set status='resolved',resolved_at=now(),reviewed_by_profile_id=$1 where id=$2 returning status",[uid(3),alerts[0]])).rows).toEqual([{status:'resolved'}])
  })
  it('rejects creation for an unauthorized patient', async () => {
    await actor(3)
    await expect(db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message) values ($1,'test','info','test')",[patients[1]])).rejects.toMatchObject({code:'42501'})
  })
  it('closes reviewer reassignment to an unauthorized patient', async () => {
    await actor(3)
    await expect(db.query('update public.monitoring_alerts set patient_id=$1,reviewed_by_profile_id=$2 where id=$3',[patients[1],uid(3),alerts[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('rejects spoofed reviewer identity', async () => {
    await actor(3)
    await expect(db.query('update public.monitoring_alerts set reviewed_by_profile_id=$1 where id=$2',[uid(4),alerts[0]])).rejects.toMatchObject({code:'42501'})
  })
  it('patients cannot create, review or delete alerts', async () => {
    await actor(1)
    expect((await db.query("update public.monitoring_alerts set title='changed' returning id")).rows).toEqual([])
    expect((await db.query('delete from public.monitoring_alerts returning id')).rows).toEqual([])
    await expect(db.query("insert into public.monitoring_alerts(patient_id,alert_type,severity,message) values ($1,'test','info','test')",[patients[0]])).rejects.toMatchObject({code:'42501'})
  })
  it.each([
    ['source_type',"'unsupported'"],['title',"' '"],['rule_code',"' '"],['detected_at',"'infinity'"],
  ])('rejects invalid %s', async (column,value) => {
    await expect(db.query(`update public.monitoring_alerts set ${column}=${value} where id=$1`,[alerts[1]])).rejects.toMatchObject({code:'23514'})
  })
  it('requires a type for a source ID', async () => {
    await expect(db.query('update public.monitoring_alerts set source_id=$1 where id=$2',[uid(99),alerts[1]])).rejects.toMatchObject({code:'23514'})
  })
  it('rejects conflicting legacy vital and generic source IDs', async () => {
    await expect(db.query('update public.monitoring_alerts set source_id=$1 where id=$2',[uid(99),alerts[0]])).rejects.toMatchObject({code:'23514'})
  })
  it.each(['patient_id','vital_reading_id','reviewed_by_profile_id'])('preserves %s FK', async column => {
    await expect(db.query(`update public.monitoring_alerts set ${column}=$1 where id=$2`,[uid(99),alerts[1]])).rejects.toMatchObject({code:'23503'})
  })
})
