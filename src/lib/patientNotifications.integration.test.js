// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const uid = n => `a9000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const migrations = [
  '20261012150000_patient_support_messaging.sql',
  '20261012160000_support_messaging_private_broadcast.sql',
  '20261012170000_patient_notification_center.sql',
].map(name => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')).join('\n')
let db

async function actor(n, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [n ? uid(n) : ''])
  await db.exec(`set local role ${role}`)
}

const conversationForPatient = async () => (await db.query('select * from public.get_or_create_my_support_conversation()')).rows[0]
async function expectDenied(run) {
  await db.exec('savepoint expected_notification_denial')
  await expect(run()).rejects.toMatchObject({ code: '42501' })
  await db.exec('rollback to savepoint expected_notification_denial')
  await db.exec('release savepoint expected_notification_denial')
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type public.profile_role as enum ('patient','family','admin','main_admin','provider');
    create type public.notification_type as enum ('booking','visit_status','medication','follow_up','health_alert','family_update');
    create type public.notification_channel as enum ('in_app','push','sms','phone','messenger','viber');
    create type public.notification_status as enum ('queued','sent','delivered','failed','read');
    create type public.alert_status as enum ('open','acknowledged','escalated','resolved');
    create table public.profiles(id uuid primary key, role public.profile_role not null, status text not null, full_name text not null);
    create table public.patients(id uuid primary key, profile_id uuid unique references public.profiles(id), auth_user_id uuid unique references public.profiles(id), status text not null default 'active');
    create function public.is_main_admin() returns boolean language sql stable security definer set search_path='' as
      $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','main_admin') and p.status='active') $$;
    create table public.notifications(
      id uuid primary key default gen_random_uuid(), recipient_profile_id uuid not null references public.profiles(id),
      patient_id uuid references public.patients(id), type public.notification_type not null,
      channel public.notification_channel not null, title text not null, body text not null,
      status public.notification_status not null default 'queued', scheduled_at timestamptz, sent_at timestamptz, read_at timestamptz
    );
    alter table public.notifications enable row level security;
    create policy notifications_own on public.notifications for select to authenticated using (recipient_profile_id=auth.uid());
    create policy notifications_mark_read on public.notifications for update to authenticated using (recipient_profile_id=auth.uid()) with check (recipient_profile_id=auth.uid());
    grant select,insert,update,delete on public.notifications to authenticated;
    create table public.monitoring_alerts(id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id), status public.alert_status not null default 'open', message text not null);
    create schema realtime;
    create table realtime.messages(extension text not null,topic text not null,payload jsonb not null);
    alter table realtime.messages enable row level security;
    grant select on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('request.realtime.topic',true),'') $$;
    create function realtime.send(jsonb,text,text,boolean) returns void language plpgsql security definer set search_path='' as $$
      begin if current_setting('test.realtime.fail',true)='true' then raise exception 'offline'; end if;
        insert into realtime.messages values('broadcast',$3,jsonb_build_object('event',$2,'payload',$1,'private',$4)); end $$;
    grant usage on schema public,auth,realtime to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant execute on function realtime.topic() to authenticated;
  `)
  await db.query(`insert into public.profiles(id,role,status,full_name) values
    ($1,'patient','active','Patient A'),($2,'patient','active','Patient B'),($3,'admin','active','Care Coordinator'),($4,'admin','active','Other Admin')`, [uid(1), uid(2), uid(90), uid(91)])
  await db.query('insert into public.patients(id,profile_id,auth_user_id) values($1,$2,$2),($3,$4,$4)', [uid(101), uid(1), uid(102), uid(2)])
  await db.query("insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at) values($1,$2,'family_update','in_app','Legacy notice','Preserved','delivered',now())", [uid(1), uid(101)])
  await db.exec(migrations)
  await db.exec(`
    create function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('session_id',nullif(current_setting('test.session_id',true),'')) $$;
    create table patient_medications(id uuid primary key,patient_id uuid,status text,frequency text,medication_name text,dose text,instructions text,start_date date,end_date date);
    create table medication_schedules(id uuid primary key,patient_medication_id uuid,timezone text,days_of_week smallint[],valid_from date,valid_until date);
    create table medication_events(id uuid primary key,schedule_id uuid,patient_id uuid,scheduled_at timestamptz,status text);
    create table patient_medication_check_ins(patient_medication_id uuid,patient_id uuid,local_date date,occurrence_index integer,is_prn boolean,status text);
    create table appointments(id uuid primary key,patient_id uuid,scheduled_start timestamptz,status text);
  `)
  for (const name of ['20261013090000_wellness_notification_type.sql', '20261013091000_patient_notification_reminders.sql', '20261013130000_nandar_daily_wellness_notifications.sql']) {
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8'))
  }
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('patient Notification Center backend', () => {
  it('preserves existing rows, denies direct table access, and grants no anonymous access', async () => {
    const saved = (await db.query('select title,body,type::text,status::text from public.notifications where recipient_profile_id=$1', [uid(1)])).rows
    expect(saved).toEqual([{ title: 'Legacy notice', body: 'Preserved', type: 'family_update', status: 'delivered' }])
    expect((await db.query("select has_table_privilege('authenticated','public.notifications','select') as read,has_table_privilege('authenticated','public.notifications','insert') as insert,has_table_privilege('authenticated','public.notifications','update') as update,has_table_privilege('anon','public.notifications','select') as anon_read")).rows[0]).toEqual({ read: false, insert: false, update: false, anon_read: false })
  })

  it('lists only own rows and persists mark-one and mark-all with an unread count', async () => {
    await db.query("insert into notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at) values($1,$2,'care_action','in_app','Own action','Review dashboard','sent',now()),($3,$4,'care_action','in_app','Other action','Private','sent',now())", [uid(1), uid(101), uid(2), uid(102)])
    const foreignId = (await db.query("select id from notifications where title='Other action'")).rows[0].id
    await actor(1)
    const ownRows = (await db.query('select * from public.list_my_notifications(30,0) order by title')).rows
    expect(ownRows.map(row => row.title)).toEqual(['Legacy notice', 'Own action'])
    expect((await db.query('select public.get_my_unread_notification_count() as count')).rows[0].count).toBe(2)
    const own = ownRows.find(row => row.title === 'Own action').id
    expect((await db.query('select (public.mark_notification_read($1)).status::text as status', [own])).rows[0].status).toBe('read')
    await expectDenied(() => db.query('select public.mark_notification_read($1)', [foreignId]))
    await db.exec('reset role')
    await db.query('select public.mark_all_my_notifications_read()')
    expect((await db.query("select count(*)::int as unread from notifications where recipient_profile_id=$1 and status<>'read'", [uid(1)])).rows[0].unread).toBe(0)
  })

  it('denies anonymous and non-patient RPC access', async () => {
    await actor(null, 'anon')
    await expectDenied(() => db.query('select * from public.list_my_notifications(30,0)'))
    await actor(90)
    await expectDenied(() => db.query('select public.get_my_unread_notification_count()'))
  })

  it('creates one minimal notification for a designated Care Coordinator reply', async () => {
    await actor(90)
    await db.query('select public.admin_set_designated_support_profile($1)', [uid(90)])
    await actor(1)
    const conversation = await conversationForPatient()
    await actor(90)
    const reply = (await db.query('select * from public.admin_send_support_reply($1,$2)', [conversation.conversation_id, 'sensitive chat text'])).rows[0]
    await db.exec('reset role')
    const found = (await db.query('select * from notifications where source_key=$1', [`support-message:${reply.message_id}`])).rows
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ recipient_profile_id: uid(1), patient_id: uid(101), type: 'support_message', title: 'New message from Care Coordinator', body: 'You have a new message.', source_type: 'support_message', source_id: reply.message_id })
    expect(found[0].body).not.toContain('sensitive chat text')
    await expect(db.query("insert into notifications(recipient_profile_id,patient_id,type,channel,title,body,status,source_key,source_type,source_id) values($1,$2,'support_message','in_app','Duplicate','Duplicate','sent',$3,'support_message',$4)", [uid(1), uid(101), `support-message:${reply.message_id}`, reply.message_id])).rejects.toMatchObject({ code: '23505' })
  })

  it('creates idempotent care-action notifications only for explicit open alerts', async () => {
    const alert = (await db.query("insert into monitoring_alerts(patient_id,message) values($1,'private clinical detail') returning id", [uid(101)])).rows[0]
    expect((await db.query('select id from notifications where source_key=$1', [`monitoring-alert:${alert.id}`])).rows).toHaveLength(1)
    await db.query("update monitoring_alerts set status='escalated' where id=$1", [alert.id])
    const notice = (await db.query('select type::text as type,title,body from notifications where source_key=$1', [`monitoring-alert:${alert.id}`])).rows[0]
    expect(notice).toEqual({ type: 'care_action', title: 'A care item needs your attention', body: 'Please review your health dashboard.' })
    expect((await db.query('select count(*)::int as count from notifications where source_key=$1', [`monitoring-alert:${alert.id}`])).rows[0].count).toBe(1)
  })

  it('authorizes only the signed-in patient private refresh topic and broadcasts no content', async () => {
    await db.query("insert into monitoring_alerts(patient_id,message) values($1,'content must not be broadcast')", [uid(101)])
    await actor(1)
    await db.query("select set_config('request.realtime.topic',$1,true)", [`notifications:${uid(1)}`])
    expect((await db.query('select public.can_receive_my_notification_topic($1) as allowed', [`notifications:${uid(1)}`])).rows[0].allowed).toBe(true)
    expect((await db.query('select public.can_receive_my_notification_topic($1) as allowed', [`notifications:${uid(2)}`])).rows[0].allowed).toBe(false)
    const event = (await db.query("select payload from realtime.messages where topic=$1", [`notifications:${uid(1)}`])).rows.at(-1)
    expect(event.payload.payload).toEqual({ event: 'notification_changed' })
    await actor(null, 'anon')
    await expect(db.query('select public.can_receive_my_notification_topic($1)', [`notifications:${uid(1)}`])).rejects.toMatchObject({ code: '42501' })
  })

  it('persists notifications when Realtime delivery fails', async () => {
    await db.query("select set_config('test.realtime.fail','true',true)")
    const { rows } = await db.query("insert into monitoring_alerts(patient_id,message) values($1,'detail') returning id", [uid(102)])
    expect((await db.query('select count(*)::int as count from notifications where source_id=$1', [rows[0].id])).rows[0].count).toBe(1)
  })
})

const reminderClock = '2026-10-13T18:00:00Z' // Already October 14 in Yangon.
describe('persisted Nandar daily cervical wellness', () => {
  const nandar='2d329d5b-9093-45ca-a980-97466d2a71eb'
  const persist=()=>db.query('select create_my_daily_cervical_wellness_notifications() as created')
  async function setupNandar() {
    await db.query('insert into patients(id,profile_id,auth_user_id) values($1,$2,$2)',[nandar,uid(3)])
  }
  beforeEach(async()=>{
    await db.query("insert into profiles(id,role,status,full_name) values($1,'patient','active','Nandar Kyaw')",[uid(3)])
    await setupNandar()
  })

  it('creates exactly ten own Burmese rows, reuses private broadcast, and never duplicates on login retry',async()=>{
    await actor(3)
    expect((await persist()).rows[0].created).toBe(10)
    expect((await persist()).rows[0].created).toBe(0)
    const rows=(await db.query('select * from list_my_notifications()')).rows
    expect(rows).toHaveLength(10)
    expect(rows.every(n=>n.type==='wellness_check' && n.status==='sent' && n.read_at===null && n.patient_id===nandar)).toBe(true)
    const copy=readFileSync(join(process.cwd(),'src/features/notifications/cervicalReminderSequence.js'),'utf8')
    for(const n of rows) { expect(n.body).toBe(n.title); expect(copy).toContain(n.title) }
    expect((await db.query('select get_my_unread_notification_count() as count')).rows[0].count).toBe(10)
    await db.exec('reset role')
    const day=(await db.query("select (statement_timestamp() at time zone 'Asia/Yangon')::date::text as day")).rows[0].day
    const keys=(await db.query('select source_key from notifications where patient_id=$1',[nandar])).rows
    expect(keys.map(r=>r.source_key).sort()).toEqual(Array.from({length:10},(_,i)=>`cervical-wellness:${nandar}:${day}:${i+1}`).sort())
    const events=(await db.query('select payload from realtime.messages where topic=$1',[`notifications:${uid(3)}`])).rows
    expect(events).toHaveLength(10)
    expect(events.every(e=>JSON.stringify(e.payload.payload)===JSON.stringify({event:'notification_changed'}))).toBe(true)
    await actor(2)
    expect((await db.query('select * from list_my_notifications()')).rows).toHaveLength(0)
  })

  it('preserves read state and history through logout/login and idempotent persistence',async()=>{
    await actor(3); await persist()
    const rows=(await db.query('select * from list_my_notifications()')).rows
    await db.query('select mark_notification_read($1)',[rows[0].id])
    expect((await db.query('select get_my_unread_notification_count() as count')).rows[0].count).toBe(9)
    await actor(null,'anon')
    await expectDenied(persist)
    await actor(3)
    expect((await persist()).rows[0].created).toBe(0)
    expect((await db.query('select * from list_my_notifications()')).rows).toHaveLength(10)
    await db.query('select mark_all_my_notifications_read()')
    await persist()
    expect((await db.query('select get_my_unread_notification_count() as count')).rows[0].count).toBe(0)
  })

  it('denies other patient identities, non-patient roles and direct writes without changing policies',async()=>{
    await actor(1); await expectDenied(persist)
    await expectDenied(()=>db.query("insert into notifications(title) values('forged')"))
    await actor(90); await expectDenied(persist)
    await db.exec('reset role')
    expect((await db.query('select * from notifications where patient_id=$1',[nandar])).rows).toHaveLength(0)
    expect((await db.query("select has_table_privilege('authenticated','notifications','insert') as allowed")).rows[0].allowed).toBe(false)
  })

  it('preserves earlier-day history while creating a new daily set',async()=>{
    await actor(3); await persist(); await db.exec('reset role')
    await db.query("update notifications set source_key=replace(source_key,(statement_timestamp() at time zone 'Asia/Yangon')::date::text,((statement_timestamp() at time zone 'Asia/Yangon')::date-1)::text) where patient_id=$1",[nandar])
    await actor(3)
    expect((await persist()).rows[0].created).toBe(10)
    expect((await persist()).rows[0].created).toBe(0)
    expect((await db.query('select * from list_my_notifications()')).rows).toHaveLength(20)
  })
})
const generate = (clock = reminderClock) => db.query('select generate_patient_notification_reminders($1) as generated', [clock])
const notices = async source => (await db.query('select * from notifications where source_type=$1', [source])).rows
const med = async (frequency = '3 times daily', patient = 101) => {
  await db.query("insert into patient_medications(id,patient_id,status,frequency,medication_name) values($1,$2,'active',$3,'Clinical medication')", [uid(200), uid(patient), frequency])
}

describe('login, medication and appointment notification reminders', () => {
  it('deduplicates a signed login session and permits a new session after logout', async () => {
    await actor(1)
    await db.query("select set_config('test.session_id',$1,true)", [uid(300)])
    await db.query('select create_my_login_wellness_notification()')
    await db.query('select create_my_login_wellness_notification()')
    await db.query("select set_config('test.session_id',$1,true)", [uid(301)])
    await db.query('select create_my_login_wellness_notification()')
    const own = (await db.query('select * from list_my_notifications()')).rows.filter(n => n.type === 'wellness_check')
    expect(own).toHaveLength(2)
    expect(own[0].title).toBe('ဒီနေ့ နေကောင်းရဲ့လား။')
    await actor(2)
    expect((await db.query('select * from list_my_notifications()')).rows).toHaveLength(0)
  })

  it('denies anonymous login, missing session, scheduler access and direct writes', async () => {
    await actor(null, 'anon')
    await expectDenied(() => db.query('select create_my_login_wellness_notification()'))
    await actor(1)
    await expectDenied(() => db.query('select create_my_login_wellness_notification()'))
    await expectDenied(() => generate())
    await expectDenied(() => db.query("insert into notifications(title) values('forged')"))
  })

  it('consolidates required actions and delays a deduplicated Done reminder', async () => {
    await med()
    await generate()
    await generate()
    expect(await notices('medication_daily')).toHaveLength(1)
    expect((await notices('medication_daily'))[0].source_key).toContain('2026-10-14')
    expect(await notices('medication_done')).toHaveLength(0)
    await db.query("insert into patient_medication_check_ins values($1,$2,'2026-10-14',1,false,'taken'),($1,$2,'2026-10-14',2,false,'taken')", [uid(200), uid(101)])
    await generate('2026-10-13T19:00:00Z')
    await generate('2026-10-13T20:00:00Z')
    expect(await notices('medication_done')).toHaveLength(1)
  })

  it('never creates Done when all three required check-ins are completed', async () => {
    await med()
    await generate()
    await db.query("insert into patient_medication_check_ins select $1,$2,'2026-10-14',i,false,'taken' from generate_series(1,3) i", [uid(200), uid(101)])
    await generate('2026-10-13T20:00:00Z')
    expect(await notices('medication_done')).toHaveLength(0)
  })

  it('excludes PRN, unknown frequency, synthetic, and expired medications', async () => {
    await med('Every 8 hours as needed for pain')
    await generate()
    await db.query("update patient_medications set frequency='PRN'")
    await generate()
    await db.query("update patient_medications set frequency='weekly'")
    await generate()
    await db.query("update patient_medications set frequency='daily', medication_name='Demo record medication'")
    await generate()
    await db.query("update patient_medications set medication_name='Clinical medication',end_date='2026-10-13'")
    await generate()
    expect(await notices('medication_daily')).toHaveLength(0)
  })

  it('uses real schedule days, timezones and multiple event completion', async () => {
    await med('daily')
    await db.query("insert into medication_schedules values($1,$2,'Asia/Yangon',array[3]::smallint[],null,null)", [uid(400), uid(200)])
    await db.query("insert into medication_events values($1,$3,$4,'2026-10-14T02:00:00Z','taken'),($2,$3,$4,'2026-10-14T07:00:00Z','pending')", [uid(401),uid(402),uid(400),uid(101)])
    await generate()
    await generate('2026-10-13T19:00:00Z')
    expect(await notices('medication_done')).toHaveLength(1)
    await db.query("update medication_events set status='taken'")
    expect((await db.query('select * from patient_required_medication_actions($1,$2)', [uid(101),reminderClock])).rows.every(r=>r.completed)).toBe(true)
    await db.query("update medication_schedules set days_of_week=array[4]::smallint[]")
    expect((await db.query('select * from patient_required_medication_actions($1,$2)', [uid(101),reminderClock])).rows).toHaveLength(0)
  })

  it('creates exactly one 3-day and 1-day reminder per local appointment date', async () => {
    await db.query("insert into appointments values($1,$2,'2026-10-17T04:00:00Z','confirmed')", [uid(500),uid(101)])
    await generate()
    await generate()
    expect(await notices('appointment_reminder')).toHaveLength(1)
    await generate('2026-10-15T18:00:00Z')
    await generate('2026-10-15T19:00:00Z')
    const rows = await notices('appointment_reminder')
    expect(rows).toHaveLength(2)
    expect(rows.map(r=>r.source_key.split(':').at(-1)).sort()).toEqual(['1-day','3-day'])
    expect(rows.every(r=>r.source_id===uid(500) && r.recipient_profile_id===uid(1))).toBe(true)
  })

  it('keeps a missing schedule event incomplete and consolidates different schedule zones under the patient day', async () => {
    await med('daily')
    await db.query("insert into medication_schedules values($1,$3,'UTC',array[2]::smallint[],null,null),($2,$3,'Asia/Yangon',array[3]::smallint[],null,null)", [uid(400),uid(410),uid(200)])
    await generate()
    expect(await notices('medication_daily')).toHaveLength(1)
    const actions=(await db.query('select * from patient_required_medication_actions($1,$2)',[uid(101),reminderClock])).rows
    expect(actions).toHaveLength(2)
    expect(actions.every(r=>!r.completed)).toBe(true)
    expect(new Set(actions.map(r=>String(r.local_date))).size).toBe(1)
    await generate('2026-10-13T19:00:00Z')
    expect(await notices('medication_done')).toHaveLength(1)
  })

  it('does not send Done for fully taken scheduled events', async () => {
    await med('daily')
    await db.query("insert into medication_schedules values($1,$2,'Asia/Yangon',null,null,null)",[uid(400),uid(200)])
    await db.query("insert into medication_events values($1,$2,$3,'2026-10-14T02:00:00Z','taken')",[uid(401),uid(400),uid(101)])
    await generate()
    await generate('2026-10-13T19:00:00Z')
    expect(await notices('medication_daily')).toHaveLength(1)
    expect(await notices('medication_done')).toHaveLength(0)
  })

  it('withdraws stale reminders on reschedule and immediately on cancellation', async () => {
    await db.query("insert into appointments values($1,$2,'2026-10-17T04:00:00Z','confirmed')", [uid(500),uid(101)])
    await generate()
    await db.query("update appointments set scheduled_start='2026-10-19T04:00:00Z',status='rescheduled'")
    expect((await notices('appointment_reminder'))[0].status).toBe('failed')
    await generate('2026-10-15T18:00:00Z')
    expect((await notices('appointment_reminder')).filter(r=>r.status==='sent')).toHaveLength(1)
    await db.query("update appointments set status='cancelled'")
    await generate('2026-10-17T18:00:00Z')
    expect((await notices('appointment_reminder')).every(r=>r.status==='failed')).toBe(true)
    await actor(1)
    expect((await db.query('select * from list_my_notifications()')).rows.filter(r=>r.source_type==='appointment_reminder')).toHaveLength(0)
  })

  it('excludes past and inactive appointments and refreshes with no health content', async () => {
    for (const [n,status,start] of [[501,'cancelled','2026-10-17'],[502,'completed','2026-10-17'],[503,'no_show','2026-10-17'],[504,'confirmed','2026-10-12']]) {
      await db.query('insert into appointments values($1,$2,$3,$4)',[uid(n),uid(101),`${start}T04:00:00Z`,status])
    }
    await generate()
    expect(await notices('appointment_reminder')).toHaveLength(0)
    await med('daily')
    await generate()
    const events=(await db.query('select payload from realtime.messages')).rows
    expect(events).toHaveLength(1)
    expect(events[0].payload.payload).toEqual({event:'notification_changed'})
  })
})
