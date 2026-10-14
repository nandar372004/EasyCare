// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const uid = value => `96000000-0000-4000-8000-${String(value).padStart(12, '0')}`
let db

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text unique, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id text primary key, bucket_id text not null, name text not null);
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when strpos(name, '/') > 0 then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] else array[]::text[] end
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant all on storage.buckets, storage.objects to anon, authenticated;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = statement_timestamp(); return new; end $$;
    create table public.providers (id uuid primary key, profile_id uuid not null, provider_type text not null, verification_status text not null, display_name text);
    alter table public.providers enable row level security;
    grant select (id, provider_type, verification_status, display_name) on public.providers to authenticated;
    create policy providers_directory_read on public.providers for select to authenticated using (provider_type = 'doctor' and verification_status = 'verified');
    create policy providers_owner_update on public.providers for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
    create function public.get_my_provider_setup_identity()
      returns table(provider_id uuid, provider_type text) language sql stable security definer set search_path = '' as $$
        select provider.id, provider.provider_type from public.providers provider where provider.profile_id = auth.uid()
      $$;
    grant execute on function public.get_my_provider_setup_identity() to authenticated;
    insert into public.providers values
      ('${uid(10)}', '${uid(1)}', 'doctor', 'verified', 'Doctor One'),
      ('${uid(20)}', '${uid(2)}', 'doctor', 'verified', 'Doctor Two'),
      ('${uid(30)}', '${uid(3)}', 'nurse_aide', 'verified', 'Nurse Three');
  `)
  await db.exec(readFileSync('supabase/migrations/20261010100000_doctor_professional_information.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261010110000_doctor_professional_information_owner_identity_policies.sql', 'utf8'))
})

afterAll(async () => { await db?.close() })

async function as(userId, callback) {
  await db.exec('begin')
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    await db.exec('set local role authenticated')
    const result = await callback()
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

const details = providerId => ({
  provider_id: providerId, full_name: 'Dr Private', nrc: 'private-nrc', date_of_birth: '1980-01-01',
  work_experience_years: 10, current_hospital: 'Private Clinic', medical_qualification: 'MBBS',
  mmc_registration_number: 'MMC-1', medical_practitioner_license_number: 'SAM-1',
  license_type: 'general_medical_practitioner',
})

describe('doctor professional information owner privacy', () => {
  it('allows a doctor to save private details while another doctor and a nurse cannot read them', async () => {
    await as(uid(1), () => db.query(`insert into public.doctor_professional_information
      (provider_id,full_name,nrc,date_of_birth,work_experience_years,current_hospital,medical_qualification,mmc_registration_number,medical_practitioner_license_number,license_type)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      details(uid(10)).provider_id, details(uid(10)).full_name, details(uid(10)).nrc, details(uid(10)).date_of_birth,
      details(uid(10)).work_experience_years, details(uid(10)).current_hospital, details(uid(10)).medical_qualification,
      details(uid(10)).mmc_registration_number, details(uid(10)).medical_practitioner_license_number, details(uid(10)).license_type,
    ]))
    expect((await as(uid(1), () => db.query('select nrc from public.doctor_professional_information'))).rows).toEqual([{ nrc: 'private-nrc' }])
    expect((await as(uid(2), () => db.query('select nrc from public.doctor_professional_information'))).rows).toEqual([])
    expect((await as(uid(3), () => db.query('select nrc from public.doctor_professional_information'))).rows).toEqual([])
    await expect(as(uid(3), () => db.query(`insert into public.doctor_professional_information
      (provider_id,full_name,nrc,date_of_birth,work_experience_years,medical_qualification,mmc_registration_number,medical_practitioner_license_number,license_type)
      values ($1,'Nurse','private','1980-01-01',1,'Nursing','MMC','SAM','general_medical_practitioner')`, [uid(30)]))).rejects.toThrow(/row-level security/)
  })

  it('uses identity helper policies without granting providers.profile_id select', async () => {
    expect((await db.query("select has_table_privilege('authenticated','public.providers','select') as full_select")).rows[0].full_select).toBe(false)
    expect((await db.query("select has_column_privilege('authenticated','public.providers','profile_id','select') as profile_id_select")).rows[0].profile_id_select).toBe(false)
    expect((await as(uid(1), () => db.query('select provider_id from public.get_my_provider_setup_identity()'))).rows).toEqual([{ provider_id: uid(10) }])
    expect((await db.query("select relrowsecurity from pg_class where oid='public.doctor_professional_information'::regclass")).rows[0].relrowsecurity).toBe(true)
  })

  it('keeps license files private and readable only by their doctor owner', async () => {
    expect((await db.query("select public from storage.buckets where id='doctor-medical-licenses'")).rows).toEqual([{ public: false }])
    await as(uid(1), () => db.query("insert into storage.objects (id,bucket_id,name) values ('object-1','doctor-medical-licenses',$1)", [`${uid(1)}/${uid(10)}/license.pdf`]))
    await as(uid(2), () => db.query("insert into storage.objects (id,bucket_id,name) values ('object-2','doctor-medical-licenses',$1)", [`${uid(2)}/${uid(20)}/license.pdf`]))
    expect((await as(uid(1), () => db.query("select name from storage.objects where bucket_id='doctor-medical-licenses'"))).rows).toEqual([{ name: `${uid(1)}/${uid(10)}/license.pdf` }])
    expect((await as(uid(2), () => db.query("select name from storage.objects where bucket_id='doctor-medical-licenses'"))).rows).toEqual([{ name: `${uid(2)}/${uid(20)}/license.pdf` }])
    expect((await as(uid(3), () => db.query("select name from storage.objects where bucket_id='doctor-medical-licenses'"))).rows).toEqual([])
  })

  it('denies anonymous private access while preserving authenticated provider directory reads', async () => {
    await db.exec('begin')
    await db.exec('set local role anon')
    let anonymousTableError
    try { await db.query('select nrc from public.doctor_professional_information') } catch (error) { anonymousTableError = error }
    await db.exec('rollback')
    expect(anonymousTableError).toMatchObject({ code: '42501' })

    await db.exec('begin')
    await db.exec('set local role anon')
    const anonymousFiles = await db.query("select name from storage.objects where bucket_id='doctor-medical-licenses'")
    await db.exec('rollback')
    expect(anonymousFiles.rows).toEqual([])

    expect((await as(uid(4), () => db.query("select id,provider_type from public.providers order by id"))).rows).toEqual([
      { id: uid(10), provider_type: 'doctor' },
      { id: uid(20), provider_type: 'doctor' },
    ])
    expect((await as(uid(4), () => db.query('select nrc from public.doctor_professional_information'))).rows).toEqual([])
    const providerPolicies = (await db.query("select policyname from pg_policies where schemaname='public' and tablename='providers' order by policyname")).rows
    expect(providerPolicies).toEqual([{ policyname: 'providers_directory_read' }, { policyname: 'providers_owner_update' }])
  })

  it('rejects an unsupported license type', async () => {
    await expect(as(uid(1), () => db.query(`insert into public.doctor_professional_information
      (provider_id,full_name,nrc,date_of_birth,work_experience_years,medical_qualification,mmc_registration_number,medical_practitioner_license_number,license_type)
      values ($1,'Dr','nrc','1980-01-01',1,'MBBS','MMC','SAM','unlicensed')`, [uid(10)]))).rejects.toThrow(/check constraint/)
  })
})
