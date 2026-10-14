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
const migration = readFileSync(join(directory, '20261002100000_payment_appointment_integrity.sql'), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/payment_appointment_validation.sql'), 'utf8')
const uid = n => `88000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Prescription integrity test patient', phone: `+95988000000${n}`,
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
  return { db, patients, providers, encounters, prescription }
}


describe('Payment appointment ownership integrity',()=>{
  let db,patients,providers,encounters,apps,oldPayment,subscription,policies;
  async function actor(n,role='authenticated'){
    await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uid(n):'']);
    if(n||role!=='authenticated')await db.exec(`set local role ${role}`);
  }
  const insert=(patient=patients[0],app=apps[0],payer=uid(1),sub=null)=>db.query('insert into payments(patient_id,appointment_id,payer_profile_id,subscription_id,amount) values ($1,$2,$3,$4,30000) returning id,patient_id,appointment_id,status',[patient,app,payer,sub]);
  beforeAll(async()=>{
    ({db,patients,providers,encounters}=await baseline());apps=[];
    await db.query('update providers set consultation_fee_mmk=30000 where id=any($1::uuid[])',[providers]);
    for(const i of [0,1]){
      const slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2035-01-01T09:00Z','2035-01-01T09:30Z') returning id",[providers[i]])).rows[0].id;
      apps.push((await db.query("insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code) values ($1,$2,$3,'teleconsultation','video','2035-01-01T09:00Z','2035-01-01T09:30Z',$4) returning id",[patients[i],providers[i],slot,`PAYMENT-${i}`])).rows[0].id);
    }
    oldPayment=(await db.query("insert into payments(patient_id,appointment_id,payer_profile_id,amount,currency,status,transaction_reference,paid_at) values ($1,$2,$3,30000,'MMK','paid','HISTORICAL-REFERENCE',now()) returning *",[patients[0],apps[0],uid(1)])).rows[0];
    const pkg=(await db.query("insert into care_packages(name,price) values ('Test subscription',30000) returning id")).rows[0].id;
    subscription=(await db.query('insert into subscriptions(patient_id,purchased_by_profile_id,package_id) values ($1,$2,$3) returning id',[patients[0],uid(1),pkg])).rows[0].id;
    await db.query('insert into auth.users(id) values ($1)',[uid(9)]);
    await db.query("insert into profiles(id,role,full_name) values ($1,'family','Authorized family payer')",[uid(9)]);
    await db.query("insert into family_authorizations(patient_id,family_profile_id,status,can_make_payments) values ($1,$2,'active',true)",[patients[0],uid(9)]);
    policies=(await db.query("select * from pg_policies where policyname<>'payments_create' order by schemaname,tablename,policyname")).rows;
    await db.exec(migration);
  },60000);
  beforeEach(()=>db.exec('begin'));
  afterEach(()=>db.exec('rollback'));
  afterAll(()=>db?.close());
  it('preserves historical financial fields and unrelated policies and validates FK',async()=>{
    expect((await db.query('select * from payments where id=$1',[oldPayment.id])).rows[0]).toEqual(oldPayment);
    expect((await db.query("select * from pg_policies where policyname<>'payments_create' order by schemaname,tablename,policyname")).rows).toEqual(policies);
    expect((await db.query("select convalidated,condeferrable from pg_constraint where conname='payments_appointment_patient_fk'")).rows).toEqual([{convalidated:true,condeferrable:false}]);
    expect((await db.exec(validation))[0].rows).toEqual([]);
  });
  it('patient creates and reads own pending payment and multiple payments remain supported',async()=>{
    await actor(1);expect((await insert()).rows[0].status).toBe('pending');expect((await insert()).rows).toHaveLength(1);
    expect((await db.query('select id from payments')).rows).toHaveLength(3);
  });
  it.each([0,1])('patient %s cannot attach own payment to the other appointment',async i=>{
    await actor(i+1);await expect(insert(patients[i],apps[1-i],uid(i+1))).rejects.toMatchObject({code:'42501'});
  });
  it('patient cannot use foreign patient identity to match the foreign appointment',async()=>{
    await actor(1);await expect(insert(patients[1],apps[1])).rejects.toMatchObject({code:'42501'});
  });
  it.each(['postgres','service_role'])('direct %s write cannot create mismatched payment',async role=>{
    await actor(null,role==='postgres'?'authenticated':role);await expect(insert(patients[0],apps[1])).rejects.toMatchObject({code:'23503',constraint:'payments_appointment_patient_fk'});
  });
  it.each(['appointment_id','patient_id'])('service role cannot corrupt payment %s',async field=>{
    await actor(null,'service_role');await expect(db.query(`update payments set ${field}=$1 where id=$2`,[field==='appointment_id'?apps[1]:patients[1],oldPayment.id])).rejects.toMatchObject({code:'23503',constraint:'payments_appointment_patient_fk'});
  });
  it.each(['appointment_id','patient_id','status'])('patient cannot UPDATE %s',async field=>{
    await actor(1);const value=field==='appointment_id'?apps[1]:field==='patient_id'?patients[1]:'paid';
    expect((await db.query(`update payments set ${field}=$1 where id=$2 returning id`,[value,oldPayment.id])).rows).toEqual([]);
  });
  it('patient cannot delete payments or read another patient payment',async()=>{
    await actor(2);expect((await db.query('select id from payments')).rows).toEqual([]);
    await actor(1);expect((await db.query('delete from payments where id=$1 returning id',[oldPayment.id])).rows).toEqual([]);
  });
  it('parent patient mutation cannot orphan a payment even without encounter children',async()=>{
    await actor(null,'service_role');await expect(db.query('update appointments set patient_id=$1 where id=$2',[patients[1],apps[0]])).rejects.toMatchObject({code:'23001'});
  });
  it('preserves subscription-only payment creation',async()=>{
    await actor(1);expect((await insert(patients[0],null,uid(1),subscription)).rows[0].appointment_id).toBeNull();
  });
  it('still requires appointment or subscription',async()=>{
    await actor(1);await expect(insert(patients[0],null)).rejects.toMatchObject({code:'23514'});
  });
  it('authorized family payer retains creation and reads without appointment SELECT access',async()=>{
    await actor(9);expect((await db.query('select id from appointments')).rows).toEqual([]);
    const payment=(await insert(patients[0],apps[0],uid(9))).rows[0];expect((await db.query('select id from payments where id=$1',[payment.id])).rows).toHaveLength(1);
  });
  it('family payment permission cannot bypass appointment patient mismatch',async()=>{
    await actor(9);await expect(insert(patients[0],apps[1],uid(9))).rejects.toMatchObject({code:'42501'});
  });
  it('revoked family payer cannot create payments',async()=>{
    await db.query("update family_authorizations set status='revoked',revoked_at=now() where family_profile_id=$1",[uid(9)]);await actor(9);
    await expect(insert(patients[0],apps[0],uid(9))).rejects.toMatchObject({code:'42501'});
  });
  it('anonymous cannot create payment',async()=>{
    await actor(null,'anon');await expect(insert()).rejects.toMatchObject({code:'42501'});
  });
  it.each(["status='paid'","paid_at=now()","refunded_at=now()"] )('client cannot assert financial completion via %s',async assignment=>{
    await actor(1);const [field,value]=assignment.split('=');
    await expect(db.query(`insert into payments(patient_id,appointment_id,payer_profile_id,amount,${field}) values ($1,$2,$3,30000,${value})`,[patients[0],apps[0],uid(1)])).rejects.toMatchObject({code:'42501'});
  });
  it('trusted direct financial processing remains possible without inventing a gateway',async()=>{
    await actor(null,'service_role');const payment=(await insert()).rows[0];
    expect((await db.query("update payments set status='paid',paid_at=now(),transaction_reference='PROCESSING-TEST' where id=$1 returning status",[payment.id])).rows).toEqual([{status:'paid'}]);
  });
  it('reports monetary differences without silently correcting or enforcing settlement semantics',async()=>{
    await db.query("update payments set amount=5000,currency='USD' where id=$1",[oldPayment.id]);
    const rows=(await db.exec(validation))[0].rows;expect(rows).toHaveLength(1);expect(rows[0].structural_blocker).toBe(false);expect(rows[0].review_reasons).toEqual(['currency_review','amount_review']);
  });
  it('Repair 4 price immutability remains enforced',async()=>{
    await actor(null,'service_role');await expect(db.query('update appointments set fee_amount=0 where id=$1',[apps[0]])).rejects.toMatchObject({code:'23514'});
  });
  it('Repair 5 forged encounter remains denied at boundary',async()=>{
    await actor(3);await expect(db.query("insert into care_encounters(appointment_id,patient_id,provider_id,encounter_type) values ($1,$2,$3,'teleconsultation')",[apps[0],patients[1],providers[0]])).rejects.toMatchObject({code:'42501'});
  });
});
it('reports existing cross-patient payment and aborts without rewriting financial data',async()=>{
  const {db,patients,encounters}=await baseline();try{
    const app=(await db.query('select appointment_id from care_encounters where id=$1',[encounters[1]])).rows[0].appointment_id;
    const row=(await db.query("insert into payments(patient_id,appointment_id,payer_profile_id,amount,currency,status,transaction_reference) values ($1,$2,$3,5000,'USD','pending','HISTORICAL-MISMATCH') returning *",[patients[0],app,uid(1)])).rows[0];
    expect((await db.exec(validation))[0].rows[0].structural_blocker).toBe(true);
    await expect(db.exec(migration)).rejects.toMatchObject({code:'23514',message:expect.stringContaining('Payment repair stopped')});await db.exec('rollback');
    expect((await db.query('select * from payments where id=$1',[row.id])).rows[0]).toEqual(row);
    expect((await db.query("select conname from pg_constraint where conname='payments_appointment_patient_fk'")).rows).toEqual([]);
  }finally{await db.close();}
},60000);
