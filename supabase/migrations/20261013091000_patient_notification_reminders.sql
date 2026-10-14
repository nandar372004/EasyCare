begin;
set local lock_timeout = '10s';

-- No caller-supplied patient or session identity: use the signed JWT session.
create function public.create_my_login_wellness_notification() returns void
language plpgsql security definer set search_path = '' as $$
declare patient_id uuid; session_id uuid;
begin
  session_id := nullif(auth.jwt()->>'session_id','')::uuid;
  select p.id into patient_id from public.patients p
    join public.profiles f on f.id=p.auth_user_id
    where p.auth_user_id=auth.uid() and p.status='active'
      and f.role='patient' and f.status='active';
  if patient_id is null or session_id is null then
    raise exception 'Patient login session required' using errcode='42501';
  end if;
  insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at,source_key,source_type,source_id)
  values(auth.uid(),patient_id,'wellness_check','in_app','ဒီနေ့ နေကောင်းရဲ့လား။',
    'EasyCare နဲ့ ဒီနေ့ကျန်းမာရေးအခြေအနေကို တစ်ချက်စစ်ကြည့်ပါ။','sent',statement_timestamp(),
    'login-wellness:'||auth.uid()::text||':'||session_id::text,'login_session',session_id)
  on conflict(source_key) where source_key is not null do nothing;
end;
$$;
revoke all on function public.create_my_login_wellness_notification() from public,anon;
grant execute on function public.create_my_login_wellness_notification() to authenticated;

-- Mirror My Care Plan's scheduled events and unscheduled daily check-ins.
-- Missing events mean one incomplete action; no dose times are manufactured.
create function public.patient_required_medication_actions(p_patient uuid,p_now timestamptz)
returns table(local_date date,completed boolean)
language sql stable security definer set search_path = '' as $$
  with medications as (
    select m.* from public.patient_medications m
    where m.patient_id=p_patient and m.status='active'
      and lower(coalesce(m.frequency,'')) !~ '\m(as needed|prn)\M'
      and concat_ws(' ',m.medication_name,m.dose,m.frequency,m.instructions)
        !~* '\m(synthetic([[:space:]]+record\M|[[:space:]]*:)?|demo[[:space:]]+record)\M'
  ), scheduled as (
    select m.id,s.id as schedule_id,(p_now at time zone s.timezone)::date as day
    from medications m join public.medication_schedules s on s.patient_medication_id=m.id
    where (m.start_date is null or m.start_date<=(p_now at time zone s.timezone)::date)
      and (m.end_date is null or m.end_date>=(p_now at time zone s.timezone)::date)
      and (s.valid_from is null or s.valid_from<=(p_now at time zone s.timezone)::date)
      and (s.valid_until is null or s.valid_until>=(p_now at time zone s.timezone)::date)
      and (s.days_of_week is null or extract(dow from p_now at time zone s.timezone)::smallint=any(s.days_of_week))
  ), unscheduled as (
    select m.id, (p_now at time zone 'Asia/Yangon')::date as day,
      case
        when lower(btrim(m.frequency)) ~ '\m(twice daily|2 times daily|2x daily)\M' then 2
        when lower(btrim(m.frequency)) ~ '\m(three times daily|3 times daily|3x daily)\M' then 3
        when lower(btrim(m.frequency)) ~ '\m(once daily|once a day|daily)\M' then 1
        else 0 end as doses
    from medications m
    where not exists(select 1 from public.medication_schedules s where s.patient_medication_id=m.id)
      and (m.start_date is null or m.start_date<=(p_now at time zone 'Asia/Yangon')::date)
      and (m.end_date is null or m.end_date>=(p_now at time zone 'Asia/Yangon')::date)
  )
  -- Consolidate under the patient's established local day, even if an
  -- individual prescription schedule uses another timezone.
  select (p_now at time zone 'Asia/Yangon')::date,coalesce(e.status::text='taken',false)
  from scheduled s join public.medication_schedules schedule on schedule.id=s.schedule_id
    left join public.medication_events e on e.schedule_id=s.schedule_id and e.patient_id=p_patient
      and (e.scheduled_at at time zone schedule.timezone)::date=s.day
  union all
  select u.day, exists(select 1 from public.patient_medication_check_ins c
    where c.patient_medication_id=u.id and c.patient_id=p_patient and c.local_date=u.day
      and not c.is_prn and c.occurrence_index=i and c.status='taken')
  from unscheduled u cross join lateral generate_series(1,u.doses) i;
$$;
revoke all on function public.patient_required_medication_actions(uuid,timestamptz) from public,anon,authenticated;

