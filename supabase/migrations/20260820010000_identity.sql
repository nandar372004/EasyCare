begin;
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.profile_role as enum ('patient','family','doctor','nurse','caregiver','coordinator','clinic_admin','main_admin');
create type public.profile_status as enum ('active','suspended','inactive');
create type public.verification_status as enum ('pending','verified','rejected','suspended');
create type public.provider_type as enum ('doctor','nurse','nurse_aide','caregiver');
create type public.care_urgency as enum ('unassessed','routine','urgent','emergency');
create type public.appointment_status as enum ('pending','confirmed','cancelled','completed','no_show','rescheduled');
create type public.visit_status as enum ('requested','assigned','accepted','en_route','arrived','in_progress','completed','cancelled');
create type public.payment_status as enum ('pending','authorized','paid','failed','refunded','partially_refunded');
create type public.alert_status as enum ('open','acknowledged','escalated','resolved');
create type public.medication_event_status as enum ('pending','taken','missed','skipped','unknown');
create type public.subscription_status as enum ('pending','active','paused','cancelled','expired');
create type public.family_authorization_status as enum ('pending','active','revoked');
create type public.service_mode as enum ('teleconsultation','home_visit');
create type public.availability_status as enum ('available','held','booked','unavailable');
create type public.care_request_type as enum ('teleconsultation','doctor_home_visit','nurse_home_visit','caregiver');
create type public.care_request_status as enum ('new','triaged','matching','booked','escalated','closed','cancelled');
create type public.assignment_status as enum ('suggested','assigned','accepted','rejected','cancelled');
create type public.encounter_type as enum ('teleconsultation','home_visit','nursing_care','caregiver_visit');
create type public.encounter_status as enum ('open','completed','amended');
create type public.clinical_note_type as enum ('assessment','progress','nursing','caregiver','discharge','follow_up');
create type public.condition_status as enum ('active','resolved','historical');
create type public.allergy_severity as enum ('mild','moderate','severe');
create type public.active_status as enum ('active','inactive');
create type public.history_category as enum ('surgery','hospitalization','vaccination','imaging','other');
create type public.vital_source as enum ('manual','provider','device');
create type public.prescription_status as enum ('active','completed','cancelled');
create type public.patient_medication_status as enum ('active','paused','completed','discontinued');
create type public.alert_severity as enum ('info','warning','critical');
create type public.teleconsultation_status as enum ('scheduled','active','completed','failed');
create type public.follow_up_type as enum ('call','appointment','monitoring','medication');
create type public.follow_up_status as enum ('pending','completed','cancelled');
create type public.pricing_rule_type as enum ('night_surcharge','travel','emergency','commission');
create type public.pricing_value_type as enum ('fixed','percentage');
create type public.billing_period as enum ('one_time','monthly','quarterly');
create type public.renewal_type as enum ('manual','automatic');
create type public.notification_type as enum ('booking','visit_status','medication','follow_up','health_alert','family_update');
create type public.notification_channel as enum ('in_app','push','sms','phone','messenger','viber');
create type public.notification_status as enum ('queued','sent','delivered','failed','read');
create type public.complaint_status as enum ('open','investigating','resolved','closed');
create type public.consent_type as enum ('care','data_processing','family_access','teleconsultation','AI_assistance');
create type public.consent_status as enum ('granted','withdrawn');
create type public.coordinator_status as enum ('active','unavailable','inactive');
create type public.clinic_status as enum ('pending','active','suspended');
create type public.clinic_role as enum ('doctor','nurse','caregiver','sub_admin');
create type public.ai_interaction_type as enum ('health_assistant','symptom_screening','provider_matching');
create type public.ai_summary_type as enum ('daily','weekly');
create type public.ai_review_status as enum ('generated','reviewed','hidden');

create function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=statement_timestamp(); return new; end $$;
create function public.normalize_myanmar_phone(value text) returns text language plpgsql immutable set search_path='' as $$
declare compact text;
begin
  compact := regexp_replace(btrim(value), '[\s-]', '', 'g');
  if compact ~ '^\+959[0-9]{7,9}$' then return compact;
  elsif compact ~ '^00959[0-9]{7,9}$' then return '+'||substr(compact,3);
  elsif compact ~ '^959[0-9]{7,9}$' then return '+'||compact;
  elsif compact ~ '^09[0-9]{7,9}$' then return '+95'||substr(compact,2);
  else raise exception 'Invalid Myanmar phone number'; end if;
end $$;
create function public.normalize_profile_phone() returns trigger language plpgsql set search_path='' as $$ begin if new.phone is not null then new.phone=public.normalize_myanmar_phone(new.phone); end if; return new; end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.profile_role not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  phone text,
  email text,
  date_of_birth date check (date_of_birth is null or date_of_birth < current_date),
  gender text,
  profile_photo_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en','my')),
  status public.profile_status not null default 'active',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create unique index profiles_phone_uidx on public.profiles(phone) where phone is not null;
create unique index profiles_email_uidx on public.profiles(lower(email)) where email is not null;
create trigger profiles_normalize_phone before insert or update of phone on public.profiles for each row execute function public.normalize_profile_phone();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
commit;
