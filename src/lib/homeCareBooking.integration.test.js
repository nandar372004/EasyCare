// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const catalogMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261013100000_home_care_catalog_and_quote.sql'), 'utf8')
const bookingMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261013110000_home_care_booking.sql'), 'utf8')
const uid = n => 'ec900000-0000-4000-8000-' + String(n).padStart(12, '0')
const PACKAGE = 'ec000000-0000-4000-8000-000000000001'
const SERVICE = 'ec100000-0000-4000-8000-000000000001'
let db

async function actor(profile, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [profile ? uid(profile) : ''])
  await db.exec('set local role ' + role)
}

function bookingInput(overrides = {}) {
  return {
    recipientPatientId: uid(101), packageId: PACKAGE, serviceId: SERVICE, durationDays: 3,
    preferredDate: '2026-10-20', preferredTime: '09:00', address: 'No. 10 Example Street',
    reasonSymptoms: 'Needs daily support', idempotencyKey: uid(501), ...overrides,
  }
}

async function book(input = bookingInput()) {
  return db.query(`select * from public.create_home_care_booking(
    $1,$2,$3,$4,$5::date,$6::time,$7,$8,$9
  )`, [input.recipientPatientId, input.packageId, input.serviceId, input.durationDays,
    input.preferredDate, input.preferredTime, input.address, input.reasonSymptoms, input.idempotencyKey])
}

