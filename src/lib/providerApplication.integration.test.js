// @vitest-environment node
// Replays every local migration through provider-application credential removal, then exercises caller and Storage boundaries.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrations = join(process.cwd(), 'supabase/migrations')
const migrationName = '20261006130000_provider_application_draft_document_removal.sql'
const uid = n => `87000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db, applicationId, specialtyId

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist, pgcrypto } })
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.buckets,storage.objects to anon, authenticated, service_role;`)
  for (const name of readdirSync(migrations).filter(file => file.endsWith('.sql') && file <= migrationName).sort()) {
    await db.exec(readFileSync(join(migrations, name), 'utf8'))
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4),($5)', [uid(1), uid(2), uid(3), uid(4), uid(5)])
  await db.query("select public.create_patient_registration($1::jsonb)", [JSON.stringify({ userId: uid(1), fullName: 'Applicant One', phone: '+959860000101', dateOfBirth: '1990-01-01', medicalProfile: {} })])
  await db.query("select public.create_patient_registration($1::jsonb)", [JSON.stringify({ userId: uid(2), fullName: 'Applicant Two', phone: '+959860000102', dateOfBirth: '1991-01-01', medicalProfile: {} })])
  await db.query("insert into profiles(id,role,full_name) values ($1,'doctor','Verified Doctor')", [uid(3)])
  await db.query("insert into providers(profile_id,provider_type,license_number,verification_status,display_name,consultation_fee_mmk) values ($1,'doctor','EXISTING-DOCTOR-LICENSE','verified','Verified Doctor',0)", [uid(3)])
  await db.query("insert into profiles(id,role,full_name) values ($1,'main_admin','Review Admin')", [uid(4)])
  await db.query("select public.create_patient_registration($1::jsonb)", [JSON.stringify({ userId: uid(5), fullName: 'Applicant Three', phone: '+959860000103', dateOfBirth: '1992-01-01', medicalProfile: {} })])
  specialtyId = (await db.query('select id from specialties order by name limit 1')).rows[0].id
}, 120000)

afterAll(async () => db?.close())

async function as(userId, role = 'authenticated') {
  await db.exec('begin')
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ? uid(userId) : ''])
  await db.exec(`set local role ${role}`)
}

