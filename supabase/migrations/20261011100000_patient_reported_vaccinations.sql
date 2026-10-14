begin;

-- Keep patient-entered vaccination reports in the existing owner-scoped,
-- provenance-preserving intake store. Do not write them to clinical history.
alter table public.patient_reported_health_items
  drop constraint if exists patient_reported_health_items_item_type_check;
alter table public.patient_reported_health_items
  add constraint patient_reported_health_items_item_type_check
  check (item_type in ('allergy','condition','medication','vaccination'));

create unique index if not exists patient_reported_vaccinations_active_identity_idx
  on public.patient_reported_health_items(patient_id, lower(item_name), (details->>'dateGiven'))
  where item_type='vaccination' and entry_kind='item' and record_status='active';

create or replace function public.add_my_reported_vaccination(p_item_name text, p_details jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare patient_row public.patients%rowtype; date_text text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_item_name is null or length(btrim(p_item_name)) not between 1 and 160
    or p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'Invalid patient-reported vaccination' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_details) k
    where k not in ('doseNumber','dateGiven','location','notes'))
    or exists(select 1 from jsonb_each(p_details) e
      where jsonb_typeof(e.value)<>'string'
        or length(e.value#>>'{}') > case e.key when 'notes' then 1000 when 'location' then 160 when 'doseNumber' then 80 else 10 end) then
    raise exception 'Unsupported or invalid vaccination detail' using errcode='22023';
  end if;
  date_text := p_details->>'dateGiven';
  if date_text is null or date_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'A valid date given is required' using errcode='22023';
  end if;
  perform date_text::date;
  select * into patient_row from public.patients p
    where p.auth_user_id=auth.uid() and p.status='active' for update;
  if not found then raise exception 'Patient identity unavailable' using errcode='42501'; end if;
  insert into public.patient_reported_health_items(patient_id,reported_by_user_id,item_type,entry_kind,item_name,details)
  values(patient_row.id,auth.uid(),'vaccination','item',btrim(p_item_name),p_details)
  on conflict (patient_id, (lower(item_name)), (details->>'dateGiven'))
    where item_type='vaccination' and entry_kind='item' and record_status='active' do nothing;
  return public.get_my_reported_health_intake();
end;
$$;

create or replace function public.update_my_reported_vaccination(p_item_id uuid, p_item_name text, p_details jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item_row public.patient_reported_health_items%rowtype; date_text text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_item_id is null or p_item_name is null or length(btrim(p_item_name)) not between 1 and 160
    or p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'Invalid patient-reported vaccination' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_details) k
    where k not in ('doseNumber','dateGiven','location','notes'))
    or exists(select 1 from jsonb_each(p_details) e
      where jsonb_typeof(e.value)<>'string'
        or length(e.value#>>'{}') > case e.key when 'notes' then 1000 when 'location' then 160 when 'doseNumber' then 80 else 10 end) then
    raise exception 'Unsupported or invalid vaccination detail' using errcode='22023';
  end if;
  date_text := p_details->>'dateGiven';
  if date_text is null or date_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'A valid date given is required' using errcode='22023';
  end if;
  perform date_text::date;
  select i.* into item_row from public.patient_reported_health_items i
    join public.patients p on p.id=i.patient_id
    where i.id=p_item_id and i.item_type='vaccination' and i.entry_kind='item'
      and i.record_status='active' and i.verification_status='unverified'
      and i.reported_by_user_id=auth.uid() and p.auth_user_id=auth.uid() and p.status='active'
    for update of i;
  if not found then raise exception 'Reported vaccination unavailable' using errcode='42501'; end if;
  update public.patient_reported_health_items
    set item_name=btrim(p_item_name),details=p_details,updated_at=statement_timestamp()
    where id=item_row.id;
  return public.get_my_reported_health_intake();
end;
$$;

revoke all on function public.add_my_reported_vaccination(text,jsonb) from public,anon;
revoke all on function public.update_my_reported_vaccination(uuid,text,jsonb) from public,anon;
grant execute on function public.add_my_reported_vaccination(text,jsonb) to authenticated;
grant execute on function public.update_my_reported_vaccination(uuid,text,jsonb) to authenticated;

commit;