async function expectDenied(operation, code = '42501') {
  await db.exec('savepoint expected_booking_denial')
  await expect(operation()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint expected_booking_denial')
}

async function seedPeople() {
  await db.query(`insert into public.profiles(id,role,status) values
    ($1,'patient','active'),($2,'patient','active'),($3,'patient','active'),($4,'patient','active')`, [uid(1), uid(2), uid(3), uid(4)])
  await db.query(`insert into public.patients(id,profile_id,auth_user_id,full_name,status,date_of_birth,created_at) values
    ($1,$2,$2,'Requester','active','1980-01-01',now()),
    ($3,$4,$4,'Family requester','active','1982-01-01',now()),
    ($5,$6,$6,'Family recipient','active','1940-01-01',now()),
    ($7,$8,$8,'Unrelated patient','active','1970-01-01',now())`, [uid(101), uid(1), uid(102), uid(2), uid(103), uid(3), uid(104), uid(4)])
  await db.query(`insert into public.family_groups(id,display_name) values ($1,'Test family')`, [uid(201)])
  await db.query(`insert into public.family_group_members(id,family_group_id,patient_id,status) values
    ($1,$2,$3,'active'),($4,$2,$5,'active')`, [uid(211), uid(201), uid(102), uid(212), uid(103)])
  await db.query(`insert into public.consents(id,patient_id,status) values ($1,$2,'granted')`, [uid(301), uid(103)])
  await db.query(`insert into public.family_authorizations(
    id,patient_id,family_profile_id,status,revoked_at,expires_at,can_manage_appointments,can_make_payments,source_family_group_id,consent_id
  ) values ($1,$2,$3,'active',null,'2099-01-01T00:00:00Z',true,true,$4,$5)`, [uid(311), uid(103), uid(2), uid(201), uid(301)])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.provider_type as enum ('doctor','nurse','nurse_aide','caregiver');
    create type public.catalog_service_type as enum ('teleconsultation','home_visit','nursing','caregiver');
    create type public.billing_period as enum ('one_time','monthly','quarterly');
    create type public.pricing_rule_type as enum ('night_surcharge','travel','emergency','commission');
    create type public.pricing_value_type as enum ('fixed','percentage');
    create type public.care_request_type as enum ('teleconsultation','doctor_home_visit','nurse_home_visit','caregiver');
    create type public.care_urgency as enum ('unassessed','routine','urgent','emergency');
    create type public.consent_status as enum ('granted','withdrawn');
    create type public.care_request_status as enum ('new','triaged','matching','booked','escalated','closed','cancelled');
    create type public.family_authorization_status as enum ('pending','active','revoked');
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = statement_timestamp(); return new; end $$;
    create table public.care_packages (
      id uuid primary key, name text not null, price numeric(12,2),
      billing_period public.billing_period, active boolean not null default true
    );
    create table public.service_catalog (
      id uuid primary key, code text not null unique, name text not null,
      provider_type public.provider_type, service_type public.catalog_service_type not null,
      base_price numeric(12,2) not null check(base_price >= 0),
      currency char(3) not null default 'MMK', active boolean not null default true
    );
    create table public.package_services (
      package_id uuid not null references public.care_packages(id),
      service_id uuid not null references public.service_catalog(id),
      included_quantity integer check(included_quantity is null or included_quantity > 0),
      primary key(package_id,service_id)
    );
    create table public.pricing_rules (
      id uuid primary key, service_id uuid references public.service_catalog(id),
      rule_type public.pricing_rule_type not null, provider_type public.provider_type,
      value_type public.pricing_value_type not null, value numeric not null,
      effective_from timestamptz, effective_to timestamptz, active boolean not null default true
    );
    create table public.profiles (id uuid primary key, role text not null, status text not null);
    create table public.patients (
      id uuid primary key, profile_id uuid not null, auth_user_id uuid not null,
      full_name text not null, status text not null, date_of_birth date not null, created_at timestamptz not null
    );
    create table public.family_groups (id uuid primary key, display_name text not null);
    create table public.family_group_members (
      id uuid primary key, family_group_id uuid not null references public.family_groups(id),
      patient_id uuid not null references public.patients(id), status text not null
    );
    create table public.consents (id uuid primary key, patient_id uuid not null references public.patients(id), status public.consent_status not null);
    create table public.family_authorizations (
      id uuid primary key, patient_id uuid not null references public.patients(id), family_profile_id uuid not null,
      status public.family_authorization_status not null, revoked_at timestamptz, expires_at timestamptz,
      can_manage_appointments boolean not null, can_make_payments boolean not null,
      source_family_group_id uuid references public.family_groups(id), consent_id uuid references public.consents(id)
    );
    create table public.care_requests (
      id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id),
      requested_by_profile_id uuid not null references public.profiles(id), service_type public.care_request_type not null,
      reason_symptoms text not null, urgency_level public.care_urgency not null default 'unassessed',
      preferred_date date, preferred_time time, address_snapshot jsonb, coordinator_id uuid,
      status public.care_request_status not null default 'new',
      created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp()
    );
    create function public.clinical_identity_is_current() returns boolean language sql stable security definer set search_path='' as
      $$ select exists(select 1 from public.profiles where id=auth.uid() and status='active' and role in ('patient','family')) $$;
    create function public.current_profile_role() returns text language sql stable security definer set search_path='' as
      $$ select role from public.profiles where id=auth.uid() and status='active' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant insert, update, select on public.care_requests to authenticated;
    alter table public.care_packages enable row level security;
    alter table public.service_catalog enable row level security;
    alter table public.package_services enable row level security;
    alter table public.pricing_rules enable row level security;
    create policy packages_read on public.care_packages for select to authenticated using (active);
    create policy catalog_read on public.service_catalog for select to authenticated using (active);
    create policy package_services_read on public.package_services for select to authenticated using (true);
    create policy pricing_read on public.pricing_rules for select to authenticated using (active);
  `)
  await db.exec(catalogMigration)
  await db.exec(bookingMigration)
  await seedPeople()
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('secure Home Care booking RPC', () => {
  it('creates a self booking with the requester resolved from auth and an immutable server quote snapshot', async () => {
    await actor(1)
    const result = (await book()).rows[0]
    expect(result).toMatchObject({
      recipient_patient_id: uid(101), package_id: PACKAGE, package_name: 'Basic Elderly Care',
      service_id: SERVICE, care_level_name: 'Nurse Aide', duration_days: 3,
      unit_price: '36000.00', subtotal: '108000.00', currency: 'MMK',
      commission_percent: '17.00', provider_amount: '89640.00', commission_amount: '18360.00', replayed: false,
    })
    const stored = (await db.query('select * from public.care_requests where id=$1', [result.care_request_id])).rows[0]
    expect(stored).toMatchObject({ patient_id: uid(101), requested_by_profile_id: uid(1), service_type: 'caregiver', home_care_idempotency_key: uid(501) })
    expect(stored.address_snapshot).toEqual({ address: 'No. 10 Example Street' })
  })

  it('creates an authorized family booking only for a current active relationship with both permissions', async () => {
    await actor(2)
    const result = (await book(bookingInput({ recipientPatientId: uid(103) }))).rows[0]
    const stored = (await db.query('select patient_id,requested_by_profile_id from public.care_requests where id=$1', [result.care_request_id])).rows[0]
    expect(stored).toEqual({ patient_id: uid(103), requested_by_profile_id: uid(2) })
  })

  it('reuses one request for retries and rejects the same key with different booking details', async () => {
    await actor(1)
    const first = (await book()).rows[0]
    const replay = (await book()).rows[0]
    expect(replay.care_request_id).toBe(first.care_request_id)
    expect(replay.replayed).toBe(true)
    expect((await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count).toBe(1)
    await expectDenied(() => book(bookingInput({ address: 'Different address' })), '22023')
    expect((await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count).toBe(1)
  })

  it('denies forged requester parameters and never accepts a browser price', async () => {
    await actor(1)
    await expectDenied(() => db.query(`select * from public.create_home_care_booking(
      $1,$2,$3,$4,$5::date,$6::time,$7,$8,$9,$10
    )`, [...Object.values(bookingInput()), uid(999)]), '42883')
    await expectDenied(() => db.query(`select * from public.create_home_care_booking(
      $1,$2,$3,$4,$5::date,$6::time,$7,$8,$9,$10
    )`, [...Object.values(bookingInput()), '1.00']), '42883')
  })

  it('denies unrelated or forged recipients', async () => {
    await actor(1)
    const before = (await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count
    await expectDenied(() => book(bookingInput({ recipientPatientId: uid(104) })))
    expect((await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count).toBe(before)
  })

  it.each([
    ['revoked access', `update public.family_authorizations set status='revoked',revoked_at=now() where id='${uid(311)}'`],
    ['expired access', `update public.family_authorizations set expires_at='2000-01-01T00:00:00Z' where id='${uid(311)}'`],
    ['missing appointment permission', `update public.family_authorizations set can_manage_appointments=false where id='${uid(311)}'`],
    ['missing payment permission', `update public.family_authorizations set can_make_payments=false where id='${uid(311)}'`],
    ['removed family relationship', `update public.family_group_members set status='removed' where id='${uid(212)}'`],
    ['withdrawn consent', `update public.consents set status='withdrawn' where id='${uid(301)}'`],
  ])('denies family booking with %s', async (_name, change) => {
    await db.exec(change)
    await actor(2)
    await expectDenied(() => book(bookingInput({ recipientPatientId: uid(103) })))
    expect((await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count).toBe(0)
  })

  it.each([
    ['inactive package', `update public.care_packages set active=false where id='${PACKAGE}'`, PACKAGE, SERVICE, 3],
    ['inactive service', `update public.service_catalog set active=false where id='${SERVICE}'`, PACKAGE, SERVICE, 3],
    ['invalid duration', null, PACKAGE, SERVICE, 2],
  ])('creates nothing for %s', async (_name, change, packageId, serviceId, days) => {
    if (change) await db.exec(change)
    await actor(1)
    await expectDenied(() => book(bookingInput({ packageId, serviceId, durationDays: days })), '22023')
    expect((await db.query('select count(*)::integer as count from public.care_requests')).rows[0].count).toBe(0)
  })

  it('blocks direct Home Care inserts and quote snapshot edits from authenticated clients', async () => {
    await actor(1)
    await expectDenied(() => db.query(`insert into public.care_requests(
      patient_id,requested_by_profile_id,service_type,reason_symptoms
    ) values ($1,$2,'caregiver','Bypass attempt')`, [uid(101), uid(1)]))
    const created = (await book()).rows[0]
    await expectDenied(() => db.query('update public.care_requests set home_care_subtotal=1 where id=$1', [created.care_request_id]))
  })
})