describe('provider application migration and security boundaries', () => {
  it('replays cleanly and creates a private credential bucket and separate lifecycle table', async () => {
    const bucket = (await db.query("select public from storage.buckets where id='provider-credential-evidence'")).rows[0]
    expect(bucket.public).toBe(false)
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='provider_applications'")).rows.map(row => row.column_name)
    expect(columns).toContain('status')
    expect(columns).not.toContain('verified_by')
    expect(columns).not.toContain('provider_id')
    expect((await db.query("select unnest(enum_range(null::public.provider_application_status))::text status")).rows.map(row => row.status)).toEqual(['draft','submitted','under_review','verified','rejected','withdrawn'])
    expect((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='provider_application_review_events'")).rows.map(row => row.column_name)).toContain('reviewer_profile_id')
    expect((await db.query('select unnest(enum_range(null::public.provider_type))::text provider_type')).rows.map(row => row.provider_type)).toEqual(['doctor','nurse','nurse_aide','caregiver','skilled_nurse_aide','special_nurse'])
  })

  it('starts, saves and reads a draft using auth.uid identity only', async () => {
    await as(1)
    const initial = await db.query('select public.get_my_provider_application() as result')
    expect(initial.rows[0].result.profile).toMatchObject({ full_name: 'Applicant One', phone: '+959860000101' })
    expect(initial.rows[0].result.application).toBeNull()
    const created = await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type: 'doctor', specialty_id: specialtyId, organization: 'Clinic A' })])
    applicationId = created.rows[0].id
    await db.query('select public.save_provider_application_draft($1,$2::jsonb)', [applicationId, JSON.stringify({ requested_provider_type: 'doctor', specialty_id: specialtyId, organization: 'Clinic B' })])
    const result = await db.query('select public.get_my_provider_application() as result')
    expect(result.rows[0].result.application).toMatchObject({ id: applicationId, status: 'draft', organization: 'Clinic B' })
    expect((await db.query('select role from profiles where id=$1', [uid(1)])).rows[0].role).toBe('patient')
    expect((await db.query('select count(*)::int count from providers where profile_id=$1', [uid(1)])).rows[0].count).toBe(0)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([])
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows).toEqual([])
    await db.exec('commit')
  })

  it('denies direct application writes and cross-applicant reads or submissions', async () => {
    await as(2)
    await expect(db.query('select public.save_provider_application_draft(null,$1::jsonb)', [JSON.stringify({ applicant_profile_id: uid(1) })])).rejects.toMatchObject({ code: '22023' })
    await db.exec('rollback')
    await as(2)
    await expect(db.query('select public.submit_provider_application($1)', [applicationId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
    await as(2)
    await expect(db.query('select * from public.provider_applications')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
    await as(2)
    const other = await db.query('select public.get_my_provider_application() as result')
    expect(other.rows[0].result.application).toBeNull()
    await db.exec('rollback')
  })

  it('accepts private owner uploads, records metadata, and submits without provisioning provider access', async () => {
    const path = `${uid(1)}/${applicationId}/license-proof.pdf`
    await as(1)
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', path])
    await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6)', [applicationId,'professional_license','license-proof.pdf',path,'application/pdf',2048])
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(1)
    await db.query('select public.save_provider_application_draft($1,$2::jsonb)', [applicationId, JSON.stringify({ requested_provider_type:'doctor', specialty_id:specialtyId, license_number:'MD-1234', license_issuer:'Health Council', qualifications:'MD', years_experience:8, organization:'Clinic', professional_bio:'Experienced clinician', languages:['English'], service_area:'Yangon' })])
    expect((await db.query('select public.submit_provider_application($1) as status', [applicationId])).rows[0].status).toBe('submitted')
    expect((await db.query('select role from profiles where id=$1', [uid(1)])).rows[0].role).toBe('patient')
    expect((await db.query('select count(*)::int count from providers where profile_id=$1', [uid(1)])).rows[0].count).toBe(0)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([])
    await db.exec('commit')
  })

  it('keeps a submitted application immutable to the applicant', async () => {
    await as(1)
    await expect(db.query('select public.save_provider_application_draft($1,$2::jsonb)', [applicationId, '{}'])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
  })

  it('blocks cross-user and public storage access while preserving the existing verified provider identity', async () => {
    const path = `${uid(1)}/${applicationId}/license-proof.pdf`
    await as(2)
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(0)
    expect((await db.query('select public.get_my_provider_application() as result')).rows[0].result.application).toBeNull()
    await db.exec('rollback')
    await as(null, 'anon')
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(0)
    await db.exec('rollback')
    await as(3)
    expect((await db.query('select public.get_my_provider_application() as result')).rows[0].result.is_verified_provider).toBe(true)
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toHaveLength(1)
    await db.exec('rollback')
    await as(3)
    await expect(db.query('select public.save_provider_application_draft(null,$1::jsonb)', ['{}'])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
  })

  it('limits review RPCs and private credential reads to the active main admin', async () => {
    const path = `${uid(1)}/${applicationId}/license-proof.pdf`
    await as(2)
    await expect(db.query('select * from public.admin_list_provider_applications(null)')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
    await as(3)
    await expect(db.query('select public.admin_start_provider_application_review($1)', [applicationId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
    await as(2)
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(0)
    await db.exec('rollback')
    await as(4)
    expect((await db.query('select * from public.admin_list_provider_applications(null)')).rows).toHaveLength(1)
    expect((await db.query('select public.admin_get_provider_application($1) as result', [applicationId])).rows[0].result.applicant.full_name).toBe('Applicant One')
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(1)
    await expect(db.query('select public.admin_start_provider_application_review($1)', [applicationId])).resolves.toBeTruthy()
    await db.exec('commit')
  })

  it('prevents applicant-controlled review and self-approval, then atomically provisions the approved provider', async () => {
    await as(1)
    await expect(db.query('select public.admin_start_provider_application_review($1)', [applicationId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')
    await as(1)
    await expect(db.query("update public.provider_applications set status='under_review' where id=$1", [applicationId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')

    await db.exec('begin')
    await db.query("update public.profiles set role='main_admin' where id=$1", [uid(1)])
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(1)])
    await db.exec('set local role authenticated')
    await expect(db.query('select public.admin_approve_provider_application($1)', [applicationId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')

    await as(4)
    const approvedProviderId = (await db.query('select public.admin_approve_provider_application($1) as id', [applicationId])).rows[0].id
    const provider = (await db.query('select * from public.providers where id=$1', [approvedProviderId])).rows[0]
    expect(provider).toMatchObject({ profile_id: uid(1), provider_type: 'doctor', verification_status: 'verified' })
    expect(provider.verified_at).toBeTruthy()
    expect((await db.query('select role from public.profiles where id=$1', [uid(1)])).rows[0].role).toBe('doctor')
    expect((await db.query('select count(*)::int count from public.providers where profile_id=$1', [uid(1)])).rows[0].count).toBe(1)
    expect((await db.query('select * from public.provider_specialties where provider_id=$1', [approvedProviderId])).rows).toMatchObject([{ specialty_id: specialtyId, is_primary: true }])
    const credential = (await db.query('select * from public.provider_credentials where provider_id=$1', [approvedProviderId])).rows[0]
    expect(credential).toMatchObject({ credential_type: 'professional_license', credential_number: 'MD-1234', issuer: 'Health Council', verification_status: 'verified', verified_by: uid(4), source_application_id: applicationId })
    expect(credential.verified_at).toBeTruthy()
    const state = (await db.query('select public.admin_get_provider_application($1) as result', [applicationId])).rows[0].result.application
    expect(state).toMatchObject({ status: 'verified', decided_by_profile_id: uid(4), provisioned_provider_id: approvedProviderId })
    await expect(db.query('select public.admin_approve_provider_application($1)', [applicationId])).resolves.toMatchObject({ rows: [{ admin_approve_provider_application: approvedProviderId }] })
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(1)])
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toHaveLength(1)
    expect((await db.query('select * from public.list_my_clinical_patients()')).rows).toEqual([])
    await db.exec('commit')
    expect((await db.query("select count(*)::int count from public.provider_application_review_events where application_id=$1 and reviewer_profile_id=$2 and event_type in ('under_review','verified')", [applicationId, uid(4)])).rows[0].count).toBe(2)
    expect((await db.query("select count(*)::int count from public.audit_logs where actor_profile_id=$1", [uid(4)])).rows[0].count).toBeGreaterThan(0)
  })

  it('rejects with an applicant-safe reason and leaves the applicant non-provider', async () => {
    await as(5)
    const secondApplicationId = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type:'nurse_aide', specialty_id:specialtyId, license_number:'NA-5678', license_issuer:'Health Council', qualifications:'Nursing assistant certificate' })])).rows[0].id
    expect((await db.query('select specialty_id from public.provider_applications where id=$1', [secondApplicationId])).rows[0].specialty_id).toBeNull()
    const path = `${uid(5)}/${secondApplicationId}/certificate.pdf`
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', path])
    await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6)', [secondApplicationId,'qualification_certificate','certificate.pdf',path,'application/pdf',1024])
    await db.query('select public.submit_provider_application($1)', [secondApplicationId])
    await db.exec('commit')
    await as(4)
    await db.query('select public.admin_start_provider_application_review($1)', [secondApplicationId])
    await db.query('select public.admin_reject_provider_application($1,$2)', [secondApplicationId,'Please provide a current qualification document.'])
    await db.exec('commit')
    await as(5)
    const applicantResult = (await db.query('select public.get_my_provider_application() as result')).rows[0].result.application
    expect(applicantResult).toMatchObject({ status:'rejected', decision_reason:'Please provide a current qualification document.' })
    expect(applicantResult).not.toHaveProperty('decided_by_profile_id')
    expect(applicantResult).not.toHaveProperty('provisioned_provider_id')
    expect((await db.query('select role from public.profiles where id=$1', [uid(5)])).rows[0].role).toBe('patient')
    expect((await db.query('select * from public.get_my_provider_identity()')).rows).toEqual([])
    expect((await db.query('select count(*)::int count from public.providers where profile_id=$1', [uid(5)])).rows[0].count).toBe(0)
    await db.exec('commit')
  })

  it('accepts nursing subtypes without specialty and provisions them through the existing nurse role', async () => {
    await db.query('insert into auth.users(id) values ($1),($2)', [uid(6), uid(7)])
    await db.query("select public.create_patient_registration($1::jsonb)", [JSON.stringify({ userId: uid(6), fullName: 'Skilled Nurse Applicant', phone: '+959860000106', dateOfBirth: '1993-01-01', medicalProfile: {} })])
    await db.query("select public.create_patient_registration($1::jsonb)", [JSON.stringify({ userId: uid(7), fullName: 'Special Nurse Applicant', phone: '+959860000107', dateOfBirth: '1994-01-01', medicalProfile: {} })])

    for (const [userId, type] of [[6, 'skilled_nurse_aide'], [7, 'special_nurse']]) {
      await as(userId)
      const id = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type: type, specialty_id: 'not-a-uuid', license_number: `LICENSE-${type}`, license_issuer: 'Health Council', qualifications: 'Nursing credential' })])).rows[0].id
      expect((await db.query('select specialty_id from public.provider_applications where id=$1', [id])).rows[0].specialty_id).toBeNull()
      const path = `${uid(userId)}/${id}/credential.pdf`
      await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', path])
      await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6)', [id,'qualification_certificate','credential.pdf',path,'application/pdf',1024])
      expect((await db.query('select public.submit_provider_application($1) as status', [id])).rows[0].status).toBe('submitted')
      await db.exec('commit')
      await as(4)
      await db.query('select public.admin_start_provider_application_review($1)', [id])
      const providerId = (await db.query('select public.admin_approve_provider_application($1) as id', [id])).rows[0].id
      await db.exec('commit')
      const provisioned = await db.query('select id,profile_id,provider_type from public.providers where id=$1', [providerId])
      expect(provisioned.rows, `provider row ${providerId} for ${type}`).toHaveLength(1)
      expect(provisioned.rows[0].profile_id).toBe(uid(userId))
      expect(provisioned.rows[0].provider_type).toBe(type)
      expect((await db.query('select role from public.profiles where id=$1', [uid(userId)])).rows[0].role).toBe('nurse')
      expect((await db.query('select * from public.provider_specialties where provider_id=(select id from public.providers where profile_id=$1)', [uid(userId)])).rows).toEqual([])
      await as(userId)
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(userId)])
      expect((await db.query('select provider_type from public.get_my_provider_identity()')).rows[0].provider_type).toBe(type)
      expect((await db.query('select * from public.list_my_clinical_patients()')).rows).toEqual([])
      await db.exec('commit')
    }
  })

  it('rolls back profile and provider writes when credential uniqueness prevents approval', async () => {
    await as(2)
    const collisionApp = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type:'doctor', specialty_id:specialtyId, license_number:'EXISTING-DOCTOR-LICENSE', license_issuer:'Health Council', qualifications:'MD' })])).rows[0].id
    const path = `${uid(2)}/${collisionApp}/proof.pdf`
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', path])
    await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6)', [collisionApp,'professional_license','proof.pdf',path,'application/pdf',1024])
    await db.query('select public.save_provider_application_draft($1,$2::jsonb)', [collisionApp,JSON.stringify({ requested_provider_type:'doctor', specialty_id:specialtyId, license_number:'EXISTING-DOCTOR-LICENSE', license_issuer:'Health Council', qualifications:'MD' })])
    await db.query('select public.submit_provider_application($1)', [collisionApp])
    await db.exec('commit')
    await as(4)
    await db.query('select public.admin_start_provider_application_review($1)', [collisionApp])
    await db.exec('commit')
    await as(4)
    await expect(db.query('select public.admin_approve_provider_application($1)', [collisionApp])).rejects.toMatchObject({ code: '23505' })
    await db.exec('rollback')
    expect((await db.query('select role from public.profiles where id=$1', [uid(2)])).rows[0].role).toBe('patient')
    expect((await db.query('select count(*)::int count from public.providers where profile_id=$1', [uid(2)])).rows[0].count).toBe(0)
    expect((await db.query('select status from public.provider_applications where id=$1', [collisionApp])).rows[0].status).toBe('under_review')
  })

  it('deletes only an owner-matched draft document through a service-only locked RPC', async () => {
    const users = [8, 9, 10, 11, 12, 13]
    await db.query('insert into auth.users(id) select unnest($1::uuid[])', [users.map(uid)])
    for (const userId of users) {
      await db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify({
        userId: uid(userId), fullName: `Removal Applicant ${userId}`, phone: `+959860000${String(userId).padStart(3, '0')}`,
        dateOfBirth: '1990-01-01', medicalProfile: {},
      })])
    }

    let draftId, draftDocumentId
    await as(8)
    draftId = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type: 'skilled_nurse_aide' })])).rows[0].id
    const draftPath = `${uid(8)}/${draftId}/draft-proof.pdf`
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', draftPath])
    draftDocumentId = (await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6) as id', [draftId,'other','draft-proof.pdf',draftPath,'application/pdf',100])).rows[0].id
    await db.exec('commit')

    await as(13)
    const otherAppId = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type: 'caregiver' })])).rows[0].id
    const otherPath = `${uid(13)}/${otherAppId}/other-application.pdf`
    await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence', otherPath])
    const otherDocumentId = (await db.query('select public.record_provider_application_document($1,$2,$3,$4,$5,$6) as id', [otherAppId,'other','other-application.pdf',otherPath,'application/pdf',100])).rows[0].id
    await db.exec('commit')

    expect((await db.query("select has_function_privilege('authenticated','public.delete_provider_application_document_for_owner(uuid,uuid,uuid)','execute') as allowed")).rows[0].allowed).toBe(false)
    await as(8)
    await expect(db.query('select public.delete_provider_application_document_for_owner($1,$2,$3)', [uid(8), draftId, draftDocumentId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')

    await as(null, 'service_role')
    await expect(db.query('select public.delete_provider_application_document_for_owner($1,$2,$3)', [uid(9), draftId, draftDocumentId])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback')

    await as(null, 'service_role')
    const deleted = await db.query('select public.delete_provider_application_document_for_owner($1,$2,$3) as document', [uid(8), draftId, draftDocumentId])
    expect(deleted.rows[0].document).toMatchObject({ id: draftDocumentId, application_id: draftId, applicant_profile_id: uid(8), storage_path: draftPath })
    await db.exec('commit')
    expect((await db.query('select count(*)::int count from provider_application_documents where id=$1', [draftDocumentId])).rows[0].count).toBe(0)
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [draftPath])).rows[0].count).toBe(1)
    expect((await db.query('select count(*)::int count from provider_application_documents where id=$1 and application_id=$2', [otherDocumentId,otherAppId])).rows[0].count).toBe(1)
    expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [otherPath])).rows[0].count).toBe(1)

    for (const [userId, status] of [[9,'submitted'],[10,'under_review'],[11,'verified'],[12,'rejected']]) {
      await as(userId)
      const appId = (await db.query('select public.save_provider_application_draft(null,$1::jsonb) as id', [JSON.stringify({ requested_provider_type: 'nurse_aide' })])).rows[0].id
      await db.exec('commit')
      const path = `${uid(userId)}/${appId}/locked-proof.pdf`
      await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', ['provider-credential-evidence',path])
      const recordedId = (await db.query(`insert into provider_application_documents(application_id,applicant_profile_id,document_type,file_name,storage_path,mime_type,file_size)
        values ($1,$2,'other','locked-proof.pdf',$3,'application/pdf',100) returning id`, [appId,uid(userId),path])).rows[0].id
      await db.query(`update provider_applications set status=$2::public.provider_application_status,submitted_at=statement_timestamp(),
        review_started_by_profile_id=case when $2::public.provider_application_status in ('under_review','verified','rejected') then $3::uuid else null end,
        review_started_at=case when $2::public.provider_application_status in ('under_review','verified','rejected') then statement_timestamp() else null end,
        decided_by_profile_id=case when $2::public.provider_application_status in ('verified','rejected') then $3::uuid else null end,
        decided_at=case when $2::public.provider_application_status in ('verified','rejected') then statement_timestamp() else null end,
        provisioned_provider_id=case when $2::public.provider_application_status='verified' then (select id from providers where profile_id=$4::uuid) else null end,
        decision_reason=case when $2::public.provider_application_status='rejected' then 'Synthetic rejection test reason' else null end
        where id=$1`, [appId,status,uid(4),uid(3)])
      await as(null,'service_role')
      await expect(db.query('select public.delete_provider_application_document_for_owner($1,$2,$3)', [uid(userId),appId,recordedId])).rejects.toMatchObject({ code: '42501' })
      await db.exec('rollback')
      expect((await db.query('select count(*)::int count from provider_application_documents where id=$1', [recordedId])).rows[0].count).toBe(1)
      expect((await db.query("select count(*)::int count from storage.objects where bucket_id='provider-credential-evidence' and name=$1", [path])).rows[0].count).toBe(1)
    }
  })
})
