begin;
set local lock_timeout = '10s';

-- Extend the existing patient-owned monitoring model without changing its RLS,
-- direct table grants, or existing RPC signatures.
alter table public.patient_monitoring_plans
  add column measurement_type text,
  add column measurement_unit text,
  add constraint patient_monitoring_plans_measurement_type_check
    check (measurement_type is null or measurement_type in
      ('blood_pressure','weight','blood_glucose','heart_rate','temperature','custom')),
  add constraint patient_monitoring_plans_measurement_definition_check
    check ((measurement_type is null and measurement_unit is null)
      or (measurement_type is not null and measurement_unit is not null
        and char_length(btrim(measurement_unit)) between 1 and 40));

alter table public.patient_monitoring_check_ins
  add column systolic_value numeric,
  add column diastolic_value numeric,
  add constraint patient_monitoring_check_ins_bp_pair_check
    check ((systolic_value is null) = (diastolic_value is null)),
  add constraint patient_monitoring_check_ins_measurements_positive
    check ((systolic_value is null or (systolic_value > 0 and systolic_value <> 'NaN'::numeric))
      and (diastolic_value is null or (diastolic_value > 0 and diastolic_value <> 'NaN'::numeric))
      and (systolic_value is null or systolic_value not in ('Infinity'::numeric, '-Infinity'::numeric))
      and (diastolic_value is null or diastolic_value not in ('Infinity'::numeric, '-Infinity'::numeric)));

create function public.save_my_patient_monitoring_plan_v2(
  p_plan_id uuid, p_title text, p_related_context text, p_notes text,
  p_recurrence_type text, p_days_of_week smallint[], p_start_date date,
  p_end_date date, p_times time[], p_measurement_type text, p_measurement_unit text
) returns public.patient_monitoring_plans
language plpgsql security definer set search_path = '' as $$
declare owner_patient_id uuid; result public.patient_monitoring_plans;
  normalized_type text := nullif(btrim(coalesce(p_measurement_type,'')), '');
  normalized_unit text := nullif(btrim(coalesce(p_measurement_unit,'')), '');
begin
  if auth.uid() is null then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  select p.id into owner_patient_id from public.patients p
    where p.auth_user_id=auth.uid() and p.status='active' for key share;
  if not found then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  if normalized_type is null then
    normalized_unit := null;
  elsif normalized_type not in ('blood_pressure','weight','blood_glucose','heart_rate','temperature','custom')
      or normalized_unit is null or char_length(normalized_unit) > 40 then
    raise exception 'Measurement definition is invalid' using errcode = '22023';
  elsif (normalized_type='blood_pressure' and normalized_unit <> 'mmHg')
      or (normalized_type='weight' and normalized_unit not in ('kg','lb'))
      or (normalized_type='blood_glucose' and normalized_unit not in ('mg/dL','mmol/L'))
      or (normalized_type='heart_rate' and normalized_unit <> 'bpm')
      or (normalized_type='temperature' and normalized_unit not in ('°C','°F')) then
    raise exception 'Measurement unit does not match the measurement type' using errcode = '22023';
  end if;

  result := public.save_my_patient_monitoring_plan(
    p_plan_id,p_title,p_related_context,p_notes,p_recurrence_type,
    p_days_of_week,p_start_date,p_end_date,p_times);
  update public.patient_monitoring_plans mp set measurement_type=normalized_type,
    measurement_unit=normalized_unit, updated_at=statement_timestamp()
    where mp.id=result.id and mp.patient_id=owner_patient_id returning mp.* into result;
  return result;
end;
$$;

create function public.record_my_patient_monitoring_measurement(
  p_plan_id uuid, p_local_date date, p_occurrence_key text,
  p_systolic_value numeric, p_diastolic_value numeric, p_measurement_value numeric,
  p_measurement_unit text, p_notes text
) returns public.patient_monitoring_check_ins
language plpgsql security definer set search_path = '' as $$
declare owner_patient_id uuid; plan_row public.patient_monitoring_plans;
  result public.patient_monitoring_check_ins; normalized_unit text;
  normalized_notes text; is_bp boolean;
begin
  if auth.uid() is null then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  select p.id into owner_patient_id from public.patients p
    where p.auth_user_id=auth.uid() and p.status='active';
  if not found then raise exception 'Authenticated patient required' using errcode = '42501'; end if;
  select mp.* into plan_row from public.patient_monitoring_plans mp
    where mp.id=p_plan_id and mp.patient_id=owner_patient_id and mp.is_active;
  if not found then raise exception 'Monitoring routine is unavailable' using errcode = '42501'; end if;
  if plan_row.measurement_type is null then raise exception 'Routine does not require a measurement' using errcode = '22023'; end if;
  is_bp := plan_row.measurement_type='blood_pressure';
  normalized_unit := nullif(btrim(coalesce(p_measurement_unit,'')), '');
  normalized_notes := nullif(btrim(coalesce(p_notes,'')), '');
  if normalized_unit is distinct from plan_row.measurement_unit
      or char_length(coalesce(normalized_notes,'')) > 1000
      or (is_bp and (p_systolic_value is null or p_diastolic_value is null or p_measurement_value is not null))
      or (not is_bp and (p_measurement_value is null or p_systolic_value is not null or p_diastolic_value is not null))
      or p_systolic_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or p_diastolic_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or p_measurement_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or p_systolic_value <= 0 or p_diastolic_value <= 0 or p_measurement_value <= 0 then
    raise exception 'Measurement values or unit are invalid' using errcode = '22023';
  end if;
  result := public.record_my_patient_monitoring_check_in(
    p_plan_id,p_local_date,p_occurrence_key,true,
    case when is_bp then null else p_measurement_value::text end,
    normalized_unit,normalized_notes);
  update public.patient_monitoring_check_ins ci set
    systolic_value=case when is_bp then p_systolic_value else null end,
    diastolic_value=case when is_bp then p_diastolic_value else null end,
    updated_at=statement_timestamp()
    where ci.id=result.id and ci.patient_id=owner_patient_id returning ci.* into result;
  return result;
end;
$$;

revoke all on function public.save_my_patient_monitoring_plan_v2(uuid,text,text,text,text,smallint[],date,date,time[],text,text) from public, anon;
revoke all on function public.record_my_patient_monitoring_measurement(uuid,date,text,numeric,numeric,numeric,text,text) from public, anon;
grant execute on function public.save_my_patient_monitoring_plan_v2(uuid,text,text,text,text,smallint[],date,date,time[],text,text) to authenticated;
grant execute on function public.record_my_patient_monitoring_measurement(uuid,date,text,numeric,numeric,numeric,text,text) to authenticated;

comment on column public.patient_monitoring_check_ins.local_date is
  'Scheduled occurrence date in the patient monitoring date contract; completed_at records the actual check-in timestamp.';
comment on column public.patient_monitoring_check_ins.systolic_value is
  'Patient-entered systolic measurement for a blood pressure occurrence.';
comment on column public.patient_monitoring_check_ins.diastolic_value is
  'Patient-entered diastolic measurement for a blood pressure occurrence.';

commit;
