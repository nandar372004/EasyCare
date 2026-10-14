// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012120000_patient_owned_monitoring_plans.sql'), 'utf8')
const measurementMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012180000_patient_monitoring_measurements.sql'), 'utf8')
const uid = n => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db
const actor = async (n, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
const savePlan = (id, title, recurrence, days, start, end = null, times = []) => db.query(
  'select * from public.save_my_patient_monitoring_plan($1::uuid,$2,$3,$4,$5,$6::smallint[],$7::date,$8::date,$9::time[])',
  [id, title, null, null, recurrence, days, start, end, times],
)
const record = (planId, date, occurrence, done, value = null, unit = null) => db.query(
  'select * from public.record_my_patient_monitoring_check_in($1::uuid,$2::date,$3,$4,$5,$6,null)',
  [planId, date, occurrence, done, value, unit],
)
const savePlanV2 = (title, days, start) => db.query(
  "select * from public.save_my_patient_monitoring_plan_v2(null,$1,null,null,'selected_days',$2::smallint[],$3,null,'{}'::time[],'blood_pressure','mmHg')",
  [title, days, start],
)
const saveWeightPlan = (title, start) => db.query(
  "select * from public.save_my_patient_monitoring_plan_v2(null,$1,null,null,'daily','{}'::smallint[],$2,null,'{}'::time[],'weight','kg')",
  [title, start],
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
    grant select on public.patients to authenticated;
  `)
  await db.exec(migration)
  await db.exec(measurementMigration)
  await db.exec('grant all on public.patient_monitoring_plans, public.patient_monitoring_plan_times, public.patient_monitoring_check_ins to service_role')
  await db.query('insert into public.patients(id,auth_user_id,status) values($1,$2,\'active\'),($3,$4,\'active\')', [uid(10), uid(1), uid(11), uid(2)])
}, 30000)
beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient-owned monitoring routines and date-scoped check-ins', () => {
  it('enables owner-only reads and denies direct or anonymous writes', async () => {
    const meta = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('authenticated','public.patient_monitoring_plans','select') as own_read,
      has_table_privilege('authenticated','public.patient_monitoring_plans','insert') as direct_insert,
      has_table_privilege('authenticated','public.patient_monitoring_check_ins','update') as direct_update,
      has_table_privilege('authenticated','public.patient_monitoring_check_ins','delete') as direct_delete,
      has_table_privilege('anon','public.patient_monitoring_plans','select') as anon_read,
      has_function_privilege('anon','public.save_my_patient_monitoring_plan(uuid,text,text,text,text,smallint[],date,date,time[])','execute') as anon_rpc,
      has_function_privilege('anon','public.save_my_patient_monitoring_plan_v2(uuid,text,text,text,text,smallint[],date,date,time[],text,text)','execute') as anon_measurement_plan_rpc,
      has_function_privilege('anon','public.record_my_patient_monitoring_measurement(uuid,date,text,numeric,numeric,numeric,text,text)','execute') as anon_measurement_rpc
      from pg_class c where c.oid='public.patient_monitoring_plans'::regclass`)).rows[0]
    expect(meta).toEqual({ rls: true, own_read: true, direct_insert: false, direct_update: false, direct_delete: false, anon_read: false, anon_rpc: false, anon_measurement_plan_rpc: false, anon_measurement_rpc: false })
    const allRls = (await db.query(`select bool_and(relrowsecurity) as enabled from pg_class
      where oid in ('public.patient_monitoring_plans'::regclass,'public.patient_monitoring_plan_times'::regclass,'public.patient_monitoring_check_ins'::regclass)`)).rows[0]
    expect(allRls.enabled).toBe(true)
    await actor(0, 'service_role')
    const foreign = (await db.query("insert into patient_monitoring_plans(patient_id,title,recurrence_type,start_date) values($1,'Private plan','daily','2026-10-01') returning id,patient_id", [uid(11)])).rows[0]
    await actor(1)
    expect((await db.query('select id from patient_monitoring_plans')).rows).toEqual([])
    await db.exec('savepoint direct_plan_write')
    await expect(db.query("insert into patient_monitoring_plans(patient_id,title,recurrence_type,start_date) values($1,'No','daily',current_date)", [uid(10)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint direct_plan_write')
    expect(foreign.patient_id).toBe(uid(11))
    await db.exec('savepoint anon_plan_read')
    await actor(0, 'anon')
    await expect(db.query('select id from patient_monitoring_plans')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anon_plan_read')
  })

  it('creates routines with daily, selected-day and one-time recurrence, with multiple optional times', async () => {
    await actor(1)
    const date = (await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date::text as day")).rows[0].day
    const daily = (await savePlan(null, 'Blood pressure', 'daily', [], date, null, ['09:00','18:00'])).rows[0]
    expect(daily.patient_id).toBe(uid(10))
    expect((await db.query('select time_of_day::text from patient_monitoring_plan_times where monitoring_plan_id=$1 order by time_of_day', [daily.id])).rows.map(row => row.time_of_day)).toEqual(['09:00:00','18:00:00'])
    const weekday = (await db.query('select extract(dow from $1::date)::smallint as day', [date])).rows[0].day
    const selected = (await savePlan(null, 'Walking', 'selected_days', [weekday], date, null, [])).rows[0]
    const once = (await savePlan(null, 'One time check', 'once', [], date, null, [])).rows[0]
    expect(selected.recurrence_type).toBe('selected_days')
    expect(once.recurrence_type).toBe('once')
    expect((await db.query('select count(*)::int as count from patient_monitoring_plan_times where monitoring_plan_id=$1', [once.id])).rows[0].count).toBe(0)
    await db.exec('savepoint empty_days')
    await expect(savePlan(null, 'Invalid', 'selected_days', [], date)).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint empty_days')
  })

  it('stores independent date and occurrence check-ins, measurement values, reopen state, and history', async () => {
    await actor(1)
    const dates = (await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date::text as today, ((statement_timestamp() at time zone 'Asia/Yangon')::date-1)::text as yesterday")).rows[0]
    const plan = (await savePlan(null, 'Measure blood pressure', 'daily', [], dates.yesterday, null, ['09:00','18:00'])).rows[0]
    const times = (await db.query('select id from patient_monitoring_plan_times where monitoring_plan_id=$1 order by time_of_day', [plan.id])).rows
    const done = (await record(plan.id, dates.today, times[0].id, true, '128 / 82', 'mmHg')).rows[0]
    const retry = (await record(plan.id, dates.today, times[0].id, true, '128 / 82', 'mmHg')).rows[0]
    expect(retry.id).toBe(done.id)
    expect(done).toMatchObject({ status: 'done', measurement_value: '128 / 82', measurement_unit: 'mmHg' })
    expect((await db.query('select status,completed_at from patient_monitoring_check_ins where id=$1', [done.id])).rows[0]).toMatchObject({ status: 'done', completed_at: expect.anything() })
    const reopened = (await record(plan.id, dates.today, times[0].id, false, '128 / 82', 'mmHg')).rows[0]
    expect(reopened).toMatchObject({ status: 'open', completed_at: null })
    const secondTime = (await record(plan.id, dates.today, times[1].id, true)).rows[0]
    const yesterday = (await record(plan.id, dates.yesterday, times[0].id, true)).rows[0]
    expect(secondTime.id).not.toBe(done.id)
    expect(yesterday.id).not.toBe(done.id)
    expect((await db.query('select local_date::text,status from patient_monitoring_check_ins where id=$1', [yesterday.id])).rows[0]).toEqual({ local_date: dates.yesterday, status: 'done' })
    expect((await db.query('select count(*)::int as count from patient_monitoring_check_ins where monitoring_plan_id=$1 and local_date=$2', [plan.id, dates.today])).rows[0].count).toBe(2)
  })

  it('validates schedule dates and occurrence keys, and keeps history after schedule edits and deactivation', async () => {
    await actor(1)
    const dates = (await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date::text as today, ((statement_timestamp() at time zone 'Asia/Yangon')::date-1)::text as yesterday")).rows[0]
    const once = (await savePlan(null, 'One time', 'once', [], dates.yesterday)).rows[0]
    await db.exec('savepoint one_time_wrong_date')
    await expect(record(once.id, dates.today, 'any', true)).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint one_time_wrong_date')
    const plan = (await savePlan(null, 'Daily routine', 'daily', [], dates.yesterday, null, ['08:00'])).rows[0]
    const timeId = (await db.query('select id from patient_monitoring_plan_times where monitoring_plan_id=$1', [plan.id])).rows[0].id
    const checkIn = (await record(plan.id, dates.yesterday, timeId, true)).rows[0]
    expect(checkIn.occurrence_label).toBe('8:00 AM')
    await savePlan(plan.id, 'Edited routine', 'daily', [], dates.yesterday, null, ['18:00'])
    expect((await db.query('select count(*)::int as count, max(occurrence_label) as label from patient_monitoring_check_ins where id=$1', [checkIn.id])).rows[0]).toEqual({ count: 1, label: '8:00 AM' })
    await db.query('select * from public.deactivate_my_patient_monitoring_plan($1)', [plan.id])
    expect((await db.query('select is_active from patient_monitoring_plans where id=$1', [plan.id])).rows[0].is_active).toBe(false)
    expect((await db.query('select count(*)::int as count from patient_monitoring_check_ins where id=$1', [checkIn.id])).rows[0].count).toBe(1)
    await expect(record(plan.id, dates.today, 'any', true)).rejects.toMatchObject({ code: '42501' })
  })

  it('denies cross-patient read and check-in writes', async () => {
    await actor(0, 'service_role')
    const foreign = (await db.query(`insert into patient_monitoring_plans(patient_id,title,recurrence_type,start_date)
      values($1,'Foreign routine','daily',current_date-1) returning id`, [uid(11)])).rows[0]
    await actor(1)
    expect((await db.query('select id from patient_monitoring_plans')).rows).toEqual([])
    await db.exec('savepoint cross_patient')
    const today = (await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date::text as day")).rows[0].day
    await expect(record(foreign.id, today, 'any', true)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_patient')
    await db.exec('savepoint cross_patient_edit')
    await expect(savePlan(foreign.id, 'Take over plan', 'daily', [], today)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_patient_edit')
    await db.exec('savepoint cross_patient_deactivate')
    await expect(db.query('select * from public.deactivate_my_patient_monitoring_plan($1)', [foreign.id])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_patient_deactivate')
  })

  it('stores separately validated BP values by scheduled date, retains check-in time and denies cross-patient measurement writes', async () => {
    await actor(1)
    const plan = (await savePlanV2('Blood Pressure', [1,3,5], '2026-10-01')).rows[0]
    const checked = (await db.query(`select * from public.record_my_patient_monitoring_measurement(
      $1::uuid,'2026-10-12'::date,'any',125::numeric,80::numeric,null::numeric,'mmHg',null)`, [plan.id])).rows[0]
    expect(checked.local_date.toISOString().slice(0,10)).toBe('2026-10-12')
    expect(checked).toMatchObject({ patient_id: uid(10), status: 'done', systolic_value: '125', diastolic_value: '80', measurement_value: null })
    expect(checked.completed_at).toBeTruthy()
    const edited = (await db.query(`select * from public.record_my_patient_monitoring_measurement(
      $1::uuid,'2026-10-12'::date,'any',126::numeric,81::numeric,null::numeric,'mmHg',null)`, [plan.id])).rows[0]
    expect(edited.id).toBe(checked.id)
    expect(edited).toMatchObject({ systolic_value: '126', diastolic_value: '81' })
    await db.exec('savepoint invalid_bp')
    await expect(db.query(`select * from public.record_my_patient_monitoring_measurement(
      $1::uuid,'2026-10-13'::date,'any',126::numeric,null::numeric,null::numeric,'mmHg',null)`, [plan.id])).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint invalid_bp')
    await db.exec('savepoint foreign_bp')
    await actor(2)
    await expect(db.query(`select * from public.record_my_patient_monitoring_measurement(
      $1::uuid,'2026-10-12'::date,'any',126::numeric,81::numeric,null::numeric,'mmHg',null)`, [plan.id])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint foreign_bp')
  })

  it('keeps the single-value measurement path working with the routine-defined unit', async () => {
    await actor(1)
    const plan = (await saveWeightPlan('Weight', '2026-10-01')).rows[0]
    const checked = (await db.query(`select * from public.record_my_patient_monitoring_measurement(
      $1::uuid,'2026-10-12'::date,'any',null::numeric,null::numeric,58.5::numeric,'kg',null)`, [plan.id])).rows[0]
    expect(checked).toMatchObject({ patient_id: uid(10), status: 'done', measurement_value: '58.5', measurement_unit: 'kg', systolic_value: null, diastolic_value: null })
    expect(checked.local_date.toISOString().slice(0,10)).toBe('2026-10-12')
    expect(checked.completed_at).toBeTruthy()
  })
})
