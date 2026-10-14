// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
const template = readFileSync('scripts/clean-my-staging-appointments.sql', 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function fixture() {
  const db = new PGlite()
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,email text,phone text);
    create table profiles(id uuid primary key); create table patients(id uuid primary key,profile_id uuid,auth_user_id uuid,primary_phone text);
    create table providers(id uuid primary key); create table provider_availability(id uuid primary key,provider_id uuid,status text,start_at timestamptz,end_at timestamptz,service_type text);
    create table appointments(id uuid primary key,patient_id uuid,provider_availability_id uuid,provider_id uuid,status text,scheduled_start timestamptz,scheduled_end timestamptz,appointment_type text);
    create table audit_logs(action text); create function audit_row_change() returns trigger language plpgsql as $$begin insert into audit_logs values('delete'); return old; end$$;
    create trigger appointments_audit after delete on appointments for each row execute function audit_row_change();
    insert into auth.users values('${id(1)}','self@example.test',null),('${id(2)}','other@example.test',null);
    insert into profiles values('${id(1)}'),('${id(2)}'); insert into patients values('${id(11)}','${id(1)}','${id(1)}',null),('${id(12)}','${id(2)}','${id(2)}',null);
    insert into providers values('${id(21)}');
    insert into provider_availability values('${id(31)}','${id(21)}','booked','2099-01-01T00:00:00Z','2099-01-01T01:00:00Z','teleconsultation'),('${id(32)}','${id(21)}','booked','2099-01-02T00:00:00Z','2099-01-02T01:00:00Z','teleconsultation');
    insert into appointments select '${id(41)}','${id(11)}',id,provider_id,'pending',start_at,end_at,service_type from provider_availability where id='${id(31)}';
    insert into appointments select '${id(42)}','${id(12)}',id,provider_id,'pending',start_at,end_at,service_type from provider_availability where id='${id(32)}';`)
  const hash = (await db.query("select md5(pg_get_functiondef('audit_row_change()'::regprocedure)) as hash")).rows[0].hash
  const run = async (execute = false, plan = '', account = 'self@example.test') => {
    await db.exec('drop table if exists cleanup_result')
    const results = await db.exec(template.replace('__ACCOUNT_HEX__', Buffer.from(account).toString('hex')).replace('__EXECUTE__', String(execute)).replace('__EXPECTED_PLAN__', plan).replace('029e5060b6835942cc26da810b3eda97', hash))
    return results.at(-1).rows[0].summary
  }
  return { db, run }
}
describe('prepared Staging cleanup transaction', () => {
  it('previews without writes then deletes only Self and restores only its unreferenced booked slot', async () => {
    const { db, run } = await fixture()
    try {
      const preview = await run(); expect(preview).toMatchObject({ total: 1, linked_booked_slots: 1, executed: false, blocked: false })
      expect((await db.query('select count(*)::int as count from appointments')).rows[0].count).toBe(2)
      const result = await run(true, preview.plan_fingerprint)
      expect(result).toMatchObject({ appointments_deleted: 1, slots_restored: 1 })
      expect((await db.query('select patient_id from appointments')).rows).toEqual([{ patient_id: id(12) }])
      expect((await db.query('select status from provider_availability order by id')).rows).toEqual([{ status: 'available' }, { status: 'booked' }])
    } finally { await db.close() }
  })
  it('blocks clinical dependencies without deleting or cascading clinical records', async () => {
    const { db, run } = await fixture()
    try {
      await db.exec(`create table clinical_dependency(appointment_id uuid references appointments(id) on delete cascade); insert into clinical_dependency values('${id(41)}')`)
      expect((await run()).blocked).toBe(true)
      await expect(run(true)).rejects.toThrow(/Dependent records/)
      await db.exec('rollback')
      expect((await db.query('select count(*)::int as count from appointments')).rows[0].count).toBe(2)
      expect((await db.query('select count(*)::int as count from clinical_dependency')).rows[0].count).toBe(1)
    } finally { await db.close() }
  })
  it('refuses changed plans and unidentified accounts', async () => {
    const { db, run } = await fixture()
    try {
      const preview = await run()
      await db.exec(`update appointments set status='confirmed' where patient_id='${id(11)}'`)
      await expect(run(true, preview.plan_fingerprint)).rejects.toThrow(/changed since preview/)
      await db.exec('rollback')
      await expect(run(false, '', 'missing@example.test')).rejects.toThrow(/exactly one/)
    } finally { await db.close() }
  })
  it('blocks a slot shared with another patient instead of restoring their reservation', async () => {
    const { db, run } = await fixture()
    try {
      await db.exec(`update appointments set provider_availability_id='${id(31)}',scheduled_start='2099-01-01T00:00:00Z',scheduled_end='2099-01-01T01:00:00Z' where patient_id='${id(12)}'`)
      const preview = await run()
      expect(preview).toMatchObject({ blocked: true, shared_slot_reservations: 1 })
      await expect(run(true, preview.plan_fingerprint)).rejects.toThrow(/shared reservations/)
      await db.exec('rollback')
      expect((await db.query('select count(*)::int as count from appointments')).rows[0].count).toBe(2)
      expect((await db.query('select status from provider_availability order by id')).rows).toEqual([{ status: 'booked' }, { status: 'booked' }])
    } finally { await db.close() }
  })
})
