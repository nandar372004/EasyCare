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
const migration = readFileSync(join(directory, migrationName), 'utf8')
const validation = readFileSync(join(process.cwd(), 'supabase/scripts/appointment_pricing_validation.sql'), 'utf8')
const uid = n => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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
      userId: uid(n), fullName: 'Prescription integrity test patient', phone: `+95986000000${n}`,
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
  return { db, patients, providers, encounters, prescription }
}


describe('Appointment pricing integrity',()=>{
  let db,patients,providers,encounters,prescription,slot,history,policies;
  async function actor(n,role='authenticated'){
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[n?uid(n):'']);
    await db.exec(`set local role ${role}`);
  }
  const book=(fee=30000,currency='MMK',provider=providers[0],availability=slot,type='teleconsultation')=>db.query(`insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code,fee_amount,currency)
    values ($1,$2,$3,$4,$5,'2030-01-01T09:00Z','2030-01-01T09:30Z','PRICE-TEST',$6,$7) returning id,fee_amount,currency`,[patients[0],provider,availability,type,type==='home_visit'?'home_visit':'video',fee,currency]);
  beforeAll(async()=>{
    ({db,patients,providers,encounters,prescription}=await baseline());
    await db.query('update providers set consultation_fee_mmk=30000 where id=any($1::uuid[])',[providers]);
    slot=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2030-01-01T09:00Z','2030-01-01T09:30Z') returning id",[providers[0]])).rows[0].id;
    history=(await db.query('select * from appointments order by id')).rows;
    policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
    await db.exec(migration);
  },60000);
  beforeEach(()=>db.exec('begin'));
  afterEach(()=>db.exec('rollback'));
  afterAll(()=>db?.close());
  it('preserves historical rows, reports both legacy zero-fee appointments, and leaves RLS unchanged',async()=>{
    expect((await db.query('select * from appointments order by id')).rows).toEqual(history);
    const reports=(await db.exec(validation))[0].rows;
    expect(reports).toHaveLength(2);
    for(const row of reports)expect(row.review_reasons).toContain('paid_provider_zero_fee');
    expect((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows).toEqual(policies);
  });
  it.each([0,1000,5000,30000,999999,null])('client fee %s is replaced by authoritative 30000 MMK',async fee=>{
    await actor(1);
    const row=(await book(fee,'USD')).rows[0];
    expect(Number(row.fee_amount)).toBe(30000);expect(row.currency).toBe('MMK');
  });
  it('accepts booking with fee and currency omitted',async()=>{
    await actor(1);
    const row=(await db.query(`insert into appointments(patient_id,provider_id,provider_availability_id,appointment_type,consultation_channel,scheduled_start,scheduled_end,booking_code)
      values ($1,$2,$3,'teleconsultation','video','2030-01-01T09:00Z','2030-01-01T09:30Z','OMITTED') returning fee_amount,currency`,[patients[0],providers[0],slot])).rows[0];
    expect(Number(row.fee_amount)).toBe(30000);expect(row.currency).toBe('MMK');
  });
  it('honors explicit free provider price',async()=>{
    await db.query('update providers set consultation_fee_mmk=0 where id=$1',[providers[0]]);
    await actor(1);expect(Number((await book(30000)).rows[0].fee_amount)).toBe(0);
  });
  it('does not interpret missing provider price as free',async()=>{
    await db.query('update providers set consultation_fee_mmk=null where id=$1',[providers[0]]);
    await actor(1);await expect(book(0)).rejects.toMatchObject({code:'23514'});
  });
  it.each(['fee_amount','currency'])('patient cannot update %s after creation',async field=>{
    await actor(1);const row=(await book()).rows[0];
    await expect(db.query(`update appointments set ${field}=$1 where id=$2`,[field==='currency'?'USD':0,row.id])).rejects.toMatchObject({code:'42501'});
  });
  it.each(['fee_amount','currency','provider_id','appointment_type','provider_availability_id','scheduled_start'])('service role cannot alter booked %s',async field=>{
    const row=(await book()).rows[0];await actor(null,'service_role');
    const value={fee_amount:0,currency:'USD',provider_id:providers[1],appointment_type:'home_visit',provider_availability_id:null,scheduled_start:'2030-01-01T08:00Z'}[field];
    await expect(db.query(`update appointments set ${field}=$1 where id=$2`,[value,row.id])).rejects.toMatchObject({code:'23514'});
  });
  it('service role cannot bypass authoritative INSERT price',async()=>{
    await actor(null,'service_role');expect(Number((await book(0)).rows[0].fee_amount)).toBe(30000);
  });
  it('preserves price snapshot after provider reprices and allows unrelated lifecycle update',async()=>{
    const row=(await book()).rows[0];
    await db.query('update providers set consultation_fee_mmk=45000 where id=$1',[providers[0]]);
    const result=(await db.query("update appointments set status='confirmed' where id=$1 returning fee_amount",[row.id])).rows[0];
    expect(Number(result.fee_amount)).toBe(30000);
  });
  it.each(['provider','service','missing-slot','time'])('rejects %s mismatch even for direct database writes',async kind=>{
    if(kind==='time')await db.query("update provider_availability set start_at='2030-01-01T08:59Z' where id=$1",[slot]);
    await expect(book(0,'MMK',kind==='provider'?providers[1]:providers[0],kind==='missing-slot'?null:slot,kind==='service'?'home_visit':'teleconsultation')).rejects.toMatchObject({code:'23514'});
  });
  it('rejects unsupported provider type rather than using an unrelated catalog price',async()=>{
    await db.query("update providers set provider_type='nurse' where id=$1",[providers[0]]);
    await expect(book()).rejects.toMatchObject({code:'23514'});
  });
  it('retains slot contention protection',async()=>{
    await book();await expect(book()).rejects.toMatchObject({code:'23P01'});
  });
  it('retains overlap protection even when using a different matching slot',async()=>{
    await book();
    const another=(await db.query("insert into provider_availability(provider_id,service_type,start_at,end_at) values ($1,'teleconsultation','2030-01-01T09:00Z','2030-01-01T09:30Z') returning id",[providers[0]])).rows[0].id;
    await expect(book(0,'MMK',providers[0],another)).rejects.toMatchObject({code:'23P01'});
  });
  it('denies anonymous booking',async()=>{
    await actor(null,'anon');await expect(book()).rejects.toMatchObject({code:'42501'});
  });
  it('denies another patient booking for patient A',async()=>{
    await actor(2);await expect(book()).rejects.toMatchObject({code:'42501'});
  });
  it('catalog/rule/package tables have no appointment pricing override link',async()=>{
    const cols=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='appointments'")).rows.map(r=>r.column_name);
    for(const col of ['service_id','pricing_rule_id','subscription_id','package_id'])expect(cols).not.toContain(col);
    await db.exec("insert into service_catalog(code,name,service_type,base_price) values ('PRICE-TEST','Unrelated free service','teleconsultation',0)");
    await actor(1);expect(Number((await book(0)).rows[0].fee_amount)).toBe(30000);
  });
  it('Repair 1 foreign key remains enforced after pricing repair',async()=>{
    await expect(db.query('update prescriptions set patient_id=$1 where id=$2',[patients[1],prescription.id])).rejects.toMatchObject({code:'23503'});
  });
  it('Repair 2 foreign key remains enforced after pricing repair',async()=>{
    await expect(db.query("insert into follow_ups(patient_id,encounter_id,follow_up_type) values ($1,$2,'call')",[patients[1],encounters[0]])).rejects.toMatchObject({code:'23503'});
  });
  it('Repair 3 suspended doctor remains denied clinical reads',async()=>{
    await db.query("update profiles set status='suspended' where id=$1",[uid(3)]);await actor(3);
    expect((await db.query('select id from care_encounters')).rows).toEqual([]);
  });
});
