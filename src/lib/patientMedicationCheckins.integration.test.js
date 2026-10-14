// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012100000_patient_medication_checkins.sql'), 'utf8')
const uid = n => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db
const actor = async (n, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
const rpc = (medication, occurrence, request) => db.query(
  'select * from public.record_patient_medication_check_in($1::uuid,$2::smallint,$3::uuid)',
  [medication, occurrence, request],
)

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create table public.patients(id uuid primary key, auth_user_id uuid not null unique, status text not null);
    create table public.patient_medications(
      id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id),
      status text not null, frequency text, start_date date, end_date date,
      unique(id, patient_id)
    );
    grant select on public.patients, public.patient_medications to authenticated;
  `)
  await db.exec(migration)
  await db.exec('grant all on public.patient_medication_check_ins to service_role')
  await db.query('insert into public.patients(id,auth_user_id,status) values($1,$2,\'active\'),($3,$4,\'active\')', [uid(10), uid(1), uid(11), uid(2)])
  await db.query(`insert into public.patient_medications(id,patient_id,status,frequency,start_date)
    values($1,$2,'active','Once daily',current_date-1),($3,$2,'active','3 times daily',current_date-1),
      ($4,$2,'active','Every 8 hours as needed for pain',current_date-1),($5,$6,'active','Once daily',current_date-1)`,
  [uid(20), uid(10), uid(21), uid(22), uid(23), uid(11)])
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient-owned date-based medication check-ins', () => {
  it('stores date and occurrence identity without adding clock-time fields', async () => {
    const columns = (await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name='patient_medication_check_ins'`)).rows.map(row => row.column_name)
    expect(columns).toEqual(expect.arrayContaining(['patient_medication_id', 'patient_id', 'local_date', 'occurrence_index', 'is_prn', 'status', 'completed_at']))
    expect(columns).not.toEqual(expect.arrayContaining(['time_of_day', 'scheduled_at', 'timezone']))
  })

  it('records once-daily completion idempotently and leaves yesterday history intact', async () => {
    await actor(0, 'service_role')
    const day = (await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date as day")).rows[0].day
    const yesterday = (await db.query("select ((statement_timestamp() at time zone 'Asia/Yangon')::date-1) as day")).rows[0].day
    const prior = (await db.query(`insert into patient_medication_check_ins(patient_medication_id,patient_id,local_date,occurrence_index,request_id)
      values($1,$2,$3,1,$4) returning *`, [uid(20), uid(10), yesterday, uid(80)])).rows[0]
    await actor(1)
    const first = (await rpc(uid(20), 1, uid(81))).rows[0]
    const repeated = (await rpc(uid(20), 1, uid(82))).rows[0]
    expect(first.id).toBe(repeated.id)
    expect(String(first.local_date)).toBe(String(day))
    expect(first.status).toBe('taken')
    expect((await db.query('select count(*)::int as n from patient_medication_check_ins where patient_medication_id=$1', [uid(20)])).rows[0].n).toBe(2)
    expect(String((await db.query('select local_date from patient_medication_check_ins where id=$1', [prior.id])).rows[0].local_date)).toBe(String(yesterday))
    expect((await db.query('select status from patient_medication_check_ins where id=$1', [prior.id])).rows[0].status).toBe('taken')
  })

  it('keeps three daily occurrences independent and protects duplicate requests', async () => {
    await actor(1)
    const one = (await rpc(uid(21), 1, uid(83))).rows[0]
    const duplicate = (await rpc(uid(21), 1, uid(84))).rows[0]
    const two = (await rpc(uid(21), 2, uid(85))).rows[0]
    const three = (await rpc(uid(21), 3, uid(86))).rows[0]
    expect(duplicate.id).toBe(one.id)
    expect([one.occurrence_index, two.occurrence_index, three.occurrence_index]).toEqual([1, 2, 3])
    expect((await db.query('select count(*)::int as n from patient_medication_check_ins where patient_medication_id=$1 and local_date=$2', [uid(21), one.local_date])).rows[0].n).toBe(3)
    await expect(rpc(uid(21), 4, uid(87))).rejects.toMatchObject({ code: '22023' })
  })

  it('records only actual PRN use and returns the same row for a retried request', async () => {
    await actor(1)
    const first = (await rpc(uid(22), null, uid(88))).rows[0]
    const retry = (await rpc(uid(22), null, uid(88))).rows[0]
    const secondActualIntake = (await rpc(uid(22), null, uid(89))).rows[0]
    expect(retry.id).toBe(first.id)
    expect(first.is_prn).toBe(true)
    expect(secondActualIntake.occurrence_index).toBe(2)
    expect((await db.query('select count(*)::int as n from patient_medication_check_ins where patient_medication_id=$1', [uid(22)])).rows[0].n).toBe(2)
    await expect(rpc(uid(22), 1, uid(90))).rejects.toMatchObject({ code: '22023' })
  })

  it('keeps PRN and required-dose records separate if frequency changes within a day', async () => {
    await actor(1)
    const prn = (await rpc(uid(22), null, uid(95))).rows[0]
    await db.exec('reset role')
    await db.query("update patient_medications set frequency='Once daily' where id=$1", [uid(22)])
    await actor(1)
    const scheduled = (await rpc(uid(22), 1, uid(96))).rows[0]
    expect(scheduled.id).not.toBe(prn.id)
    expect(scheduled.occurrence_index).toBe(prn.occurrence_index)
    expect(scheduled.is_prn).toBe(false)
    expect(prn.is_prn).toBe(true)
  })

  it('denies cross-patient writes and direct authenticated table mutations', async () => {
    await actor(1)
    await db.exec('savepoint cross_patient_write')
    await expect(rpc(uid(23), 1, uid(91))).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_patient_write')
    await db.exec('savepoint direct_write')
    await expect(db.query(`insert into patient_medication_check_ins(patient_medication_id,patient_id,local_date,occurrence_index,request_id)
      values($1,$2,current_date,1,$3)`, [uid(20), uid(10), uid(92)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint direct_write')
    const created = (await rpc(uid(21), 1, uid(94))).rows[0]
    await db.exec('savepoint direct_update')
    await expect(db.query("update patient_medication_check_ins set status='taken' where id=$1", [created.id])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint direct_update')
    await db.exec('savepoint direct_delete')
    await expect(db.query('delete from patient_medication_check_ins where id=$1', [created.id])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint direct_delete')
    await actor(0, 'service_role')
    const other = (await db.query(`insert into patient_medication_check_ins(patient_medication_id,patient_id,local_date,occurrence_index,request_id)
      values($1,$2,current_date,1,$3) returning id`, [uid(23), uid(11), uid(93)])).rows[0]
    await actor(1)
    expect((await db.query('select id from patient_medication_check_ins')).rows).toEqual([{ id: created.id }])
    await actor(2)
    expect((await db.query('select id from patient_medication_check_ins')).rows).toEqual([{ id: other.id }])
  })
})
