// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261012130000_patient_owned_lifestyle_plans.sql'), 'utf8')
const uid = n => `a4000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db
const actor = async (n, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
const savePlan = (id, title, description = null, category = null) => db.query(
  'select * from public.save_my_patient_lifestyle_plan($1::uuid,$2,$3,$4)', [id, title, description, category],
)
const saveResource = (planId, resourceId, title, url) => db.query(
  'select * from public.save_my_patient_lifestyle_resource($1::uuid,$2::uuid,$3,$4)', [planId, resourceId, title, url],
)
const deactivate = id => db.query('select * from public.deactivate_my_patient_lifestyle_plan($1)', [id])

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
  await db.exec('grant all on public.patient_lifestyle_plans, public.patient_lifestyle_resources to service_role')
  await db.query("insert into public.patients(id,auth_user_id,status) values($1,$2,'active'),($3,$4,'active')", [uid(10), uid(1), uid(11), uid(2)])
}, 30000)
beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient-owned lifestyle plans and resources', () => {
  it('enables RLS and denies anonymous access and direct browser writes', async () => {
    const tables = (await db.query(`select relname,relrowsecurity from pg_class where oid in
      ('public.patient_lifestyle_plans'::regclass,'public.patient_lifestyle_resources'::regclass) order by relname`)).rows
    expect(tables).toEqual([{ relname: 'patient_lifestyle_plans', relrowsecurity: true }, { relname: 'patient_lifestyle_resources', relrowsecurity: true }])
    for (const table of ['patient_lifestyle_plans', 'patient_lifestyle_resources']) {
      expect((await db.query(`select has_table_privilege('authenticated','public.${table}','select') as read,
        has_table_privilege('authenticated','public.${table}','insert') as insert,
        has_table_privilege('authenticated','public.${table}','update') as update,
        has_table_privilege('authenticated','public.${table}','delete') as delete,
        has_table_privilege('anon','public.${table}','select') as anon_read`)).rows[0]).toEqual({ read: true, insert: false, update: false, delete: false, anon_read: false })
    }
    expect((await db.query("select has_function_privilege('anon','public.save_my_patient_lifestyle_plan(uuid,text,text,text)','execute') as rpc_anon")).rows[0].rpc_anon).toBe(false)
    await actor(0, 'anon')
    await db.exec('savepoint anon_lifestyle_read')
    await expect(db.query('select id from patient_lifestyle_plans')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anon_lifestyle_read')
  })

  it('creates, edits, reads and deactivates only the authenticated patient plan', async () => {
    await actor(1)
    const plan = (await savePlan(null, '  Better Sleep  ', '  Regular bedtime  ', 'sleep')).rows[0]
    expect(plan).toMatchObject({ patient_id: uid(10), title: 'Better Sleep', description: 'Regular bedtime', category: 'sleep', is_active: true })
    expect((await db.query('select id,title from patient_lifestyle_plans')).rows).toEqual([{ id: plan.id, title: 'Better Sleep' }])
    const edited = (await savePlan(plan.id, 'Sleep Better', 'Wind down before bed.', 'general_wellness')).rows[0]
    expect(edited).toMatchObject({ id: plan.id, title: 'Sleep Better', description: 'Wind down before bed.', category: 'general_wellness' })
    expect((await deactivate(plan.id)).rows[0].is_active).toBe(false)
    expect((await db.query('select is_active from patient_lifestyle_plans where id=$1', [plan.id])).rows[0].is_active).toBe(false)
  })

  it('manages safe website and YouTube resources and preserves ownership linkage', async () => {
    await actor(1)
    const plan = (await savePlan(null, 'Exercise Routine', 'Walk each day.', 'exercise')).rows[0]
    const youtube = (await saveResource(plan.id, null, 'Workout', 'https://youtu.be/abc123')).rows[0]
    expect(youtube).toMatchObject({ lifestyle_plan_id: plan.id, patient_id: uid(10), resource_type: 'youtube', url: 'https://youtu.be/abc123' })
    const website = (await saveResource(plan.id, null, null, 'https://example.com/guide')).rows[0]
    expect(website).toMatchObject({ resource_type: 'website', title: null })
    const edited = (await saveResource(plan.id, youtube.id, 'Updated workout', 'https://youtube.com/watch?v=abc')).rows[0]
    expect(edited).toMatchObject({ id: youtube.id, title: 'Updated workout', resource_type: 'youtube' })
    await db.query('select public.delete_my_patient_lifestyle_resource($1,$2)', [plan.id, website.id])
    expect((await db.query('select id from patient_lifestyle_resources where lifestyle_plan_id=$1', [plan.id])).rows).toEqual([{ id: youtube.id }])
    await db.exec('savepoint bad_protocol')
    await expect(saveResource(plan.id, null, null, 'javascript:alert(1)')).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint bad_protocol')
    await db.exec('savepoint bad_host')
    await expect(saveResource(plan.id, null, null, 'https:///bad')).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint bad_host')
    await db.exec('savepoint malformed_port')
    await expect(saveResource(plan.id, null, null, 'https://example.com:bad')).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback to savepoint malformed_port')
  })

  it('denies cross-patient plan/resource reads and every cross-patient mutation', async () => {
    await actor(0, 'service_role')
    const plan = (await db.query(`insert into patient_lifestyle_plans(patient_id,title) values($1,'Private plan') returning id`, [uid(11)])).rows[0]
    const resource = (await db.query(`insert into patient_lifestyle_resources(lifestyle_plan_id,patient_id,url,resource_type)
      values($1,$2,'https://example.com','website') returning id`, [plan.id, uid(11)])).rows[0]
    await actor(1)
    expect((await db.query('select id from patient_lifestyle_plans')).rows).toEqual([])
    expect((await db.query('select id from patient_lifestyle_resources')).rows).toEqual([])
    await db.exec('savepoint cross_plan_update')
    await expect(savePlan(plan.id, 'Take over')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_plan_update')
    await db.exec('savepoint cross_plan_deactivate')
    await expect(deactivate(plan.id)).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_plan_deactivate')
    await db.exec('savepoint cross_resource_write')
    await expect(saveResource(plan.id, resource.id, 'Steal link', 'https://evil.example')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_resource_write')
    await db.exec('savepoint cross_resource_delete')
    await expect(db.query('select public.delete_my_patient_lifestyle_resource($1,$2)', [plan.id, resource.id])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint cross_resource_delete')
  })
})
