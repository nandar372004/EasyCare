// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const userId = '73000000-0000-4000-8000-000000000001'
const otherUserId = '73000000-0000-4000-8000-000000000002'
let db, patientId, otherPatientId

describe('patient onboarding session security and safe profile writes', () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create schema storage; create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;`)
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    await db.query('insert into auth.users(id) values ($1)', [userId])
    await db.query('insert into auth.users(id) values ($1)', [otherUserId])
    patientId = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId, fullName: 'Onboarding Patient', phone: '+959963254321', dateOfBirth: '1990-01-01', termsAccepted: true, privacyConsent: true,
    })])).rows[0].id
    // Existing hosted patients can have no linked profiles row; Auth ownership
    // is still unambiguous through patients.auth_user_id.
    await db.exec(`alter table public.patients disable trigger patients_protect_auth_fields;
      alter table public.patients drop constraint patients_profile_auth_identity_check;
      alter table public.patients alter column profile_id drop not null;`)
    await db.query('update public.patients set profile_id = null where id = $1', [patientId])
    await db.exec('alter table public.patients enable trigger patients_protect_auth_fields')
    otherPatientId = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: otherUserId, fullName: 'Other Intake Patient', phone: '+959963254322', dateOfBirth: '1991-01-01', termsAccepted: true, privacyConsent: true,
    })])).rows[0].id
  }, 60000)

  afterAll(async () => { await db?.close() })

  it('loads identity from auth.uid, writes only safe fields, and preserves patient authorization and clinical records', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    await db.exec('set role authenticated')
    await expect(db.query('select * from public.patient_onboarding_states')).rejects.toThrow(/permission denied/)
    const loaded = (await db.query('select public.get_my_patient_onboarding() as data')).rows[0].data
    expect(loaded.status).toBe('not_started')
    expect(loaded.identity.fullName).toBe('Onboarding Patient')
    expect(loaded.identity.phone).toBe('+959963254321')

    const saved = (await db.query('select public.save_my_patient_onboarding($1, $2::jsonb) as data', [
      'in_progress', JSON.stringify({ addressLine: '12 Clinic Road', township: 'Sanchaung', city: 'Yangon', emergencyContactPhone: '09 123 456 789' }),
    ])).rows[0].data
    expect(saved.status).toBe('in_progress')
    expect(saved.profile).toMatchObject({ addressLine: '12 Clinic Road', township: 'Sanchaung', city: 'Yangon', emergencyContactPhone: '+959123456789' })
    await expect(db.query('select public.save_my_patient_onboarding($1, $2::jsonb)', ['completed', JSON.stringify({ role: 'doctor', providerId: 'arbitrary', admin: true })])).rejects.toThrow('Unsupported profile field')
    await expect(db.query('select public.save_my_patient_onboarding($1, $2::jsonb)', ['completed', JSON.stringify({ emergencyContactPhone: 'not-a-phone' })])).rejects.toThrow('Invalid Myanmar phone number')

    await db.exec('reset role')
    const identity = (await db.query('select p.profile_id, p.auth_user_id from public.patients p where p.id=$1', [patientId])).rows[0]
    expect(identity).toEqual({ profile_id: null, auth_user_id: userId })
    expect((await db.query('select count(*)::int as count from public.providers where profile_id=$1', [userId])).rows[0].count).toBe(0)
    for (const table of ['patient_allergies', 'patient_conditions', 'patient_medications', 'prescriptions']) {
      expect((await db.query(`select count(*)::int as count from public.${table} where patient_id=$1`, [patientId])).rows[0].count).toBe(0)
    }
    expect((await db.query('select count(*)::int as count from public.medication_schedules s join public.patient_medications m on m.id=s.patient_medication_id where m.patient_id=$1', [patientId])).rows[0].count).toBe(0)
  })

  it('keeps patient-reported intake separate, owned, unverified and outside medication authority', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    await db.exec('set role authenticated')
    await expect(db.query('select * from public.patient_reported_health_items')).rejects.toThrow(/permission denied/)
    await expect(db.query(`insert into public.patient_reported_health_items(patient_id,reported_by_user_id,item_type,item_name)
      values($1,$2,'allergy','Forged')`, [patientId, userId])).rejects.toThrow(/permission denied/)
    await expect(db.query("update public.patients set blood_type='A+' where auth_user_id=$1", [userId])).rejects.toThrow(/permission denied/)

    let intake = (await db.query("select public.add_my_reported_health_item('allergy','item','Penicillin',$1::jsonb) as data", [JSON.stringify({ reaction: 'Rash', allergenType: 'medication' })])).rows[0].data
    let allergy = intake.items.find(item => item.itemType === 'allergy')
    expect(allergy).toMatchObject({ name: 'Penicillin', source: 'patient_reported', verificationStatus: 'unverified' })
    expect(allergy.details).toMatchObject({ reaction: 'Rash', allergenType: 'medication' })
    intake = (await db.query('select public.update_my_reported_health_item($1,$2,$3::jsonb) as data', [allergy.id, 'Penicillin (reported)', JSON.stringify({ reaction: 'Rash' })])).rows[0].data
    expect(intake.items.find(item => item.id === allergy.id).name).toBe('Penicillin (reported)')
    intake = (await db.query('select public.archive_my_reported_health_item($1) as data', [allergy.id])).rows[0].data
    expect(intake.items.some(item => item.id === allergy.id)).toBe(false)
    intake = (await db.query("select public.add_my_reported_health_item('allergy','none_known',null,'{}'::jsonb) as data")).rows[0].data
    expect(intake.items.find(item => item.itemType === 'allergy')).toMatchObject({ entryKind: 'none_known', verificationStatus: 'unverified' })
    intake = (await db.query("select public.add_my_reported_health_item('allergy','item','Latex','{}'::jsonb) as data")).rows[0].data
    expect(intake.items.find(item => item.itemType === 'allergy')).toMatchObject({ entryKind: 'item', name: 'Latex' })

    intake = (await db.query("select public.add_my_reported_health_item('condition','item','High blood pressure',$1::jsonb) as data", [JSON.stringify({ context: 'Patient-reported' })])).rows[0].data
    expect(intake.items.find(item => item.itemType === 'condition')).toMatchObject({ verificationStatus: 'unverified', source: 'patient_reported' })
    intake = (await db.query("select public.add_my_reported_health_item('medication','item','Amlodipine',$1::jsonb) as data", [JSON.stringify({ dose: '5 mg', frequency: 'once daily' })])).rows[0].data
    expect(intake.items.find(item => item.itemType === 'medication')).toMatchObject({ verificationStatus: 'unverified', source: 'patient_reported' })
    await expect(db.query("select public.add_my_reported_health_item('medication','item','Forged',$1::jsonb)", [JSON.stringify({ providerId: otherUserId, prescribed: true })])).rejects.toThrow(/Unsupported item detail/)
    await expect(db.query('select public.save_my_reported_blood_type($1)', ['A++'])).rejects.toThrow(/Invalid patient-reported blood type/)
    intake = (await db.query('select public.save_my_reported_blood_type($1) as data', ['Unknown'])).rows[0].data
    expect(intake).toMatchObject({ bloodType: 'Unknown', bloodTypeSource: 'patient_reported', bloodTypeVerificationStatus: 'unverified' })

    await db.exec('reset role')
    const patientReports = (await db.query('select count(*)::int as count from public.patient_reported_health_items where patient_id=$1', [patientId])).rows[0].count
    expect(patientReports).toBeGreaterThan(0)
    for (const table of ['patient_allergies', 'patient_conditions', 'patient_medications', 'prescriptions']) {
      expect((await db.query(`select count(*)::int as count from public.${table} where patient_id=$1`, [patientId])).rows[0].count).toBe(0)
    }
    expect((await db.query('select count(*)::int as count from public.prescription_items i join public.prescriptions p on p.id=i.prescription_id where p.patient_id=$1', [patientId])).rows[0].count).toBe(0)
    expect((await db.query('select count(*)::int as count from public.medication_schedules s join public.patient_medications m on m.id=s.patient_medication_id where m.patient_id=$1', [patientId])).rows[0].count).toBe(0)
    expect((await db.query('select count(*)::int as count from public.care_plan_tasks where patient_id=$1', [patientId])).rows[0].count).toBe(0)
    expect((await db.query('select count(*)::int as count from public.care_plan_task_occurrences where patient_id=$1', [patientId])).rows[0].count).toBe(0)
    // A second authenticated patient cannot address the first patient's item ID.
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [otherUserId])
    await db.exec('set role authenticated')
    await expect(db.query('select public.update_my_reported_health_item($1,$2,$3::jsonb)', [intake.items.find(item => item.itemType === 'medication').id, 'Hijacked', '{}'])).rejects.toThrow(/Reported item unavailable/)
    await db.exec('reset role')

    // A trusted provider review locks the report against patient editing/removal.
    const reported = intake.items.find(item => item.itemType === 'medication')
    await db.query(`update public.patient_reported_health_items set verification_status='confirmed',
      reviewed_by_profile_id=$1, reviewed_at=statement_timestamp(), review_decision='confirmed' where id=$2`, [userId, reported.id])
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
    await db.exec('set role authenticated')
    await expect(db.query('select public.update_my_reported_health_item($1,$2,$3::jsonb)', [reported.id, 'Changed', '{}'])).rejects.toThrow(/Reported item unavailable/)
    await expect(db.query('select public.archive_my_reported_health_item($1)', [reported.id])).rejects.toThrow(/Reported item unavailable/)
    await db.exec('reset role')

    expect((await db.query("select proargnames from pg_proc where oid='public.add_my_reported_health_item(text,text,text,jsonb)'::regprocedure")).rows[0].proargnames)
      .toEqual(['p_item_type', 'p_entry_kind', 'p_item_name', 'p_details'])
    expect((await db.query("select count(*)::int as count from pg_policies where schemaname='public' and tablename='patient_reported_health_items'")).rows[0].count).toBe(0)
    expect(otherPatientId).toBeTruthy()
  })
})
