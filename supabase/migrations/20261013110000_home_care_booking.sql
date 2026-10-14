begin;

-- Keep a durable server-quoted snapshot on the existing care request row.
alter table public.care_requests
  add column home_care_package_id uuid references public.care_packages(id) on delete restrict,
  add column home_care_package_name text,
  add column home_care_service_id uuid references public.service_catalog(id) on delete restrict,
  add column home_care_service_name text,
  add column home_care_duration_days integer,
  add column home_care_unit_price numeric(12,2),
  add column home_care_subtotal numeric(12,2),
  add column home_care_provider_amount numeric(12,2),
  add column home_care_commission_percent numeric(5,2),
  add column home_care_commission_amount numeric(12,2),
  add column home_care_currency char(3),
  add column home_care_idempotency_key uuid,
  add constraint care_requests_home_care_snapshot_check check (
    (
      home_care_package_id is null and home_care_package_name is null
      and home_care_service_id is null and home_care_service_name is null
      and home_care_duration_days is null and home_care_unit_price is null
      and home_care_subtotal is null and home_care_provider_amount is null
      and home_care_commission_percent is null and home_care_commission_amount is null
      and home_care_currency is null and home_care_idempotency_key is null
    ) or (
      home_care_package_id is not null and length(btrim(home_care_package_name)) > 0
      and home_care_service_id is not null and length(btrim(home_care_service_name)) > 0
      and home_care_duration_days > 0 and home_care_unit_price >= 0
      and home_care_subtotal = home_care_unit_price * home_care_duration_days
      and home_care_provider_amount >= 0 and home_care_commission_percent between 0 and 100
      and home_care_commission_amount >= 0
      and home_care_provider_amount + home_care_commission_amount = home_care_subtotal
      and home_care_currency is not null and home_care_idempotency_key is not null
    )
  );

create unique index care_requests_home_care_idempotency_key
  on public.care_requests(requested_by_profile_id, home_care_idempotency_key)
  where home_care_idempotency_key is not null;
create index care_requests_home_care_catalog_idx
  on public.care_requests(home_care_package_id, home_care_service_id)
  where home_care_package_id is not null;

-- Home Care writes must pass through the quote-resolving RPC. Historical
-- quote fields cannot be edited after the request is created.
create function public.guard_home_care_booking_snapshot() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.service_type in ('caregiver'::public.care_request_type, 'nurse_home_visit'::public.care_request_type)
      and new.home_care_package_id is null then
      raise exception 'Home Care bookings must be created through the booking service.' using errcode = '42501';
    end if;
    if new.home_care_package_id is not null and current_user not in ('postgres', 'service_role') then
      raise exception 'Home Care bookings must be created through the booking service.' using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
      new.home_care_package_id, new.home_care_package_name,
      new.home_care_service_id, new.home_care_service_name,
      new.home_care_duration_days, new.home_care_unit_price,
      new.home_care_subtotal, new.home_care_provider_amount,
      new.home_care_commission_percent, new.home_care_commission_amount,
      new.home_care_currency, new.home_care_idempotency_key
    ) is distinct from row(
      old.home_care_package_id, old.home_care_package_name,
      old.home_care_service_id, old.home_care_service_name,
      old.home_care_duration_days, old.home_care_unit_price,
      old.home_care_subtotal, old.home_care_provider_amount,
      old.home_care_commission_percent, old.home_care_commission_amount,
      old.home_care_currency, old.home_care_idempotency_key
    ) then
    raise exception 'Home Care quote snapshots are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger care_requests_home_care_snapshot_guard
  before insert or update on public.care_requests
  for each row execute function public.guard_home_care_booking_snapshot();

create function public.create_home_care_booking(
  p_recipient_patient_id uuid,
  p_package_id uuid,
  p_service_id uuid,
  p_duration_days integer,
  p_preferred_date date,
  p_preferred_time time,
  p_address text,
  p_reason_symptoms text,
  p_idempotency_key uuid
)
returns table (
  care_request_id uuid,
  recipient_patient_id uuid,
  package_id uuid,
  package_name text,
  service_id uuid,
  care_level_name text,
  duration_days integer,
  unit_price numeric(12,2),
  subtotal numeric(12,2),
  currency char(3),
  commission_percent numeric(5,2),
  provider_amount numeric(12,2),
  commission_amount numeric(12,2),
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_requester_profile_id uuid := auth.uid();
  v_requester_patient_id uuid;
  v_family_group_id uuid;
  v_consent_id uuid;
  v_consent_status public.consent_status;
  v_quote record;
  v_request_id uuid;
  v_existing public.care_requests%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason_symptoms), ''), 'Home Care service request');
  v_request_service_type public.care_request_type;
