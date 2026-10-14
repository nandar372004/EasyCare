// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
const sql = readFileSync('scripts/seed-staging-doctor-future-availability.sql', 'utf8')
const id = n => `52000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function fixture() {
  const db = new PGlite()
  await db.exec(`create type service_mode as enum('teleconsultation','home_visit');
    create role authenticated; grant usage on schema public to authenticated;
    create table profiles(id uuid primary key,status text);
    create table providers(id uuid primary key,profile_id uuid,provider_type text,verification_status text,teleconsult_enabled boolean,home_visit_enabled boolean,display_name text,qualification text,license_number text);
    create table patients(id uuid primary key); create table appointments(id uuid primary key);
    create table provider_availability(id uuid primary key,provider_id uuid references providers(id),service_type service_mode,start_at timestamptz,end_at timestamptz,status text,check(end_at>start_at));
    alter table provider_availability enable row level security;
    create policy availability_read on provider_availability for select to authenticated using(status='available');
    grant select(id,provider_id,service_type,start_at,end_at,status) on provider_availability to authenticated;
    insert into profiles values('${id(90)}','inactive');
    insert into providers values
      ('${id(1)}',null,'doctor','verified',true,true,'Tele Doctor','Synthetic MBBS demonstration','SYN-ECP-GP-001'),
      ('${id(2)}',null,'doctor','verified',false,true,'Home Doctor','Synthetic MBBS demonstration','SYN-ECP-IM-002'),
      ('${id(3)}',null,'doctor','pending',true,false,'Pending',null,null),
      ('${id(4)}','${id(90)}','doctor','verified',true,false,'Inactive',null,null),
      ('${id(5)}',null,'nurse','verified',true,false,'Nurse',null,null),
      ('${id(6)}',null,'doctor','suspended',true,false,'Suspended',null,null),
      ('${id(7)}',null,'doctor','rejected',true,false,'Rejected',null,null),
      ('${id(8)}',null,'doctor','verified',false,false,'Unsupported',null,null);
    insert into patients values('${id(80)}'); insert into appointments values('${id(81)}');`)
  const run = async (execute = false, fingerprint = '') => {
    await db.exec('drop table if exists seed_plan; drop table if exists seed_result;')
    const results = await db.exec(sql.replace('__EXECUTE__',String(execute)).replaceAll('__EXPECTED_PLAN__',fingerprint))
    return results.at(-1).rows[0].summary
  }
  return { db, run }
}
describe('Staging availability seed', () => {
  it('selects eligible doctors, inserts three future slots each, preserves protected rows and is idempotent', async () => {
    const {db,run}=await fixture()
    try {
      const preview=await run(); expect(preview).toMatchObject({eligible_doctors:2,planned_inserts:6,executed:false})
      expect((await db.query('select * from provider_availability')).rows).toHaveLength(0)
      expect(await run(true,preview.plan_fingerprint)).toMatchObject({inserted:6,verified_future_available_slots:6,protected_rows_unchanged:true})
      expect((await db.query("select provider_id,service_type,count(*)::int as n,bool_and(start_at>now() and status='available') as valid from provider_availability group by provider_id,service_type order by provider_id")).rows).toEqual([
        {provider_id:id(1),service_type:'teleconsultation',n:3,valid:true},{provider_id:id(2),service_type:'home_visit',n:3,valid:true}])
      expect((await db.query("select count(*)::int as n,bool_and((start_at at time zone 'Asia/Yangon')::date >= date '2026-10-20') as after_cutoff from provider_availability")).rows[0]).toEqual({n:6,after_cutoff:true})
      expect((await db.query("select count(*)::int as n from provider_availability where (start_at at time zone 'Asia/Yangon')::date=date '2026-10-20' and (start_at at time zone 'Asia/Yangon')::time in (time '09:00',time '10:00',time '11:00')")).rows[0].n).toBe(6)
      const rerun=await run(); expect(rerun.planned_inserts).toBe(0)
      expect((await run(true,rerun.plan_fingerprint)).inserted).toBe(0)
      expect((await db.query('select * from patients')).rows).toEqual([{id:id(80)}])
      expect((await db.query('select * from appointments')).rows).toEqual([{id:id(81)}])
    } finally {await db.close()}
  })
  it.each(['booked','held','unavailable'])('moves conflicts forward without changing %s slots', async status => {
    const {db,run}=await fixture()
    try {
      await db.exec(`insert into provider_availability select '${id(30)}','${id(1)}','teleconsultation',timestamp '2026-10-20 09:00:00' at time zone 'Asia/Yangon',timestamp '2026-10-20 12:00:00' at time zone 'Asia/Yangon','${status}'`)
      const before=(await db.query('select * from provider_availability')).rows
      const p=await run(); await run(true,p.plan_fingerprint)
      expect((await db.query(`select * from provider_availability where id='${id(30)}'`)).rows).toEqual(before)
      expect((await db.query('select a.id from provider_availability a join provider_availability b on a.provider_id=b.provider_id and a.id<b.id and a.start_at<b.end_at and a.end_at>b.start_at')).rows).toHaveLength(0)
    } finally {await db.close()}
  })
  it('moves only a conflicting preferred slot and leaves the other two preferred times in place', async () => {
    const {db,run}=await fixture()
    try {
      await db.exec(`insert into provider_availability select '${id(30)}','${id(1)}','teleconsultation',timestamp '2026-10-20 10:00:00' at time zone 'Asia/Yangon',timestamp '2026-10-20 10:30:00' at time zone 'Asia/Yangon','unavailable'`)
      const p=await run(); await run(true,p.plan_fingerprint)
      const starts=(await db.query(`select to_char(start_at at time zone 'Asia/Yangon','HH24:MI') as start from provider_availability where provider_id='${id(1)}' and id<>'${id(30)}' order by start_at`)).rows.map(row=>row.start)
      expect(starts).toEqual(['09:00','11:00','12:00'])
      expect((await db.query(`select status from provider_availability where id='${id(30)}'`)).rows).toEqual([{status:'unavailable'}])
    } finally {await db.close()}
  })
  it('rejects a changed preview and rolls back all inserts', async () => {
    const {db,run}=await fixture()
    try {
      const p=await run(); await db.exec(`update providers set display_name='Changed' where id='${id(1)}'`)
      await expect(run(true,p.plan_fingerprint)).rejects.toThrow(/changed since preview/)
      await db.exec('rollback'); expect((await db.query('select * from provider_availability')).rows).toHaveLength(0)
    } finally {await db.close()}
  })
  it('refuses rerun after seeded slot is booked', async () => {
    const {db,run}=await fixture()
    try {
      const p=await run();await run(true,p.plan_fingerprint)
      await db.exec("update provider_availability set status='booked' where id=(select id from provider_availability limit 1)")
      await expect(run()).rejects.toThrow(/refusing rerun/); await db.exec('rollback')
      expect((await db.query("select * from provider_availability where status='booked'")).rows).toHaveLength(1)
    } finally {await db.close()}
  })
})
