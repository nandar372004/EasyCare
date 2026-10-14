// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012110000_patient_owned_health_goals.sql'), 'utf8')
const uid = n => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db
const actor = async (n, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
const create = title => db.query('select * from public.create_my_patient_health_goal($1)', [title])
const complete = (goalId, state) => db.query('select * from public.set_my_patient_health_goal_completion($1,$2)', [goalId, state])
const remove = goalId => db.query('select public.delete_my_patient_health_goal($1)', [goalId])

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
  await db.exec('grant all on public.patient_health_goals to service_role')
  await db.query('insert into public.patients(id,auth_user_id,status) values($1,$2,\'active\'),($3,$4,\'active\')', [uid(10), uid(1), uid(11), uid(2)])
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient-owned health goals', () => {
  it('enables RLS, permits only own reads, and denies direct browser writes', async () => {
    const meta = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('authenticated','public.patient_health_goals','select') as can_read,
      has_table_privilege('authenticated','public.patient_health_goals','insert') as can_insert,
      has_table_privilege('authenticated','public.patient_health_goals','update') as can_update,
      has_table_privilege('authenticated','public.patient_health_goals','delete') as can_delete,
      has_table_privilege('anon','public.patient_health_goals','select') as anon_read
      from pg_class c where c.oid='public.patient_health_goals'::regclass`)).rows[0]
    expect(meta).toEqual({ rls: true, can_read: true, can_insert: false, can_update: false, can_delete: false, anon_read: false })

    await actor(0, 'service_role')
    const foreign = (await db.query("insert into public.patient_health_goals(patient_id,title) values($1,'Other patient goal') returning id,title", [uid(11)])).rows[0]
    await actor(1)
    expect((await db.query('select id,title from public.patient_health_goals')).rows).toEqual([])
    await db.exec('savepoint direct_goal_insert')
    await expect(db.query(`insert into public.patient_health_goals(patient_id,title) values($1,'forbidden')`, [uid(10)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint direct_goal_insert')
    expect(foreign.title).toBe('Other patient goal')
  })

  it('creates a goal for the authenticated patient, trims title, and enforces 1–200 characters', async () => {
    await actor(1)
    const goal = (await create('  Walk after lunch  ')).rows[0]
    expect(goal).toMatchObject({ patient_id: uid(10), title: 'Walk after lunch', is_completed: false, completed_at: null })
    await db.exec('savepoint empty_goal')
    await expect(create('    ')).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint empty_goal')
    await db.exec('savepoint whitespace_goal')
    await expect(create('\t\n')).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint whitespace_goal')
    await db.exec('savepoint long_goal')
    await expect(create('x'.repeat(201))).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint long_goal')
    expect((await db.query('select id from public.patient_health_goals')).rows).toEqual([{ id: goal.id }])
  })

  it('persists completion and reopening, clears completed_at, and deletes only the owned goal', async () => {
    await actor(1)
    const goal = (await create('Walk daily')).rows[0]
    const completed = (await complete(goal.id, true)).rows[0]
    expect(completed.is_completed).toBe(true)
    expect(completed.completed_at).not.toBeNull()
    const reopened = (await complete(goal.id, false)).rows[0]
    expect(reopened).toMatchObject({ is_completed: false, completed_at: null })
    await remove(goal.id)
    expect((await db.query('select * from public.patient_health_goals')).rows).toEqual([])
  })

  it('denies cross-patient update and delete', async () => {
    await actor(0, 'service_role')
    const foreign = (await db.query(`insert into public.patient_health_goals(patient_id,title)
      values($1,'Private goal') returning id`, [uid(11)])).rows[0]
    await actor(1)
    await db.exec('savepoint cross_goal_update')
    await expect(complete(foreign.id, true)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_goal_update')
    await db.exec('savepoint cross_goal_delete')
    await expect(remove(foreign.id)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_goal_delete')
    expect((await db.query('select id from public.patient_health_goals')).rows).toEqual([])
  })
})
