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
const migration = readFileSync(join(directory, '20261002110000_notification_mark_read_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/notification_security_validation.sql'), 'utf8')
const uid = n => `89000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Prescription integrity test patient', phone: `+95989000000${n}`,
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
  await db.exec(readFileSync(join(directory,'20261002090000_encounter_appointment_integrity.sql'),'utf8'))
  await db.exec(readFileSync(join(directory,'20261002100000_payment_appointment_integrity.sql'),'utf8'))
  return { db, patients, providers, encounters, prescription }
}


describe('Notification mark-read integrity',()=>{
  let db,patients,notifications,before,policies;
  async function actor(n,role='authenticated'){
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uid(n):'']);
    if(n||role!=='authenticated')await db.exec(`set local role ${role}`);
  }
  const mark=(id=notifications[0])=>db.query('select (public.mark_notification_read($1)).*',[id]);
  beforeAll(async()=>{
    ({db,patients}=await baseline());notifications=[];
    for(const i of [0,1])notifications.push((await db.query("insert into notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at) values ($1,$2,'health_alert','in_app','Original title','Original body','delivered',now()-interval '1 minute') returning id",[uid(i+1),patients[i]])).rows[0].id);
    before=(await db.query('select * from notifications order by id')).rows;
    policies=(await db.query("select * from pg_policies where policyname<>'notifications_mark_read' order by schemaname,tablename,policyname")).rows;
    // Exercise removal of column grants as well as broad table privileges.
    await db.exec('grant update(read_at,body) on notifications to authenticated');
    await db.exec(migration);
  },60000);
  beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
  it('preserves all historical fields and unrelated policies',async()=>{
    expect((await db.query('select * from notifications order by id')).rows).toEqual(before);
    expect((await db.query("select * from pg_policies where policyname<>'notifications_mark_read' order by schemaname,tablename,policyname")).rows).toEqual(policies);
    expect((await db.query("select * from pg_policies where policyname='notifications_mark_read'")).rows).toEqual([]);
    await db.exec(validation);
  });
  it('recipient reads only own notification',async()=>{
    await actor(1);expect((await db.query('select id from notifications')).rows).toEqual([{id:notifications[0]}]);
  });
  it('mark-read changes only read_at/status and uses a server timestamp',async()=>{
    await actor(1);const row=(await mark()).rows[0];const original=before.find(n=>n.id===notifications[0]);
    expect(row.status).toBe('read');expect(row.read_at).not.toBeNull();
    expect({...row,status:original.status,read_at:original.read_at}).toEqual(original);
    expect((await db.query('select read_at<=statement_timestamp() and read_at>=transaction_timestamp() as valid from notifications where id=$1',[notifications[0]])).rows[0].valid).toBe(true);
  });
  it('repeated mark-read preserves first read timestamp',async()=>{
    await actor(1);expect((await mark()).rows[0]).toEqual((await mark()).rows[0]);
  });
  const changes=[['title',"'Forged'"],['body',"'Forged'"],['type',"'booking'"],['channel',"'sms'"],['recipient_profile_id',`'${uid(2)}'`],['patient_id','null'],['status',"'sent'"],['sent_at','now()'],['scheduled_at','now()'],['id',`'${uid(99)}'`],['read_at',"'2099-01-01'::timestamptz"]];
  it.each(changes)('direct recipient UPDATE of %s is denied',async(field,value)=>{
    await actor(1);await expect(db.query(`update notifications set ${field}=${value} where id=$1`,[notifications[0]])).rejects.toMatchObject({code:'42501'});
  });
  it.each(changes.filter(([field])=>field!=='read_at'))('mark-read plus protected %s mutation is denied',async(field,value)=>{
    await actor(1);await expect(db.query(`update notifications set read_at=now(),${field}=${value} where id=$1`,[notifications[0]])).rejects.toMatchObject({code:'42501'});
  });
  it('recipient cannot clear read state',async()=>{
    await actor(1);await mark();await expect(db.query("update notifications set read_at=null,status='delivered' where id=$1",[notifications[0]])).rejects.toMatchObject({code:'42501'});
  });
  it('another recipient cannot call mark-read on foreign notification',async()=>{
    await actor(2);await expect(mark()).rejects.toMatchObject({code:'42501'});
  });
  it('unknown ID returns the same denial rather than exposing existence',async()=>{
    await actor(1);await expect(mark(uid(99))).rejects.toMatchObject({code:'42501',message:'Notification unavailable'});
  });
  it('anonymous cannot execute RPC',async()=>{
    await actor(null,'anon');await expect(mark()).rejects.toMatchObject({code:'42501'});
  });
  it('anonymous cannot directly update notifications',async()=>{
    await actor(null,'anon');await expect(db.query('update notifications set read_at=now() where id=$1',[notifications[0]])).rejects.toMatchObject({code:'42501'});
  });
  it('authenticated role without identity cannot execute mutation',async()=>{
    await actor(null,'authenticated');await db.exec('set local role authenticated');await expect(mark()).rejects.toMatchObject({code:'42501'});
  });
  it('RPC accepts no content or timestamp parameters',async()=>{
    await actor(1);await expect(db.query("select mark_notification_read($1,'Forged body',now())",[notifications[0]])).rejects.toMatchObject({code:'42883'});
  });
  it('accidental regrant of table UPDATE still has no recipient UPDATE RLS path',async()=>{
    await db.exec('grant update on notifications to authenticated');await actor(1);
    expect((await db.query("update notifications set body='Forged' where id=$1 returning id",[notifications[0]])).rows).toEqual([]);
  });
  it('service-role delivery updates remain functional',async()=>{
    await actor(null,'service_role');expect((await db.query("update notifications set body='System content',status='sent',sent_at=now(),channel='sms' where id=$1 returning status",[notifications[0]])).rows).toEqual([{status:'sent'}]);
    expect((await db.query("insert into notifications(recipient_profile_id,type,channel,title,body) values ($1,'booking','in_app','System title','System body') returning id",[uid(1)])).rows).toHaveLength(1);
  });
  it('actual schema has no created_at or generic metadata field to mutate',async()=>{
    const columns=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='notifications'")).rows.map(r=>r.column_name);
    expect(columns.sort()).toEqual(['id','recipient_profile_id','patient_id','type','channel','title','body','status','scheduled_at','sent_at','read_at'].sort());
  });
  it('table and column UPDATE grants are revoked while function security is pinned',async()=>{
    expect((await db.query("select has_table_privilege('authenticated','notifications','UPDATE') as tab,has_any_column_privilege('authenticated','notifications','UPDATE') as col")).rows[0]).toEqual({tab:false,col:false});
    const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.mark_notification_read(uuid)'::regprocedure")).rows[0];expect(fn.prosecdef).toBe(true);expect(fn.proconfig).toEqual(['search_path=""']);
  });
});
