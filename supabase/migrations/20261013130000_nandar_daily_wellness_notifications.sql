begin;
set local lock_timeout = '10s';

-- Presentation identity matches the existing Nandar seed, never a display name.
-- No caller-supplied recipient, copy, URL, or clock is accepted.
create function public.create_my_daily_cervical_wellness_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare target_patient uuid; target_profile uuid := auth.uid(); inserted integer;
  local_day date := (statement_timestamp() at time zone 'Asia/Yangon')::date;
begin
  select p.id into target_patient from public.patients p
    join public.profiles f on f.id=p.auth_user_id
    where p.id='2d329d5b-9093-45ca-a980-97466d2a71eb'::uuid
      and p.auth_user_id=target_profile and p.status='active'
      and f.role='patient' and f.status='active'
    for share of p,f;
  if target_patient is null then
    raise exception 'Presentation patient notification access required' using errcode='42501';
  end if;
  insert into public.notifications
    (recipient_profile_id,patient_id,type,channel,title,body,status,sent_at,source_key,source_type,source_id)
  select target_profile,target_patient,'wellness_check','in_app',message.copy,message.copy,'sent',statement_timestamp(),
    'cervical-wellness:'||target_patient::text||':'||local_day::text||':'||message.position::text,
    case when message.position=5 then 'cervical_wellness_medication' else 'cervical_wellness' end,target_patient
  from (values
    (1,'လည်ပင်းလေ့ကျင့်ခန်း လုပ်ဖို့ မမေ့နော်'),
    (2,'ဒီနေ့ လည်ပင်းကို အနားပေးဖို့ လိုတယ်နော်'),
    (3,'ဖုန်းကို အောက်ချပြီး လည်ပင်းကို ဆန့်ထုတ်လိုက်ပါ'),
    (4,'ထိုင်တဲ့အခါ ကိုယ်ဟန်အနေအထား မှန်ဖို့ သတိရပါ'),
    (5,'လည်ပင်းနာကျင်နေရင် ဆေးသောက်ဖို့ မမေ့ပါနဲ့'),
    (6,'ဒီနေ့ လည်ပင်းလှုပ်ရှားမှု လေ့ကျင့်ခန်း ၅ မိနစ် လုပ်ပါ'),
    (7,'အလုပ်ကြားထဲမှာ ခဏထရပ်ပြီး လည်ပင်းကို လှုပ်ပေးပါ'),
    (8,'ခေါင်းအုံး အမြင့်များလွန်းရင် လည်ပင်းကို ထိခိုက်နိုင်တယ်နော်'),
    (9,'လည်ပင်းကို အေးနေစေဖို့ သတိထားပါ'),
    (10,'သင့်ရဲ့ လည်ပင်းကျီးပေါင်း အခြေအနေ ဘယ်လိုရှိလဲ။ နေ့စဉ် မှတ်တမ်းတင်ပါ')
  ) as message(position,copy)
  order by message.position
  on conflict(source_key) where source_key is not null do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$$;
revoke all on function public.create_my_daily_cervical_wellness_notifications() from public,anon;
grant execute on function public.create_my_daily_cervical_wellness_notifications() to authenticated;
-- Existing insertion broadcast and list/count/read RPCs handle these rows.
-- No schema, direct-write privilege, or RLS policy changes.
commit;