begin
  if v_requester_profile_id is null or not public.clinical_identity_is_current()
    or public.current_profile_role() not in ('patient', 'family') then
    raise exception 'An active patient account is required to request Home Care.' using errcode = '42501';
  end if;

  select patient.id into v_requester_patient_id
  from public.patients patient
  join public.profiles profile on profile.id = patient.profile_id
  where patient.auth_user_id = v_requester_profile_id
    and patient.status = 'active'
    and profile.status = 'active'
    and profile.role in ('patient', 'family')
  order by patient.created_at, patient.id
  limit 1;
  if v_requester_patient_id is null then
    raise exception 'An active patient account is required to request Home Care.' using errcode = '42501';
  end if;

  if p_recipient_patient_id is null or p_package_id is null or p_service_id is null
    or p_duration_days is null or p_preferred_date is null or p_preferred_time is null
    or p_idempotency_key is null or p_idempotency_key = '00000000-0000-0000-0000-000000000000'::uuid
    or p_address is null or length(btrim(p_address)) not between 1 and 500
    or length(coalesce(p_reason_symptoms, '')) > 4000 then
    raise exception 'Complete the required Home Care booking details.' using errcode = '22023';
  end if;
  if p_preferred_date < current_date then
    raise exception 'Choose a future Home Care start date.' using errcode = '22023';
  end if;

  -- A retry with the same requester/key and same payload reuses the original
  -- booking. Reusing a key for different booking details is rejected.
  select request.* into v_existing
  from public.care_requests request
  where request.requested_by_profile_id = v_requester_profile_id
    and request.home_care_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.patient_id is distinct from p_recipient_patient_id
      or v_existing.home_care_package_id is distinct from p_package_id
      or v_existing.home_care_service_id is distinct from p_service_id
      or v_existing.home_care_duration_days is distinct from p_duration_days
      or v_existing.preferred_date is distinct from p_preferred_date
      or v_existing.preferred_time is distinct from p_preferred_time
      or v_existing.address_snapshot ->> 'address' is distinct from btrim(p_address)
      or v_existing.reason_symptoms is distinct from v_reason then
      raise exception 'This booking key has already been used for different details.' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.patient_id,
      v_existing.home_care_package_id, v_existing.home_care_package_name,
      v_existing.home_care_service_id, v_existing.home_care_service_name,
      v_existing.home_care_duration_days, v_existing.home_care_unit_price,
      v_existing.home_care_subtotal, v_existing.home_care_currency,
      v_existing.home_care_commission_percent, v_existing.home_care_provider_amount,
      v_existing.home_care_commission_amount, v_existing.created_at, true;
    return;
  end if;

  if p_recipient_patient_id = v_requester_patient_id then
    if not exists (
      select 1 from public.patients recipient
      join public.profiles recipient_profile on recipient_profile.id = recipient.profile_id
      where recipient.id = p_recipient_patient_id and recipient.auth_user_id = v_requester_profile_id
        and recipient.status = 'active' and recipient_profile.status = 'active'
        and recipient_profile.role in ('patient', 'family')
    ) then
      raise exception 'This Home Care recipient is unavailable.' using errcode = '42501';
    end if;
  else
    -- Lock membership, consent, authorization and family group rows. Revocation,
    -- expiry renewal, or member removal therefore serializes with booking.
    select family_group.id, authz.consent_id into v_family_group_id, v_consent_id
    from public.family_authorizations authz
    join public.family_groups family_group on family_group.id = authz.source_family_group_id
    join public.family_group_members recipient_member
      on recipient_member.family_group_id = family_group.id
      and recipient_member.patient_id = authz.patient_id
      and recipient_member.status = 'active'
    join public.family_group_members requester_member
      on requester_member.family_group_id = family_group.id
      and requester_member.patient_id = v_requester_patient_id
      and requester_member.status = 'active'
    join public.patients recipient on recipient.id = authz.patient_id
    join public.profiles recipient_profile on recipient_profile.id = recipient.profile_id
    where authz.patient_id = p_recipient_patient_id
      and authz.family_profile_id = v_requester_profile_id
      and authz.status = 'active'
      and authz.revoked_at is null
      and (authz.expires_at is null or authz.expires_at > statement_timestamp())
      and authz.can_manage_appointments
      and authz.can_make_payments
      and (authz.consent_id is null or exists (
        select 1 from public.consents consent
        where consent.id = authz.consent_id
          and consent.patient_id = authz.patient_id and consent.status = 'granted'
      ))
      and recipient.status = 'active' and recipient_profile.status = 'active'
      and recipient_profile.role = 'patient'
      and recipient.date_of_birth <= (current_date - interval '18 years')::date
    order by family_group.id
    limit 1
    for update of family_group, authz, recipient_member, requester_member;
    if v_family_group_id is null then
      raise exception 'You no longer have permission to book care for this family member.' using errcode = '42501';
    end if;
    if v_consent_id is not null then
      select consent.status into v_consent_status
      from public.consents consent
      where consent.id = v_consent_id and consent.patient_id = p_recipient_patient_id
      for update;
      if not found or v_consent_status <> 'granted' then
        raise exception 'You no longer have permission to book care for this family member.' using errcode = '42501';
      end if;
    end if;
  end if;

  select quote.* into v_quote
  from public.quote_home_care_package(p_package_id, p_service_id, p_duration_days) quote;
  if not found then
    raise exception 'The Home Care quote is unavailable. Please review your selection.' using errcode = '22023';
  end if;

  select case service.provider_type::text
    when 'nurse' then 'nurse_home_visit'::public.care_request_type
    else 'caregiver'::public.care_request_type
  end into v_request_service_type
  from public.service_catalog service
  where service.id = p_service_id;

  insert into public.care_requests (
    patient_id, requested_by_profile_id, service_type, reason_symptoms,
    preferred_date, preferred_time, address_snapshot,
    home_care_package_id, home_care_package_name,
    home_care_service_id, home_care_service_name, home_care_duration_days,
    home_care_unit_price, home_care_subtotal, home_care_provider_amount,
    home_care_commission_percent, home_care_commission_amount,
    home_care_currency, home_care_idempotency_key
  ) values (
    p_recipient_patient_id, v_requester_profile_id, v_request_service_type, v_reason,
    p_preferred_date, p_preferred_time, jsonb_build_object('address', btrim(p_address)),
    v_quote.package_id, v_quote.package_name,
    v_quote.service_id, v_quote.care_level_name, v_quote.duration_days,
    v_quote.unit_price, v_quote.subtotal, v_quote.provider_amount,
    v_quote.commission_percent, v_quote.commission_amount,
    v_quote.currency, p_idempotency_key
  ) on conflict (requested_by_profile_id, home_care_idempotency_key)
    where home_care_idempotency_key is not null
    do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select request.* into v_existing
    from public.care_requests request
    where request.requested_by_profile_id = v_requester_profile_id
      and request.home_care_idempotency_key = p_idempotency_key
    for update;
    if not found
      or v_existing.patient_id is distinct from p_recipient_patient_id
      or v_existing.home_care_package_id is distinct from p_package_id
      or v_existing.home_care_service_id is distinct from p_service_id
      or v_existing.home_care_duration_days is distinct from p_duration_days
      or v_existing.preferred_date is distinct from p_preferred_date
      or v_existing.preferred_time is distinct from p_preferred_time
      or v_existing.address_snapshot ->> 'address' is distinct from btrim(p_address)
      or v_existing.reason_symptoms is distinct from v_reason then
      raise exception 'This booking key has already been used for different details.' using errcode = '22023';
    end if;
    return query select v_existing.id, v_existing.patient_id,
      v_existing.home_care_package_id, v_existing.home_care_package_name,
      v_existing.home_care_service_id, v_existing.home_care_service_name,
      v_existing.home_care_duration_days, v_existing.home_care_unit_price,
      v_existing.home_care_subtotal, v_existing.home_care_currency,
      v_existing.home_care_commission_percent, v_existing.home_care_provider_amount,
      v_existing.home_care_commission_amount, v_existing.created_at, true;
    return;
  end if;

  return query select request.id, request.patient_id,
    request.home_care_package_id, request.home_care_package_name,
    request.home_care_service_id, request.home_care_service_name,
    request.home_care_duration_days, request.home_care_unit_price,
    request.home_care_subtotal, request.home_care_currency,
    request.home_care_commission_percent, request.home_care_provider_amount,
    request.home_care_commission_amount, request.created_at, false
  from public.care_requests request where request.id = v_request_id;
end;
$$;

revoke all on function public.create_home_care_booking(uuid,uuid,uuid,integer,date,time,text,text,uuid) from public, anon;
grant execute on function public.create_home_care_booking(uuid,uuid,uuid,integer,date,time,text,text,uuid) to authenticated;

commit;
