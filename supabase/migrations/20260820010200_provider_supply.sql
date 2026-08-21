begin;
create table public.providers (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references public.profiles(id) on delete restrict,
 provider_type public.provider_type not null, license_number text, verification_status public.verification_status not null default 'pending',
 years_experience integer check(years_experience is null or years_experience>=0), bio text, languages text[], service_area jsonb,
 home_visit_enabled boolean not null default false, teleconsult_enabled boolean not null default false,
 rating_average numeric(3,2) check(rating_average is null or rating_average between 0 and 5), verified_at timestamptz,
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
);
create unique index providers_license_uidx on public.providers(provider_type,license_number) where license_number is not null;
create index providers_verified_idx on public.providers(provider_type) where verification_status='verified';
create trigger providers_updated_at before update on public.providers for each row execute function public.set_updated_at();
create table public.provider_credentials (
 id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id) on delete restrict,
 credential_type text not null, credential_number text, issuer text, issued_date date, expiry_date date, document_url text,
 verification_status public.verification_status not null default 'pending', verified_by uuid references public.profiles(id) on delete restrict, verified_at timestamptz,
 check(expiry_date is null or issued_date is null or expiry_date>=issued_date)
);
create table public.specialties (id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.provider_specialties (provider_id uuid not null references public.providers(id) on delete restrict, specialty_id uuid not null references public.specialties(id) on delete restrict, is_primary boolean not null default false, primary key(provider_id,specialty_id));
create unique index provider_primary_specialty_uidx on public.provider_specialties(provider_id) where is_primary;
create table public.partner_clinics (
 id uuid primary key default gen_random_uuid(), name text not null, phone text, email text, address text, township text, city text,
 latitude numeric(9,6), longitude numeric(9,6), status public.clinic_status not null default 'pending',
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 check(latitude is null or latitude between -90 and 90), check(longitude is null or longitude between -180 and 180)
);
create trigger partner_clinics_updated_at before update on public.partner_clinics for each row execute function public.set_updated_at();
create table public.clinic_staff (
 id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.partner_clinics(id) on delete restrict,
 profile_id uuid not null references public.profiles(id) on delete restrict, provider_id uuid references public.providers(id) on delete restrict,
 clinic_role public.clinic_role not null, status public.active_status not null default 'active', joined_at timestamptz not null default statement_timestamp(), unique(clinic_id,profile_id)
);
create table public.provider_availability (
 id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.providers(id) on delete restrict,
 clinic_id uuid references public.partner_clinics(id) on delete restrict, service_type public.service_mode not null,
 start_at timestamptz not null, end_at timestamptz not null, status public.availability_status not null default 'available',
 created_at timestamptz not null default statement_timestamp(), check(end_at>start_at)
);
create index provider_availability_lookup_idx on public.provider_availability(provider_id,start_at,status);
commit;
