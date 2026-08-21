begin;
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete restrict,
  primary_phone text,
  address_line text, township text, city text,
  latitude numeric(9,6), longitude numeric(9,6),
  emergency_contact_name text, emergency_contact_relationship text, emergency_contact_phone text,
  blood_type text,
  care_preferences jsonb not null default '{}'::jsonb,
  primary_coordinator_id uuid,
  created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
  check (latitude is null or latitude between -90 and 90), check (longitude is null or longitude between -180 and 180)
);
create function public.normalize_patient_phones() returns trigger language plpgsql set search_path='' as $$ begin if new.primary_phone is not null then new.primary_phone=public.normalize_myanmar_phone(new.primary_phone); end if; if new.emergency_contact_phone is not null then new.emergency_contact_phone=public.normalize_myanmar_phone(new.emergency_contact_phone); end if; return new; end $$;
create trigger patients_normalize_phones before insert or update of primary_phone,emergency_contact_phone on public.patients for each row execute function public.normalize_patient_phones();
create trigger patients_updated_at before update on public.patients for each row execute function public.set_updated_at();

create table public.family_authorizations (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
  family_profile_id uuid not null references public.profiles(id) on delete restrict, relationship text,
  can_view_records boolean not null default false, can_manage_appointments boolean not null default false,
  can_manage_medications boolean not null default false, can_make_payments boolean not null default false,
  can_receive_alerts boolean not null default true, is_primary_contact boolean not null default false,
  authorized_at timestamptz, revoked_at timestamptz, status public.family_authorization_status not null default 'pending',
  unique(patient_id,family_profile_id), check ((status='revoked')=(revoked_at is not null))
);
create unique index family_authorizations_primary_uidx on public.family_authorizations(patient_id) where is_primary_contact and status='active';

create table public.consents (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id) on delete restrict,
  granted_by_profile_id uuid references public.profiles(id) on delete restrict, consent_type public.consent_type not null,
  version text not null, status public.consent_status not null, granted_at timestamptz not null default statement_timestamp(), withdrawn_at timestamptz,
  check ((status='withdrawn')=(withdrawn_at is not null))
);
create index family_authorizations_family_idx on public.family_authorizations(family_profile_id,status);
create index consents_patient_idx on public.consents(patient_id,consent_type,status);
commit;
