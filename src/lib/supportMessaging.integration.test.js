// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migration = [
  'supabase/migrations/20261012150000_patient_support_messaging.sql',
  'supabase/migrations/20261012160000_support_messaging_private_broadcast.sql',
].map(path => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')
const uid = n => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db

const actor = async (n, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}
const designate = n => db.query('select public.admin_set_designated_support_profile($1)', [uid(n)])
const openConversation = () => db.query('select * from public.get_or_create_my_support_conversation()')
const listPatientMessages = id => db.query('select * from public.list_my_support_messages($1)', [id])
const sendPatientMessage = (id, body) => db.query('select * from public.send_my_support_message($1,$2)', [id, body])
const listSupportInbox = () => db.query('select * from public.admin_list_support_conversations()')
const listSupportMessages = id => db.query('select * from public.admin_list_support_messages($1)', [id])
const replyAsSupport = (id, body) => db.query('select * from public.admin_send_support_reply($1,$2)', [id, body])
const expectDenied = async (run, code = '42501') => {
  await db.exec('savepoint expected_support_failure')
  await expect(run()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint expected_support_failure')
  await db.exec('release savepoint expected_support_failure')
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create type public.profile_role as enum ('patient','family','admin','main_admin','provider');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles(
      id uuid primary key,
      role public.profile_role not null,
      status text not null,
      full_name text not null
    );
    create table public.patients(
      id uuid primary key,
      profile_id uuid unique references public.profiles(id),
      auth_user_id uuid not null unique references public.profiles(id)
    );
    create function public.is_main_admin() returns boolean language sql stable security definer set search_path=''
      as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','main_admin') and p.status='active') $$;
    create schema realtime;
    create table realtime.messages(extension text not null,topic text not null,payload jsonb not null);
    alter table realtime.messages enable row level security;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable
      as $$ select nullif(current_setting('request.realtime.topic',true),'') $$;
    create function realtime.send(jsonb,text,text,boolean) returns void language plpgsql security definer set search_path=''
      as $$ begin
        if current_setting('test.realtime.fail',true)='true' then raise exception 'Realtime unavailable'; end if;
        insert into realtime.messages(extension,topic,payload) values('broadcast',$3,jsonb_build_object('event',$2,'payload',$1,'private',$4));
      end $$;
    grant usage on schema public,auth,realtime to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant execute on function realtime.topic() to authenticated;
  `)
  await db.exec(migration)
  await db.query(`insert into public.profiles(id,role,status,full_name) values
    ($1,'patient','active','Patient A'),($2,'patient','active','Patient B'),
    ($3,'admin','active','Support Admin'),($4,'admin','active','Other Admin'),
    ($5,'provider','active','Provider')`, [uid(1), uid(2), uid(90), uid(91), uid(80)])
  await db.query('insert into public.patients(id,profile_id,auth_user_id) values($1,$2,$2),($3,$4,$4)', [uid(101), uid(1), uid(102), uid(2)])
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient support messaging backend', () => {
  it('enables RLS and denies direct table access to browser roles', async () => {
    const rows = (await db.query(`select c.relname,c.relrowsecurity as rls,
      has_table_privilege('authenticated',format('public.%I',c.relname),'select') as auth_read,
      has_table_privilege('authenticated',format('public.%I',c.relname),'insert') as auth_insert,
      has_table_privilege('authenticated',format('public.%I',c.relname),'update') as auth_update,
      has_table_privilege('authenticated',format('public.%I',c.relname),'delete') as auth_delete,
      has_table_privilege('anon',format('public.%I',c.relname),'select') as anon_read
      from pg_class c where c.oid in ('public.support_routing_settings'::regclass,
        'public.support_conversations'::regclass,'public.support_messages'::regclass)
      order by c.relname`)).rows
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toMatchObject({ rls: true, auth_read: false, auth_insert: false, auth_update: false, auth_delete: false, anon_read: false })
  })

  it('requires an explicit designated admin and creates at most one active patient conversation', async () => {
    await actor(1)
    await expectDenied(() => openConversation(), '55000')

    await actor(90)
    await expectDenied(() => designate(80), '22023')
    await designate(90)
    await actor(1)
    const first = (await openConversation()).rows[0]
    const second = (await openConversation()).rows[0]
    expect(first.conversation_id).toBe(second.conversation_id)
    await db.exec('reset role')
    expect((await db.query('select count(*)::int as total from public.support_conversations where patient_id=$1 and status=\'active\'', [uid(101)])).rows[0].total).toBe(1)
    expect((await db.query('select assigned_support_profile_id from public.support_conversations where id=$1', [first.conversation_id])).rows[0].assigned_support_profile_id).toBe(uid(90))
  })

  it('persists patient messages, exposes them to the designated admin, and persists admin replies', async () => {
    await actor(90)
    await designate(90)
    await actor(1)
    const conversation = (await openConversation()).rows[0]
    const sent = (await sendPatientMessage(conversation.conversation_id, '  Please help with my appointment.  ')).rows[0]
    expect(sent.body).toBe('Please help with my appointment.')
    expect((await listPatientMessages(conversation.conversation_id)).rows).toMatchObject([
      { message_id: sent.message_id, body: 'Please help with my appointment.', sender_is_patient: true },
    ])

    await actor(90)
    expect((await listSupportInbox()).rows[0]).toMatchObject({
      conversation_id: conversation.conversation_id, patient_id: uid(101), patient_name: 'Patient A',
      latest_message: 'Please help with my appointment.',
    })
    expect((await listSupportMessages(conversation.conversation_id)).rows[0].sender_is_support).toBe(false)
    const reply = (await replyAsSupport(conversation.conversation_id, 'I can help coordinate that.')).rows[0]
    expect((await listSupportMessages(conversation.conversation_id)).rows).toHaveLength(2)

    await actor(1)
    expect((await listPatientMessages(conversation.conversation_id)).rows).toMatchObject([
      { message_id: sent.message_id, sender_is_patient: true },
      { message_id: reply.message_id, body: 'I can help coordinate that.', sender_is_patient: false },
    ])
  })

  it('denies cross-patient reads and sends, direct sender forging, and arbitrary admin inbox access', async () => {
    await actor(90)
    await designate(90)
    await actor(1)
    const own = (await openConversation()).rows[0]
    await expectDenied(() => designate(91))
    await actor(2)
    const other = (await openConversation()).rows[0]
    await actor(1)
    await expectDenied(() => listPatientMessages(other.conversation_id))
    await expectDenied(() => sendPatientMessage(other.conversation_id, 'cross-patient'))
    await db.exec('savepoint forged_sender')
    await expect(db.query(`insert into public.support_messages(conversation_id,sender_profile_id,body)
      values($1,$2,'forged')`, [own.conversation_id, uid(90)])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint forged_sender')

    await actor(91)
    await expectDenied(() => listSupportInbox())
    await expectDenied(() => listSupportMessages(own.conversation_id))
    await expectDenied(() => replyAsSupport(own.conversation_id, 'not designated'))
    await actor(80)
    await expectDenied(() => listSupportInbox())
  })

  it('denies anonymous access and validates trimmed message bodies at the RPC boundary', async () => {
    await actor(90)
    await designate(90)
    await actor(1)
    const conversation = (await openConversation()).rows[0]
    for (const body of ['', '   \t\n', 'x'.repeat(4001)]) {
      await db.exec('savepoint invalid_support_message')
      await expectDenied(() => sendPatientMessage(conversation.conversation_id, body), '22023')
      await db.exec('rollback to savepoint invalid_support_message')
    }
    await actor(0, 'anon')
    await expectDenied(() => openConversation())
    await expectDenied(() => listPatientMessages(conversation.conversation_id))
  })

  it('broadcasts only a message_changed hint and authorizes private patient/admin topics', async () => {
    await actor(90)
    await designate(90)
    await actor(1)
    const patientA = (await openConversation()).rows[0]
    await sendPatientMessage(patientA.conversation_id, 'Private message body must not be broadcast')
    await actor(2)
    const patientB = (await openConversation()).rows[0]

    await actor(1)
    const patientTopic = `support:${patientA.conversation_id}`
    await db.query("select set_config('request.realtime.topic',$1,true)", [patientTopic])
    const ownEvents = (await db.query('select payload from realtime.messages')).rows
    expect(ownEvents).toHaveLength(1)
    expect(ownEvents[0].payload).toMatchObject({ event: 'message_changed', payload: { conversation_id: patientA.conversation_id, event: 'message_changed' }, private: true })
    expect(JSON.stringify(ownEvents[0].payload)).not.toContain('Private message body')
    expect((await db.query('select public.can_receive_support_realtime_topic($1) as allowed', [`support:${patientB.conversation_id}`])).rows[0].allowed).toBe(false)

    await actor(90)
    const adminTopic = `support:admin:${uid(90)}`
    await db.query("select set_config('request.realtime.topic',$1,true)", [adminTopic])
    expect((await db.query('select public.can_receive_support_realtime_topic($1) as allowed', [adminTopic])).rows[0].allowed).toBe(true)
    expect((await db.query('select count(*)::int as count from realtime.messages')).rows[0].count).toBe(1)

    await actor(91)
    expect((await db.query('select public.can_receive_support_realtime_topic($1) as allowed', [adminTopic])).rows[0].allowed).toBe(false)
    await actor(0, 'anon')
    await expect(db.query('select public.can_receive_support_realtime_topic($1)', [patientTopic])).rejects.toMatchObject({ code: '42501' })
  })

  it('keeps durable messaging successful when Realtime broadcast delivery fails', async () => {
    await actor(90)
    await designate(90)
    await actor(1)
    const conversation = (await openConversation()).rows[0]
    await db.query("select set_config('test.realtime.fail','true',true)")
    const sent = (await sendPatientMessage(conversation.conversation_id, 'Durable despite broadcast outage')).rows[0]
    expect(sent.body).toBe('Durable despite broadcast outage')
    expect((await listPatientMessages(conversation.conversation_id)).rows).toMatchObject([
      { message_id: sent.message_id, body: 'Durable despite broadcast outage', sender_is_patient: true },
    ])
  })
})
