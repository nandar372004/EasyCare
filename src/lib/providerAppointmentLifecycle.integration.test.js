// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const uid = n => `87000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let db,patient,provider,other,appointment,otherAppointment,slot
beforeAll(async () => {
  db=new PGlite({extensions:{btree_gist,pgcrypto}})
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema storage;create table storage.buckets(id text primary key,name text unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant all on storage.objects to anon,authenticated,service_role;`)
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql') && n<='20261009100000_provider_appointment_lifecycle.sql').sort()) await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8'))
  await db.query('insert into auth.users values($1),($2),($3)',[uid(1),uid(2),uid(3)])
  patient=(await db.query('select create_patient_registration($1::jsonb) as id',[JSON.stringify({userId:uid(1),fullName:'Test Patient',phone:'+959870000001',dateOfBirth:'1990-01-01',medicalProfile:{}})])).rows[0].id
  await db.query("insert into profiles(id,role,full_name) values($1,'doctor','Doctor One'),($2,'doctor','Doctor Two')",[uid(2),uid(3)])
  provider=(await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values($1,'doctor','verified',0) returning id",[uid(2)])).rows[0].id
  other=(await db.query("insert into providers(profile_id,provider_type,verification_status,consultation_fee_mmk) values($1,'doctor','verified',0) returning id",[uid(3)])).rows[0].id
  slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at,status) values($1,'teleconsultation',now()+interval '1 day',now()+interval '1 day 30 minutes','available') returning id",[provider])).rows[0].id
  appointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code,reason_symptoms) select $1,$2,id,service_type,start_at,end_at,'video','LIFE-ONE','Private reason' from provider_availability where id=$3 returning id",[patient,provider,slot])).rows[0].id
  const otherSlot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at,status) values($1,'teleconsultation',now()+interval '2 days',now()+interval '2 days 30 minutes','available') returning id",[other])).rows[0].id
  otherAppointment=(await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,scheduled_start,scheduled_end,consultation_channel,booking_code) select $1,$2,id,service_type,start_at,end_at,'video','LIFE-TWO' from provider_availability where id=$3 returning id",[patient,other,otherSlot])).rows[0].id
},120000)
afterAll(async()=>db?.close())
async function as(n, action) {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(n)])
    await db.exec('set local role authenticated')
    return await action()
  } finally {await db.exec('rollback')}
}
const transition=status=>db.query('select transition_my_provider_appointment($1,$2) as status',[appointment,status])
describe('provider appointment lifecycle on repository schema',()=>{
  it('reads only own assigned appointments even when another provider treats the same patient',async()=>{
    await as(2,async()=>expect((await db.query('select * from list_my_provider_appointments()')).rows).toMatchObject([{id:appointment,patient_display_name:'Test Patient',reason_symptoms:'Private reason',status:'pending'}]))
    await as(3,async()=>expect((await db.query('select id from list_my_provider_appointments()')).rows).toEqual([{id:otherAppointment}]))
    await as(1,async()=>expect((await db.query('select * from list_my_provider_appointments()')).rows).toEqual([]))
  })
  it.each(['completed','no_show'])('confirms then marks %s without reopening slot; patient reads canonical result',async terminal=>{
    await as(2,async()=>{
      expect((await transition('confirmed')).rows[0].status).toBe('confirmed')
      expect((await transition(terminal)).rows[0].status).toBe(terminal)
      const rows=(await db.query('select * from list_my_provider_appointments()')).rows
      expect(rows[0]).toMatchObject({status:terminal,patient_display_name:'Patient',reason_symptoms:null})
      await db.exec('reset role');expect((await db.query('select status from provider_availability where id=$1',[slot])).rows[0].status).toBe('booked')
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(1)]);await db.exec('set local role authenticated')
      expect((await db.query('select status from appointments where id=$1',[appointment])).rows[0].status).toBe(terminal)
    })
  })
  it.each(['confirmed','completed'])('patient cannot self-%s or directly update status',async status=>{
    await expect(as(1,()=>transition(status))).rejects.toThrow(/not authorized/)
    await expect(as(1,()=>db.query('update appointments set status=$1 where id=$2',[status,appointment]))).rejects.toThrow(/permission denied/)
  })
  it('other provider cannot mutate and cannot impersonate the assigned provider',async()=>{
    await expect(as(3,()=>transition('confirmed'))).rejects.toThrow(/not authorized/)
    expect((await db.query('select provider_id,status from appointments where id=$1',[appointment])).rows[0]).toEqual({provider_id:provider,status:'pending'})
  })
  it.each([['pending','completed'],['completed','pending'],['cancelled','confirmed'],['no_show','completed'],['rescheduled','confirmed']])('rejects %s -> %s',async(from,to)=>{
    await db.query("update appointments set status=$1::appointment_status,cancelled_at=case when $1::appointment_status='cancelled' then now() else null end where id=$2",[from,appointment])
    await expect(as(2,()=>transition(to))).rejects.toThrow(/Invalid appointment/)
    await db.query("update appointments set status='pending',cancelled_at=null where id=$1",[appointment])
  })
  it('rejects suspended providers; RLS and direct write privileges remain unchanged',async()=>{
    await db.query("update providers set verification_status='suspended' where id=$1",[provider])
    await expect(as(2,()=>transition('confirmed'))).rejects.toThrow(/not authorized/)
    await as(2,async()=>expect((await db.query('select * from list_my_provider_appointments()')).rows).toEqual([]))
    await db.query("update providers set verification_status='verified' where id=$1",[provider])
    expect((await db.query("select relrowsecurity from pg_class where oid='appointments'::regclass")).rows[0].relrowsecurity).toBe(true)
    expect((await db.query("select has_column_privilege('authenticated','appointments','status','UPDATE') as allowed")).rows[0].allowed).toBe(false)
  })
})