-- Trusted scheduler only. Clock injection supports deterministic backend tests.
create function public.generate_patient_notification_reminders(p_now timestamptz default statement_timestamp())
returns integer language plpgsql security definer set search_path = '' as $$
declare p record; a record; d record; lead_days integer; inserted integer; total integer:=0; key text;
begin
  if p_now is null then raise exception 'Reminder clock required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('patient-notification-reminders',0));
  for p in select patient.id,patient.auth_user_id from public.patients patient
    join public.profiles profile on profile.id=patient.auth_user_id
    where patient.status='active' and profile.role='patient' and profile.status='active'
    for share of patient,profile
  loop
    for d in select local_date,bool_and(completed) as all_done
      from public.patient_required_medication_actions(p.id,p_now) group by local_date
    loop
      key:='medication-daily:'||p.id::text||':'||d.local_date::text;
      insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at,created_at,source_key,source_type,source_id)
      values(p.auth_user_id,p.id,'medication','in_app','ဒီနေ့ဆေးသောက်ဖို့ လိုတယ်နော်..',
        'ဒီနေ့ဆေးသောက်ဖို့ လိုတယ်နော်..','sent',p_now,p_now,key,'medication_daily',p.id)
      on conflict(source_key) where source_key is not null do nothing;
      get diagnostics inserted=row_count; total:=total+inserted;
      -- One follow-up, at least an hour after the consolidated daily notice.
      if not d.all_done and exists(select 1 from public.notifications n
        where n.source_key=key and n.created_at<=p_now-interval '1 hour') then
        insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at,created_at,source_key,source_type,source_id)
        values(p.auth_user_id,p.id,'medication','in_app','ဆေးသောက်ပြီးရင် Done ကိုနှိပ်နော်',
          'ဆေးသောက်ပြီးရင် Done ကိုနှိပ်နော်','sent',p_now,p_now,
          'medication-done-reminder:'||p.id::text||':'||d.local_date::text,'medication_done',p.id)
        on conflict(source_key) where source_key is not null do nothing;
        get diagnostics inserted=row_count; total:=total+inserted;
      end if;
    end loop;
    for a in select * from public.appointments appointment
      where appointment.patient_id=p.id and appointment.status in ('pending','confirmed','rescheduled')
        and appointment.scheduled_start>p_now for share
    loop
      -- Appointments have no timezone column; preserve the existing Yangon contract.
      lead_days:=(a.scheduled_start at time zone 'Asia/Yangon')::date-(p_now at time zone 'Asia/Yangon')::date;
      if lead_days in (3,1) then
        insert into public.notifications(recipient_profile_id,patient_id,type,channel,title,body,status,sent_at,created_at,source_key,source_type,source_id)
        values(p.auth_user_id,p.id,'booking','in_app',
          case when lead_days=3 then 'ချိန်းဆိုထားတဲ့အချိန် နီးလာပါပြီ' else 'မနက်ဖြန် Appointment ရှိပါတယ်' end,
          case when lead_days=3 then 'သင့် appointment က ၃ ရက်အတွင်း ရှိပါတယ်။' else 'သင့် appointment က မနက်ဖြန် ရှိပါတယ်။' end,
          'sent',p_now,p_now,'appointment:'||a.id::text||':'||extract(epoch from a.scheduled_start)::text||':'||lead_days::text||'-day',
          'appointment_reminder',a.id)
        on conflict(source_key) where source_key is not null do nothing;
        get diagnostics inserted=row_count; total:=total+inserted;
      end if;
    end loop;
  end loop;
  return total;
end;
$$;
revoke all on function public.generate_patient_notification_reminders(timestamptz) from public,anon,authenticated;
grant execute on function public.generate_patient_notification_reminders(timestamptz) to service_role;

-- Withdraw stale reminders immediately when an appointment changes. Retain
-- source keys so retries cannot reissue a reminder for the same schedule.
create function public.withdraw_changed_appointment_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.scheduled_start is distinct from old.scheduled_start or new.patient_id is distinct from old.patient_id
    or new.status not in ('pending','confirmed','rescheduled') then
    update public.notifications set status='failed'
      where source_type='appointment_reminder' and source_id=new.id and status in ('sent','delivered','read');
  end if;
  return new;
end;
$$;
revoke all on function public.withdraw_changed_appointment_reminders() from public,anon,authenticated;
create trigger appointment_reminder_withdrawal after update of scheduled_start,status,patient_id
  on public.appointments for each row execute function public.withdraw_changed_appointment_reminders();
-- Reuse the existing private, content-free refresh hint for withdrawals too.
create trigger notification_broadcast_after_reminder_withdrawal after update of status on public.notifications
  for each row when (old.status is distinct from new.status and new.source_type='appointment_reminder')
  execute function public.broadcast_notification_changed();
commit;
