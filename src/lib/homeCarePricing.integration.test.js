// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261013100000_home_care_catalog_and_quote.sql'), 'utf8')
const uid = n => 'ec900000-0000-4000-8000-' + String(n).padStart(12, '0')
const PACKAGE = 'ec000000-0000-4000-8000-000000000001'
const NURSE_AIDE = 'ec100000-0000-4000-8000-000000000001'
let db

async function actor(profile, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [profile ? uid(profile) : ''])
  await db.exec('set local role ' + role)
}

async function quote(packageId = PACKAGE, serviceId = NURSE_AIDE, days = 3) {
  return db.query('select * from public.quote_home_care_package($1,$2,$3)', [packageId, serviceId, days])
}

async function expectDatabaseFailure(operation, expected) {
  await db.exec('savepoint expected_database_failure')
  await expect(operation()).rejects.toMatchObject(expected)
  await db.exec('rollback to savepoint expected_database_failure')
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
    alter table public.care_packages enable row level security;
    alter table public.service_catalog enable row level security;
    alter table public.package_services enable row level security;
    alter table public.pricing_rules enable row level security;
    create policy packages_read on public.care_packages for select to authenticated using (active);
    create policy catalog_read on public.service_catalog for select to authenticated using (active);
    create policy package_services_read on public.package_services for select to authenticated using (true);
    create policy pricing_read on public.pricing_rules for select to authenticated using (active);
    grant usage on schema public, auth to anon, authenticated, service_role;
  `)
  await db.exec(migration)
}, 30000)

beforeEach(() => db.exec('begin'))
afterEach(() => db.exec('rollback'))
afterAll(() => db?.close())

describe('authoritative Home Care catalog and quote', () => {
  it('seeds the current package IDs and exact daily presentation rates', async () => {
    const packages = (await db.query("select code,name,active,allowed_duration_days from public.care_packages where service_type='home_care' order by code")).rows
    expect(packages.map(row => [row.code, row.name, row.active])).toEqual([
      ['basic-elderly','Basic Elderly Care',true],
      ['medical-care','Medical Care',true],
      ['post-hospital','Post-Hospital Care',true],
      ['remote-family','Remote Family Care',false],
      ['skilled-elderly','Skilled Elderly Care',true],
    ])
    expect(packages.find(row => row.code === 'basic-elderly').allowed_duration_days).toEqual([1,3,7,14,30])
    expect((await db.query("select care_level_code,base_price,currency from public.service_catalog where code like 'home-care-%' order by base_price")).rows.map(row => [row.care_level_code, Number(row.base_price), row.currency.trim()])).toEqual([
      ['nurse-aide',36000,'MMK'], ['skilled-nurse-aide',48000,'MMK'], ['special-nurse',60000,'MMK'],
    ])
  })

  it('returns deterministic server-calculated quotes without accepting browser prices', async () => {
    await actor(1)
    const first = (await quote(PACKAGE, NURSE_AIDE, 3)).rows[0]
    const second = (await quote(PACKAGE, NURSE_AIDE, 3)).rows[0]
    expect(first).toMatchObject({
      package_id: PACKAGE, package_code: 'basic-elderly', service_id: NURSE_AIDE,
      care_level_code: 'nurse-aide', service_type: 'home_care', duration_days: 3,
      unit_price: '36000.00', subtotal: '108000.00', commission_percent: '17',
      provider_amount: '89640.00', commission_amount: '18360.00', currency: 'MMK',
    })
    expect(second).toEqual(first)
    expect(migration).toContain('p_package_id uuid')
    expect(migration).toContain('p_service_id uuid')
    expect(migration).not.toMatch(/p_(price|subtotal|total)\s+/i)
  })

  it('rejects a service level that is not linked to the package and unsupported durations', async () => {
    await actor(1)
    await expectDatabaseFailure(() => quote(PACKAGE, 'ec100000-0000-4000-8000-000000000003', 3), { code: '22023' })
    await expectDatabaseFailure(() => quote(PACKAGE, NURSE_AIDE, 2), { code: '22023' })
    await expectDatabaseFailure(() => quote('ec000000-0000-4000-8000-000000000005', NURSE_AIDE, 3), { code: '22023' })
  })

  it('does not expose inactive catalog rows or allow patient price mutations', async () => {
    await actor(1)
    await expectDatabaseFailure(() => db.query('update public.service_catalog set base_price=1 where id=$1', [NURSE_AIDE]), { code: '42501' })
    await expectDatabaseFailure(() => db.query('update public.care_packages set active=false where id=$1', [PACKAGE]), { code: '42501' })
    const signature = (await db.query("select pg_get_function_arguments('public.quote_home_care_package(uuid,uuid,integer)'::regprocedure) as args")).rows[0].args
    expect(signature).toContain('p_package_id uuid')
    expect(signature).toContain('p_service_id uuid')
    expect(signature).toContain('p_duration_days integer')
  })

  it('requires authenticated access to quote', async () => {
    await actor(null, 'anon')
    await expectDatabaseFailure(() => quote(), { code: '42501' })
  })
})
