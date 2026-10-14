// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const target = '20261005110000_patient_reported_health_intake.sql'
const userId = '74000000-0000-4000-8000-000000000001'
const otherUserId = '74000000-0000-4000-8000-000000000002'
let db, patientId, otherPatientId, legacyPreferences

describe('patient-reported intake migration preserves legacy profile text', () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create schema storage; create table storage.buckets(id text primary key, public boolean not null default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;`)
    const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    for (const name of migrations.filter(name => name < target)) await db.exec(readFileSync(join(directory, name), 'utf8'))
    await db.query('insert into auth.users(id) values ($1)', [userId])
    patientId = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId, fullName: 'Legacy Intake Patient', phone: '+959963254323', dateOfBirth: '1992-04-03', termsAccepted: true, privacyConsent: true,
    })])).rows[0].id
    legacyPreferences = {
      noKnownAllergies: false,
      allergies: 'Penicillin — rash',
      existingMedicalConditions: 'High blood pressure',
      currentMedications: 'Amlodipine 5 mg once daily',
      unrelatedPreference: 'keep this value',
    }
    await db.query('update public.patients set care_preferences=$1::jsonb where id=$2', [JSON.stringify(legacyPreferences), patientId])
    await db.exec(readFileSync(join(directory, target), 'utf8'))
    await db.query('insert into auth.users(id) values ($1)', [otherUserId])
    otherPatientId = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: otherUserId, fullName: 'Other Synthetic Patient', phone: '+959963254324', dateOfBirth: '1990-05-04', termsAccepted: true, privacyConsent: true,
    })])).rows[0].id
    await db.exec(readFileSync(join(directory, '20261011100000_patient_reported_vaccinations.sql'), 'utf8'))
  }, 60000)

  afterAll(async () => { await db?.close() })

  it('copies each legacy text field as unverified patient-reported data and leaves care_preferences untouched', async () => {
    const stored = (await db.query('select care_preferences from public.patients where id=$1', [patientId])).rows[0].care_preferences
    expect(stored).toEqual(legacyPreferences)
    const rows = (await db.query(`select item_type,entry_kind,item_name,source,verification_status,legacy_source_key
      from public.patient_reported_health_items where patient_id=$1 order by item_type`, [patientId])).rows
    expect(rows).toEqual([
      { item_type: 'allergy', entry_kind: 'item', item_name: 'Penicillin — rash', source: 'patient_reported', verification_status: 'unverified', legacy_source_key: 'care_preferences:allergies' },
      { item_type: 'condition', entry_kind: 'item', item_name: 'High blood pressure', source: 'patient_reported', verification_status: 'unverified', legacy_source_key: 'care_preferences:existingMedicalConditions' },
      { item_type: 'medication', entry_kind: 'item', item_name: 'Amlodipine 5 mg once daily', source: 'patient_reported', verification_status: 'unverified', legacy_source_key: 'care_preferences:currentMedications' },
    ])
    expect((await db.query('select blood_type_source,blood_type_verification_status from public.patients where id=$1', [patientId])).rows[0])
      .toEqual({ blood_type_source: 'legacy_patient_profile', blood_type_verification_status: 'unverified' })
  })

  it('adds a patient-owned reported vaccination once and rejects another patient editing it', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId])
    const details = { dateGiven: '2026-10-01', doseNumber: 'Dose 1', location: 'Clinic A', notes: 'No reaction noted' }
    await db.query('select public.add_my_reported_vaccination($1,$2::jsonb)', ['Influenza vaccine', JSON.stringify(details)])
    await db.query('select public.add_my_reported_vaccination($1,$2::jsonb)', ['Influenza vaccine', JSON.stringify(details)])
    const row = (await db.query(`select id,item_type,item_name,details,source,verification_status,patient_id
      from public.patient_reported_health_items where item_type='vaccination' and patient_id=$1`, [patientId])).rows[0]
    expect(row).toEqual({ id: expect.any(String), item_type: 'vaccination', item_name: 'Influenza vaccine', details, source: 'patient_reported', verification_status: 'unverified', patient_id: patientId })
    expect((await db.query(`select count(*)::int as count from public.patient_reported_health_items
      where item_type='vaccination' and patient_id=$1`, [patientId])).rows[0].count).toBe(1)

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherUserId])
    await expect(db.query('select public.update_my_reported_vaccination($1,$2,$3::jsonb)', [row.id, 'Changed vaccine', JSON.stringify(details)]))
      .rejects.toThrow('Reported vaccination unavailable')
    expect((await db.query('select patient_id,item_name from public.patient_reported_health_items where id=$1', [row.id])).rows[0])
      .toEqual({ patient_id: patientId, item_name: 'Influenza vaccine' })
    expect(otherPatientId).not.toBe(patientId)
  })
})
