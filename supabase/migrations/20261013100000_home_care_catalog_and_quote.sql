begin;

-- Reuse the existing commercial catalog. Home Care packages point to the
-- available care-level services through package_services, and each service's
-- base_price is explicitly marked as a per-day amount.
alter table public.care_packages
  add column code text,
  add column service_type text,
  add column duration_unit text not null default 'day',
  add column allowed_duration_days integer[] not null default array[1,3,7,14,30],
  add column created_at timestamptz not null default statement_timestamp(),
  add column updated_at timestamptz not null default statement_timestamp(),
  add constraint care_packages_code_format check (code is null or code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint care_packages_service_type_check check (service_type is null or service_type = 'home_care'),
  add constraint care_packages_duration_unit_check check (duration_unit = 'day'),
  add constraint care_packages_allowed_durations_check check (
    cardinality(allowed_duration_days) > 0
    and allowed_duration_days <@ array[1,3,7,14,30]::integer[]
  );

create unique index care_packages_code_key on public.care_packages(code) where code is not null;
drop trigger if exists care_packages_updated_at on public.care_packages;
create trigger care_packages_updated_at before update on public.care_packages
  for each row execute function public.set_updated_at();

alter table public.service_catalog
  add column care_level_code text,
  add column base_price_unit text not null default 'service',
  add column created_at timestamptz not null default statement_timestamp(),
  add column updated_at timestamptz not null default statement_timestamp(),
  add constraint service_catalog_care_level_code_check check (
    care_level_code is null or care_level_code in ('nurse-aide','skilled-nurse-aide','special-nurse')
  ),
  add constraint service_catalog_base_price_unit_check check (base_price_unit in ('service','day'));

drop trigger if exists service_catalog_updated_at on public.service_catalog;
create trigger service_catalog_updated_at before update on public.service_catalog
  for each row execute function public.set_updated_at();

-- Stable package codes intentionally match CARE_PACKAGES IDs in the frontend.
insert into public.care_packages
  (id, code, name, price, billing_period, active, service_type, duration_unit, allowed_duration_days)
values
  ('ec000000-0000-4000-8000-000000000001','basic-elderly','Basic Elderly Care',null,null,true,'home_care','day',array[1,3,7,14,30]),
  ('ec000000-0000-4000-8000-000000000002','skilled-elderly','Skilled Elderly Care',null,null,true,'home_care','day',array[1,3,7,14,30]),
  ('ec000000-0000-4000-8000-000000000003','medical-care','Medical Care',null,null,true,'home_care','day',array[1,3,7,14,30]),
  ('ec000000-0000-4000-8000-000000000004','post-hospital','Post-Hospital Care',null,null,true,'home_care','day',array[1,3,7,14,30]),
  ('ec000000-0000-4000-8000-000000000005','remote-family','Remote Family Care',null,null,false,'home_care','day',array[1,3,7,14,30])
on conflict (code) where code is not null do update set
  name = excluded.name,
  active = excluded.active,
  service_type = excluded.service_type,
  duration_unit = excluded.duration_unit,
  allowed_duration_days = excluded.allowed_duration_days;

-- Preserve the current presentation rates exactly. These are stored once per
-- care level as MMK per day; the quote RPC performs all duration arithmetic.
insert into public.service_catalog
  (id, code, name, provider_type, service_type, base_price, currency, active, care_level_code, base_price_unit)
values
  ('ec100000-0000-4000-8000-000000000001','home-care-nurse-aide','Nurse Aide','nurse_aide','home_visit',36000,'MMK',true,'nurse-aide','day'),
  ('ec100000-0000-4000-8000-000000000002','home-care-skilled-nurse-aide','Skilled Nurse Aide','nurse_aide','home_visit',48000,'MMK',true,'skilled-nurse-aide','day'),
  ('ec100000-0000-4000-8000-000000000003','home-care-special-nurse','Special Nurse','nurse','home_visit',60000,'MMK',true,'special-nurse','day')
on conflict (code) do update set
  name = excluded.name,
  provider_type = excluded.provider_type,
  service_type = excluded.service_type,
  base_price = excluded.base_price,
  currency = excluded.currency,
  active = excluded.active,
  care_level_code = excluded.care_level_code,
  base_price_unit = excluded.base_price_unit;

-- Keep the existing customer total and 17% platform split in server data.
insert into public.pricing_rules
  (id, service_id, rule_type, provider_type, value_type, value, active)
values
  ('ec200000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001','commission',null,'percentage',17,true),
  ('ec200000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000002','commission',null,'percentage',17,true),
  ('ec200000-0000-4000-8000-000000000003','ec100000-0000-4000-8000-000000000003','commission',null,'percentage',17,true)
on conflict (id) do update set
  service_id = excluded.service_id,
  rule_type = excluded.rule_type,
  provider_type = excluded.provider_type,
  value_type = excluded.value_type,
  value = excluded.value,
  active = excluded.active;

insert into public.package_services (package_id, service_id, included_quantity)
values
  ('ec000000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000001',null),
  ('ec000000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000002',null),
  ('ec000000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000002',null),
  ('ec000000-0000-4000-8000-000000000002','ec100000-0000-4000-8000-000000000003',null),
  ('ec000000-0000-4000-8000-000000000003','ec100000-0000-4000-8000-000000000003',null),
  ('ec000000-0000-4000-8000-000000000004','ec100000-0000-4000-8000-000000000002',null),
  ('ec000000-0000-4000-8000-000000000004','ec100000-0000-4000-8000-000000000003',null)
on conflict (package_id, service_id) do update set included_quantity = excluded.included_quantity;

-- The existing catalog policies expose active rows only. Column-level SELECT
-- grants let the authenticated quote client load public presentation metadata,
-- while catalog mutation stays available only to server-side administrators.
grant select (id, code, name, active, service_type, duration_unit, allowed_duration_days)
  on public.care_packages to authenticated;
grant select (id, code, name, provider_type, service_type, base_price, currency, active, care_level_code, base_price_unit)
  on public.service_catalog to authenticated;
grant select (package_id, service_id, included_quantity) on public.package_services to authenticated;
grant select (id, service_id, rule_type, provider_type, value_type, value, effective_from, effective_to, active)
  on public.pricing_rules to authenticated;
revoke insert, update, delete on public.care_packages, public.service_catalog, public.package_services, public.pricing_rules from anon, authenticated;
grant select, insert, update, delete on public.care_packages, public.service_catalog, public.package_services, public.pricing_rules to service_role;

-- Keep the existing broad link read policy from revealing associations to
-- inactive packages or inactive services.
create policy package_services_active_catalog_read
  on public.package_services as restrictive for select to authenticated
  using (
    exists (
      select 1 from public.care_packages cp
      join public.service_catalog sc on sc.id = package_services.service_id
      where cp.id = package_services.package_id and cp.active and sc.active
    )
  );

create or replace function public.quote_home_care_package(
  p_package_id uuid,
  p_service_id uuid,
  p_duration_days integer
)
returns table (
  package_id uuid,
  package_code text,
  package_name text,
  service_id uuid,
  care_level_code text,
  care_level_name text,
  service_type text,
  duration_days integer,
  unit_price numeric(12,2),
  subtotal numeric(12,2),
  commission_percent numeric,
  provider_amount numeric(12,2),
  commission_amount numeric(12,2),
  currency char(3)
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_allowed_durations integer[];
  v_commission_percent numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to quote Home Care.' using errcode = '28000';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'Choose a supported Home Care duration.' using errcode = '22023';
  end if;

  select cp.allowed_duration_days into v_allowed_durations
  from public.care_packages cp
  where cp.id = p_package_id and cp.service_type = 'home_care' and cp.active;
  if v_allowed_durations is null or not (p_duration_days = any(v_allowed_durations)) then
    raise exception 'This Home Care package or duration is unavailable.' using errcode = '22023';
  end if;

  select pr.value into v_commission_percent
  from public.pricing_rules pr
  where pr.service_id = p_service_id
    and pr.rule_type = 'commission'
    and pr.provider_type is null
    and pr.value_type = 'percentage'
    and pr.active
    and (pr.effective_from is null or pr.effective_from <= statement_timestamp())
    and (pr.effective_to is null or pr.effective_to >= statement_timestamp())
  order by pr.effective_from desc nulls last, pr.id
  limit 1;
  if v_commission_percent is null or v_commission_percent < 0 or v_commission_percent > 100 then
    raise exception 'This Home Care quote has no valid active commission rule.' using errcode = '22023';
  end if;

  return query
  select cp.id, cp.code, cp.name, sc.id, sc.care_level_code, sc.name,
         'home_care'::text, p_duration_days,
         sc.base_price::numeric(12,2),
         (sc.base_price * p_duration_days)::numeric(12,2),
         v_commission_percent,
         round((sc.base_price * p_duration_days) * (100 - v_commission_percent) / 100)::numeric(12,2),
         ((sc.base_price * p_duration_days) - round((sc.base_price * p_duration_days) * (100 - v_commission_percent) / 100))::numeric(12,2),
         sc.currency
  from public.care_packages cp
  join public.package_services ps on ps.package_id = cp.id
  join public.service_catalog sc on sc.id = ps.service_id
  where cp.id = p_package_id
    and sc.id = p_service_id
    and cp.service_type = 'home_care'
    and cp.active
    and sc.active
    and sc.service_type = 'home_visit'
    and sc.base_price_unit = 'day'
    and sc.care_level_code is not null
    and sc.currency = 'MMK';

  if not found then
    raise exception 'This Home Care package or care level is unavailable.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.quote_home_care_package(uuid, uuid, integer) from public, anon;
grant execute on function public.quote_home_care_package(uuid, uuid, integer) to authenticated;

commit;
