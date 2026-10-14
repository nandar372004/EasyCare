// @vitest-environment node
// Actual migration chain in isolated PostgreSQL/WASM; managed Auth and Storage schemas are simulated.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const directory = join(process.cwd(), 'supabase/migrations')
const migrationName = '20260929130000_clinical_documents.sql'
const intakeMigrationName = '20261006140000_patient_medical_document_intake.sql'
const extractionMigrationName = '20261007100000_document_extraction_foundation.sql'
const classificationMigrationName = '20261007110000_document_classification_candidates.sql'
const structuredFactsMigrationName = '20261007120000_structured_health_fact_extraction.sql'
const factReviewMigrationName = '20261007130000_document_extracted_fact_review_workflow.sql'
const factExplanationMigrationName = '20261007140000_document_fact_plain_language_explanations.sql'
const bilingualFactExplanationMigrationName = '20261007150000_bilingual_document_fact_explanations.sql'
const canonicalMyanmarReviewMigrationName = '20261007160000_canonical_myanmar_confirmed_review_message.sql'
const alternateMyanmarReviewMessage = 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ।'
const uid = (n) => `76000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Phase 6 clinical documents', () => {
  let db, patients, providers, encounters, documents, patientsBefore, encountersBefore, policiesBefore

  async function actor(n, role = 'authenticated') {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n ? uid(n) : ''])
    await db.query("select set_config('request.jwt.claim.role', $1, true)", [role])
    await db.exec(`set local role ${role}`)
  }

  async function expectDenied(operation) {
    await db.exec('savepoint expected_denial')
    let error
    try { await operation() } catch (caught) { error = caught }
    await db.exec('rollback to savepoint expected_denial')
    await db.exec('release savepoint expected_denial')
    expect(error).toMatchObject({ code: '42501' })
  }

  beforeAll(async () => {
    db = new PGlite({ extensions: { btree_gist, pgcrypto } })
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    `)
    for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < migrationName).sort()) {
      await db.exec(readFileSync(join(directory, name), 'utf8'))
    }
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await db.query('insert into auth.users(id) values ($1)', [uid(n)])
    patients = []
    for (const n of [1, 2]) {
      patients.push((await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
        userId: uid(n), fullName: 'Synthetic Lab Patient', phone: `+95975000000${n}`, dateOfBirth: '1990-01-01', medicalProfile: {},
      })])).rows[0].id)
    }
    providers = {}
    for (const [n, role] of [[3, 'doctor'], [4, 'nurse'], [5, 'doctor'], [6, 'family'], [7, 'main_admin'], [8, 'family']]) {
      await db.query('insert into public.profiles(id, role, full_name) values ($1, $2, $3)', [uid(n), role, `Synthetic ${role}`])
      if (n <= 5) providers[n] = (await db.query("insert into public.providers(profile_id, provider_type, verification_status) values ($1, $2, 'verified') returning id", [uid(n), role])).rows[0].id
    }
    encounters = []
    for (const i of [0, 1]) {
      const appointment = (await db.query(`insert into public.appointments(patient_id, provider_id, appointment_type,
        scheduled_start, scheduled_end, consultation_channel, booking_code)
        values ($1, $2, 'teleconsultation', $3, $4, 'video', $5) returning id`,
      [patients[i], providers[i === 0 ? 3 : 5], `2026-09-${20 + i}T09:00Z`, `2026-09-${20 + i}T09:30Z`, `ECA-LAB-${i}`])).rows[0].id
      encounters.push((await db.query("insert into public.care_encounters(appointment_id, patient_id, provider_id, encounter_type) values ($1, $2, $3, 'teleconsultation') returning id", [appointment, patients[i], providers[i === 0 ? 3 : 5]])).rows[0].id)
    }
    const request = (await db.query("insert into public.care_requests(patient_id, requested_by_profile_id, service_type, reason_symptoms) values ($1, $2, 'teleconsultation', 'Synthetic') returning id", [patients[0], uid(1)])).rows[0].id
    await db.query("insert into public.care_assignments(care_request_id, provider_id, assigned_by_profile_id, status) values ($1, $2, $3, 'accepted')", [request, providers[4], uid(3)])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', true)", [patients[0], uid(6)])
    await db.query("insert into public.family_authorizations(patient_id, family_profile_id, status, can_view_records) values ($1, $2, 'active', false)", [patients[0], uid(8)])
    patientsBefore = (await db.query('select * from public.patients order by id')).rows
    encountersBefore = (await db.query('select * from public.care_encounters order by id')).rows
    policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows
    await db.exec(`
      create schema storage;
      create table storage.buckets(id text primary key, public boolean not null default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, unique(bucket_id, name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated, service_role;
      grant all on storage.objects to anon, authenticated, service_role;
      -- Deliberately broad legacy policies: restrictive guards must still protect clinical files.
      create policy legacy_all on storage.objects for all to anon, authenticated using (true) with check (true);
    `)
    await db.query("insert into storage.buckets(id,public) values ('clinical-documents',false),('medical-documents',false)")
    await db.exec(readFileSync(join(directory, migrationName), 'utf8'))
    documents = []
    await db.exec('set role service_role')
    for (const i of [0, 1]) {
      const path = `${patients[i]}/${uid(20 + i)}/scan.pdf`
      documents.push((await db.query(`insert into public.clinical_documents
        (id, patient_id, encounter_id, document_type, title, storage_path, mime_type, file_size, uploaded_by_profile_id)
        values ($1,$2,$3,'scan','Synthetic scan',$4,'application/pdf',100,$5) returning *`,
      [uid(20 + i), patients[i], encounters[i], path, uid(3)])).rows[0])
      await db.query("insert into storage.objects(bucket_id,name) values ('clinical-documents',$1)", [path])
    }
    await db.exec("insert into storage.objects(bucket_id,name) values ('clinical-documents','unlinked.pdf'), ('other-bucket','public.txt'); reset role")
    await db.exec(readFileSync(join(directory, intakeMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, extractionMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, classificationMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, structuredFactsMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, factReviewMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, factExplanationMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, bilingualFactExplanationMigrationName), 'utf8'))
    await db.exec(readFileSync(join(directory, canonicalMyanmarReviewMigrationName), 'utf8'))
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('creates metadata only and preserves existing records/policies', async () => {
    expect((await db.query("select column_name from information_schema.columns where table_name='clinical_documents' order by ordinal_position")).rows.map(r => r.column_name)).toEqual([
      'id', 'patient_id', 'encounter_id', 'document_type', 'title', 'description', 'storage_path', 'mime_type', 'file_size', 'document_date', 'uploaded_by_profile_id', 'created_at',
      'original_filename', 'storage_bucket', 'source', 'status', 'updated_at', 'removed_at',
    ])
    expect(documents[0].created_at).toBeTruthy()
    expect((await db.query('select * from public.patients order by id')).rows).toEqual(patientsBefore)
    expect((await db.query('select * from public.care_encounters order by id')).rows).toEqual(encountersBefore)
    expect((await db.query("select * from pg_policies where schemaname='public' and tablename not in ('clinical_documents','document_extractions','document_extracted_facts') order by tablename, policyname")).rows).toEqual(policiesBefore)
  })

  it.each([[1,0],[2,1],[3,0],[4,0],[5,1],[6,0]])('scopes metadata and files for authorized user %s', async (n, i) => {
    await actor(n)
    expect((await db.query('select id from public.clinical_documents')).rows).toEqual([{id: documents[i].id}])
    expect((await db.query("select name from storage.objects where bucket_id='clinical-documents'")).rows).toEqual([{name: documents[i].storage_path}])
  })

  it('allows the existing main admin authority but hides unlinked files', async () => {
    await actor(7)
    expect((await db.query('select id from public.clinical_documents')).rows).toHaveLength(2)
    expect((await db.query("select name from storage.objects where bucket_id='clinical-documents'")).rows).toHaveLength(2)
  })

  it.each(['provider','family'])('honors revoked %s authorization for files and metadata', async (kind) => {
    if (kind === 'provider') await db.query("update public.providers set verification_status='suspended' where id=$1", [providers[3]])
    else await db.exec('update public.family_authorizations set can_view_records=false')
    await actor(kind === 'provider' ? 3 : 6)
    expect((await db.query('select id from public.clinical_documents')).rows).toEqual([])
    expect((await db.query("select id from storage.objects where bucket_id='clinical-documents'")).rows).toEqual([])
  })

  it('denies anonymous metadata and file access despite broad Storage policy', async () => {
    await actor(null,'anon')
    expect((await db.query("select id from storage.objects where bucket_id='clinical-documents'")).rows).toEqual([])
    await expect(db.query('select * from public.clinical_documents')).rejects.toMatchObject({code:'42501'})
  })

  it.each(['authenticated','anon'])('blocks %s file writes and renames without affecting other buckets', async role => {
    await actor(role === 'authenticated' ? 1 : null, role)
    expect((await db.query("update storage.objects set name='changed' where bucket_id='clinical-documents' returning id")).rows).toEqual([])
    expect((await db.query("delete from storage.objects where bucket_id='clinical-documents' returning id")).rows).toEqual([])
    expect((await db.query("update storage.objects set name='allowed.txt' where bucket_id='other-bucket' returning id")).rows).toHaveLength(1)
    await db.exec('savepoint denied')
    await expect(db.query("insert into storage.objects(bucket_id,name) values ('clinical-documents','forbidden')")).rejects.toMatchObject({code:'42501'})
    await db.exec('rollback to savepoint denied')
    await expect(db.query("update storage.objects set bucket_id='clinical-documents' where bucket_id='other-bucket'")).rejects.toMatchObject({code:'42501'})
  })

  it('denies patient metadata writes even with accidental broad grants', async () => {
    await db.exec('grant insert,update,delete on public.clinical_documents to authenticated')
    await actor(1)
    expect((await db.query("update public.clinical_documents set title='spoof' returning id")).rows).toEqual([])
    expect((await db.query('delete from public.clinical_documents returning id')).rows).toEqual([])
    await expect(db.query(`insert into public.clinical_documents select * from public.clinical_documents`)).rejects.toMatchObject({code:'42501'})
  })

  it.each(['patient_id','encounter_id','uploaded_by_profile_id'])('enforces %s FK', async column => {
    const pathUpdate = column === 'patient_id' ? ", storage_path = ($1::uuid)::text || '/' || id::text || '/scan.pdf'" : ''
    await expect(db.query(`update public.clinical_documents set ${column}=$1::uuid${pathUpdate} where id=$2`, [uid(99),documents[0].id])).rejects.toMatchObject({code:'23503'})
  })
  it('rejects paths pointing to another patient or document', async () => {
    await expect(db.query('update public.clinical_documents set storage_path=$1 where id=$2',
      [`${patients[1]}/${documents[0].id}/scan.pdf`,documents[0].id])).rejects.toMatchObject({code:'23514'})
  })
  it('prevents deletion of a referenced patient, encounter or uploader', async () => {
    for (const [table,id] of [['patients',patients[0]],['care_encounters',encounters[0]],['profiles',uid(3)]]) {
      await db.exec('savepoint fk_check')
      try {
        await db.query(`delete from public.${table} where id=$1`,[id])
        throw new Error('Deletion unexpectedly succeeded')
      } catch (error) {
        expect(['23503','23001']).toContain(error.code)
      }
      await db.exec('rollback to savepoint fk_check')
    }
  })
  it('rejects cross-patient encounter linkage', async () => {
    await expect(db.query('update public.clinical_documents set encounter_id=$1 where id=$2',[encounters[1],documents[0].id])).rejects.toMatchObject({code:'23503'})
  })
  it.each([
    ['title',"' '"], ['document_type',"'Invalid type'"], ['mime_type',"'invalid'"],
    ['file_size','0'], ['file_size','-1'], ['document_date',"'infinity'"], ['created_at',"'infinity'"],
    ['storage_path',"'https://example.com/file.pdf'"], ['storage_path',"'../file.pdf'"],
  ])('rejects invalid %s = %s', async (column,value) => {
    await expect(db.query(`update public.clinical_documents set ${column}=${value} where id=$1`,[documents[0].id])).rejects.toMatchObject({code:'23514'})
  })
  it('supports documents without encounters and trusted metadata updates', async () => {
    await actor(null,'service_role')
    expect((await db.query("update public.clinical_documents set encounter_id=null, description='Reviewed', document_date='2026-09-29' where id=$1 returning description",[documents[0].id])).rows).toEqual([{description:'Reviewed'}])
  })

  it('records an uploaded source file from the authenticated patient without browser-supplied ownership fields', async () => {
    const documentId = uid(30)
    const path = `${patients[0]}/${documentId}/${uid(31)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)", [path])
    await actor(1)
    const result = await db.query(`select public.record_my_medical_document($1,'discharge_summary','Discharge','discharge.pdf',$2,'application/pdf',100,'2026-08-12') as id`, [documentId,path])
    expect(result.rows[0].id).toBe(documentId)
    expect((await db.query('select patient_id,uploaded_by_profile_id,source,status,storage_bucket,original_filename from public.clinical_documents where id=$1',[documentId])).rows[0])
      .toEqual({patient_id:patients[0],uploaded_by_profile_id:uid(1),source:'patient_upload',status:'active',storage_bucket:'medical-documents',original_filename:'discharge.pdf'})
    expect((await db.query('select id from public.patient_conditions')).rows).toEqual([])
    expect((await db.query('select id from public.patient_medications')).rows).toEqual([])
    expect((await db.query('select id from public.prescriptions')).rows).toEqual([])
  })

  it('rejects another patient path, unsupported document type, and mismatched file suffix', async () => {
    async function expectSqlError(sql, args, code) {
      await db.exec('savepoint invalid_document')
      await expect(db.query(sql, args)).rejects.toMatchObject({code})
      await db.exec('rollback to savepoint invalid_document')
    }
    const documentId = uid(32)
    const otherPatientPath = `${patients[1]}/${documentId}/${uid(33)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)", [otherPatientPath])
    await actor(1)
    await expectSqlError(`select public.record_my_medical_document($1,'other',null,'file.pdf',$2,'application/pdf',100,null)`,[documentId,otherPatientPath],'22023')
    const ownPath = `${patients[0]}/${uid(34)}/${uid(35)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)",[ownPath])
    await actor(1)
    await expectSqlError(`select public.record_my_medical_document($1,'diagnosis',null,'file.pdf',$2,'application/pdf',100,null)`,[uid(34),ownPath],'22023')
    await expectSqlError(`select public.record_my_medical_document($1,'other',null,'file.pdf',$2,'image/jpeg',100,null)`,[uid(34),ownPath],'22023')
  })

  it('applies current record-scope access to patient-upload metadata and private file rows', async () => {
    const documentId = uid(36)
    const path = `${patients[0]}/${documentId}/${uid(37)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)",[path])
    await actor(1)
    await db.query(`select public.record_my_medical_document($1,'lab_report',null,'report.pdf',$2,'application/pdf',100,null)`,[documentId,path])
    expect((await db.query("select name from storage.objects where bucket_id='medical-documents'")).rows).toEqual([{name:path}])
    await actor(6)
    expect((await db.query('select id from public.clinical_documents where id=$1',[documentId])).rows).toHaveLength(1)
    expect((await db.query("select name from storage.objects where bucket_id='medical-documents'")).rows).toEqual([{name:path}])
    await actor(5)
    expect((await db.query('select id from public.clinical_documents where id=$1',[documentId])).rows).toEqual([])
    expect((await db.query("select name from storage.objects where bucket_id='medical-documents'")).rows).toEqual([])
    await actor(null,'anon')
    expect((await db.query("select name from storage.objects where bucket_id='medical-documents'")).rows).toEqual([])
  })

  it('hides removed uploads and blocks browser-managed Storage writes', async () => {
    const documentId = uid(38)
    const path = `${patients[0]}/${documentId}/${uid(39)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)",[path])
    await actor(1)
    await db.query(`select public.record_my_medical_document($1,'other',null,'file.pdf',$2,'application/pdf',100,null)`,[documentId,path])
    await actor(8, 'service_role')
    await db.query("update public.clinical_documents set status='removed', removed_at=statement_timestamp() where id=$1",[documentId])
    await actor(1)
    expect((await db.query('select id from public.clinical_documents where id=$1',[documentId])).rows).toEqual([])
    expect((await db.query("select name from storage.objects where bucket_id='medical-documents'")).rows).toEqual([])
    await expect(db.query("insert into storage.objects(bucket_id,name) values ('medical-documents','forbidden')")).rejects.toMatchObject({code:'42501'})
  })

  it('does not expose the removal metadata transition as an authenticated RPC', async () => {
    await actor(1)
    const routines = (await db.query("select routine_name from information_schema.routines where routine_schema='public' and routine_name like '%medical_document%'")).rows
    expect(routines.map(row => row.routine_name)).toEqual(['record_my_medical_document'])
  })

  it('creates one pending run for an active authorized document without changing clinical truth', async () => {
    const before = await db.query("select (select count(*) from public.patient_conditions) as conditions, (select count(*) from public.patient_allergies) as allergies, (select count(*) from public.patient_medications) as medications, (select count(*) from public.prescriptions) as prescriptions")
    await actor(1)
    const first = (await db.query('select public.request_my_document_extraction($1) as id', [documents[0].id])).rows[0].id
    const second = (await db.query('select public.request_my_document_extraction($1) as id', [documents[0].id])).rows[0].id
    expect(second).toBe(first)
    expect((await db.query('select extraction_status,clinical_document_id,patient_id,requested_by_profile_id from public.document_extractions where id=$1', [first])).rows)
      .toEqual([{extraction_status:'pending',clinical_document_id:documents[0].id,patient_id:patients[0],requested_by_profile_id:uid(1)}])
    const after = await db.query("select (select count(*) from public.patient_conditions) as conditions, (select count(*) from public.patient_allergies) as allergies, (select count(*) from public.patient_medications) as medications, (select count(*) from public.prescriptions) as prescriptions")
    expect(after.rows).toEqual(before.rows)
  })

  it('denies another patient and removed or unavailable source documents', async () => {
    await actor(1)
    await expectDenied(() => db.query('select public.request_my_document_extraction($1)', [documents[1].id]))

    const unavailableId = uid(52)
    await actor(8, 'service_role')
    await db.query("insert into public.clinical_documents (id,patient_id,document_type,title,storage_path,mime_type,file_size,uploaded_by_profile_id,original_filename,storage_bucket,source,status) values ($1,$2,'other','Unavailable synthetic source',$3,'application/pdf',100,$4,'unavailable.pdf','medical-documents','patient_upload','active')",
      [unavailableId, patients[0], patients[0] + '/' + unavailableId + '/' + uid(53) + '.pdf', uid(1)])
    await actor(1)
    await expectDenied(() => db.query('select public.request_my_document_extraction($1)', [unavailableId]))

    await actor(8, 'service_role')
    await db.query("update public.clinical_documents set status='removed',removed_at=statement_timestamp() where id=$1", [documents[0].id])
    await actor(1)
    await expectDenied(() => db.query('select public.request_my_document_extraction($1)', [documents[0].id]))
  })

  it('preserves patient, document, extraction-run and source-locator provenance', async () => {
    await actor(1)
    const extractionId = (await db.query('select public.request_my_document_extraction($1) as id', [documents[0].id])).rows[0].id
    await actor(8, 'service_role')
    await db.query("update public.document_extractions set extraction_status='needs_review',document_type='lab_report',summary='Candidate summary from source',started_at=statement_timestamp(),completed_at=statement_timestamp() where id=$1", [extractionId])
    const factId = uid(54)
    await db.query("insert into public.document_extracted_facts (id,extraction_id,clinical_document_id,patient_id,fact_type,name,value_text,source_page,source_excerpt,confidence,review_status,explanation) values ($1,$2,$3,$4,'lab_result','Example analyte','4.2 mmol/L',1,'Example analyte 4.2 mmol/L',0.82,'needs_review','Candidate transcription only')",
      [factId, extractionId, documents[0].id, patients[0]])
    await actor(1)
    expect((await db.query('select fact.extraction_id,fact.clinical_document_id,fact.patient_id,fact.source_page,fact.confidence,fact.review_status,extraction.extraction_status from public.document_extracted_facts fact join public.document_extractions extraction on extraction.id=fact.extraction_id where fact.id=$1', [factId])).rows).toEqual([{
      extraction_id:extractionId,clinical_document_id:documents[0].id,patient_id:patients[0],
      source_page:1,confidence:'0.8200',review_status:'needs_review',extraction_status:'needs_review',
    }])
    await actor(2)
    expect((await db.query('select id from public.document_extracted_facts where id=$1', [factId])).rows).toEqual([])
  })

  it('denies browser writes to extraction runs and candidate facts and limits requests to authenticated patients', async () => {
    await actor(1)
    await expectDenied(() => db.query('insert into public.document_extractions(clinical_document_id,patient_id,requested_by_profile_id) values ($1,$2,$3)', [documents[0].id, patients[0], uid(1)]))
    await expectDenied(() => db.query("insert into public.document_extracted_facts (extraction_id,clinical_document_id,patient_id,fact_type,name,value_text,source_page,confidence,explanation) values ($1,$2,$3,'other','spoof','value',1,0.9,'spoof')", [uid(80), documents[0].id, patients[0]]))
    await actor(null, 'anon')
    await expectDenied(() => db.query('select public.request_my_document_extraction($1)', [documents[0].id]))
  })

  async function classificationRun() {
    const id = uid(90)
    const path = `${patients[0]}/${id}/${uid(91)}.pdf`
    await actor(8, 'service_role')
    await db.query("insert into storage.objects(bucket_id,name) values ('medical-documents',$1)", [path])
    await actor(1)
    await db.query(`select public.record_my_medical_document($1,'other','Synthetic classification source',
      'source.pdf',$2,'application/pdf',100,null)`, [id, path])
    const runId = (await db.query('select public.request_my_document_extraction($1) as id', [id])).rows[0].id
    return { id, path, runId }
  }

  async function saveClassification(runId, type = 'lab_report', confidence = 0.95) {
    return db.query(`select public.record_document_classification_candidate($1,$2,$3,
      'synthetic-test','classifier','v1') as id`, [runId, type, confidence])
  }

  describe('Phase I Step 2 classification persistence', () => {
    it.each(['lab_report', 'prescription', 'imaging_report', 'discharge_summary', 'referral', 'progress_note', 'other'])
      ('records only a source-linked %s classification requiring review', async type => {
        const { id, runId } = await classificationRun()
        const clinicalTables = [
          'clinical_documents', 'patients', 'profiles', 'providers', 'provider_credentials',
          'patient_conditions', 'patient_allergies', 'patient_medications', 'medication_schedules',
          'medication_events', 'prescriptions', 'prescription_items',
        ]
        const snapshot = async () => {
          const result = {}
          for (const table of clinicalTables) result[table] = (await db.query(`select * from public.${table} order by id`)).rows
          return result
        }
        await actor(8, 'service_role')
        const before = await snapshot()
        const confidence = type === 'other' ? 0.2 : 0.95
        expect((await saveClassification(runId, type, confidence)).rows).toEqual([{ id: runId }])
        expect(await snapshot()).toEqual(before)
        expect((await db.query('select count(*)::integer as total from public.document_extracted_facts')).rows).toEqual([{ total: 0 }])
        await actor(1)
        expect((await db.query(`select clinical_document_id,patient_id,document_type,classification_confidence,
          classification_review_required,extraction_status,classified_at is not null as classified,
          schema_version,prompt_version from public.document_extractions where id=$1`, [runId])).rows)
          .toEqual([{ clinical_document_id: id, patient_id: patients[0], document_type: type,
            classification_confidence: String(confidence), classification_review_required: true,
            extraction_status: 'needs_review', classified: true,
            schema_version: 'document-classification-v1', prompt_version: 'document-classification-v1' }])
        expect((await db.query('select document_type from public.clinical_documents where id=$1', [id])).rows)
          .toEqual([{ document_type: 'other' }])
        await actor(2)
        expect((await db.query('select id from public.document_extractions where id=$1', [runId])).rows).toEqual([])
      })

    it.each(['anon', 'authenticated'])('denies classification persistence to %s', async role => {
      const { id, path, runId } = await classificationRun()
      await actor(role === 'anon' ? null : 1, role)
      await expectDenied(() => saveClassification(runId))
    })

    it.each(['removed', 'missing file', 'inactive patient', 'inactive profile', 'wrong owner'])
      ('rechecks %s before recording a classification candidate', async reason => {
        const { id, path, runId } = await classificationRun()
        await actor(8, 'service_role')
        if (reason === 'removed') await db.query("update public.clinical_documents set status='removed',removed_at=statement_timestamp() where id=$1", [id])
        if (reason === 'missing file') await db.query("delete from storage.objects where bucket_id='medical-documents' and name=$1", [path])
        if (reason === 'inactive patient' || reason === 'inactive profile') {
          // Fixture administrator connection: table-owner privileges plus the
          // main-admin identity required by managed-field protection triggers.
          await actor(7)
          await db.exec('reset role')
        }
        if (reason === 'inactive patient') await db.query("update public.patients set status='inactive' where id=$1", [patients[0]])
        if (reason === 'inactive profile') await db.query("update public.profiles set status='suspended' where id=$1", [uid(1)])
        if (reason === 'inactive patient' || reason === 'inactive profile') await actor(8, 'service_role')
        if (reason === 'wrong owner') await db.query('update public.document_extractions set requested_by_profile_id=$1 where id=$2', [uid(2), runId])
        await expectDenied(() => saveClassification(runId))
        expect((await db.query('select classified_at,classification_confidence from public.document_extractions where id=$1', [runId])).rows)
          .toEqual([{ classified_at: null, classification_confidence: null }])
      })

    it.each([['unsupported type','diagnosis',0.9], ['negative confidence','lab_report',-0.1],
      ['confidence above one','lab_report',1.1], ['null confidence','lab_report',null],
      ['null type',null,0.9], ['NaN confidence','lab_report','NaN']])
      ('rejects %s at the database boundary', async (_reason, type, confidence) => {
        const { runId } = await classificationRun()
        await actor(8, 'service_role')
        await db.exec('savepoint invalid_classification')
        let error
        try { await saveClassification(runId, type, confidence) } catch (caught) { error = caught }
        await db.exec('rollback to savepoint invalid_classification')
        expect(error).toMatchObject({ code: '23514' })
      })

    it('does not overwrite a classified run on retry', async () => {
      const { runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      await expectDenied(() => saveClassification(runId, 'prescription'))
      expect((await db.query('select document_type from public.document_extractions where id=$1', [runId])).rows)
        .toEqual([{ document_type: 'lab_report' }])
    })

    it('enforces mandatory review even on privileged direct candidate updates', async () => {
      const { runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId, 'other', 0.1)
      await db.exec('savepoint clear_classification_review')
      let error
      try {
        await db.query('update public.document_extractions set classification_review_required=false where id=$1', [runId])
      } catch (caught) { error = caught }
      await db.exec('rollback to savepoint clear_classification_review')
      expect(error).toMatchObject({ code: '23514' })
    })
  })

  describe('Phase I Step 3 structured candidate fact persistence', () => {
    const fact = overrides => ({
      factType: 'lab_result', name: 'Synthetic marker', valueText: null, valueNumeric: 1.2,
      unit: 'units', referenceRangeText: null, observedAt: null, observedAtTime: null,
      abnormalFlag: null, strengthText: null, formText: null, frequencyText: null,
      instructionText: null, recommendedAt: null, sourceContext: null,
      sourceLocator: { page: 1, section: 'Results', excerpt: 'Synthetic marker 1.2 units' },
      confidence: 0.9, reviewRequired: true, explanation: 'Synthetic source transcription.',
      ...overrides,
    })
    const saveFacts = (runId, facts) => db.query('select public.record_document_extracted_facts($1,$2,$3::jsonb) as inserted',
      [runId, 'Synthetic candidate summary.', JSON.stringify(facts)])

    it('persists only source-linked facts with needs_review and suppresses duplicate candidates', async () => {
      const { runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      const value = fact({ factType: 'medication_candidate', name: 'Synthetic medicine', valueNumeric: null,
        strengthText: '5 mg', frequencyText: 'once daily', sourceLocator: { page: 2, section: 'Medication', excerpt: 'Synthetic medicine 5 mg once daily' } })
      expect((await saveFacts(runId, [value])).rows).toEqual([{ inserted: 1 }])
      expect((await saveFacts(runId, [value])).rows).toEqual([{ inserted: 0 }])
      expect((await db.query(`select fact_type,name,strength_text,frequency_text,source_page,source_excerpt,review_status
        from public.document_extracted_facts where extraction_id=$1`, [runId])).rows).toEqual([{
        fact_type: 'medication_candidate', name: 'Synthetic medicine', strength_text: '5 mg',
        frequency_text: 'once daily', source_page: 2, source_excerpt: 'Synthetic medicine 5 mg once daily', review_status: 'needs_review',
      }])
      expect((await db.query('select summary from public.document_extractions where id=$1', [runId])).rows)
        .toEqual([{ summary: 'Synthetic candidate summary.' }])
    })

    it.each(['anon', 'authenticated'])('denies candidate persistence to %s', async role => {
      const { runId } = await classificationRun()
      await actor(role === 'anon' ? null : 1, role)
      await expectDenied(() => saveFacts(runId, [fact()]))
    })

    it.each(['removed document', 'inactive patient', 'wrong owner'])('rechecks %s before persistence', async reason => {
      const { id, runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      if (reason === 'removed document') await db.query("update public.clinical_documents set status='removed',removed_at=statement_timestamp() where id=$1", [id])
      if (reason === 'inactive patient') {
        await actor(7)
        await db.exec('reset role')
        await db.query("update public.patients set status='inactive' where id=$1", [patients[0]])
      }
      if (reason === 'wrong owner') await db.query('update public.document_extractions set requested_by_profile_id=$1 where id=$2', [uid(2), runId])
      await actor(8, 'service_role')
      await expectDenied(() => saveFacts(runId, [fact()]))
      expect((await db.query('select count(*)::integer as total from public.document_extracted_facts where extraction_id=$1', [runId])).rows)
        .toEqual([{ total: 0 }])
    })

    it('rejects malformed, self-confirmed, and source-unlocated facts at the database boundary', async () => {
      const { runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      for (const invalid of [
        fact({ factType: 'diagnosis' }),
        fact({ reviewRequired: false }),
        fact({ sourceLocator: { page: null, section: null, excerpt: null } }),
      ]) {
        await db.exec('savepoint invalid_extracted_fact')
        let error
        try { await saveFacts(runId, [invalid]) } catch (caught) { error = caught }
        await db.exec('rollback to savepoint invalid_extracted_fact')
        expect(error).toMatchObject({ code: '23514' })
      }
    })
  })

  describe('Phase I Step 4 candidate fact review workflow', () => {
    async function reviewableFact() {
      const { id, path, runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      await db.query('select public.record_document_extracted_facts($1,$2,$3::jsonb)', [runId, 'Review fixture summary.', JSON.stringify([{
        factType: 'lab_result', name: 'Review fixture', valueText: null, valueNumeric: 1.2,
        unit: 'units', referenceRangeText: null, observedAt: null, observedAtTime: null,
        abnormalFlag: null, strengthText: null, formText: null, frequencyText: null,
        instructionText: null, recommendedAt: null, sourceContext: null,
        sourceLocator: { page: 1, section: 'Results', excerpt: 'Review fixture 1.2 units' },
        confidence: 0.42, reviewRequired: true, explanation: 'Low-confidence synthetic candidate requiring review.',
      }])])
      const factId = (await db.query('select id from public.document_extracted_facts where extraction_id=$1', [runId])).rows[0].id
      return { id, path, runId, factId }
    }

    it.each([
      ['high', 0.85], ['medium', 0.60], ['low', 0.59],
    ])('derives the %s confidence band without changing review status', async (band, confidence) => {
      const { runId } = await reviewableFact()
      await actor(8, 'service_role')
      await db.query('update public.document_extracted_facts set confidence=$1 where extraction_id=$2', [confidence, runId])
      expect((await db.query('select confidence_band,review_status from public.document_extracted_facts where extraction_id=$1', [runId])).rows)
        .toEqual([{ confidence_band: band, review_status: 'needs_review' }])
    })

    it('allows the active owner patient to decide, records reviewer/time/audit and preserves provenance', async () => {
      const { factId } = await reviewableFact()
      await actor(8, 'service_role')
      const before = (await db.query(`select patient_id,clinical_document_id,extraction_id,source_page,source_section,source_excerpt,confidence
        from public.document_extracted_facts where id=$1`, [factId])).rows[0]
      const clinicalBefore = {}
      for (const table of ['patient_conditions','patient_allergies','patient_medications','prescriptions','prescription_items']) {
        clinicalBefore[table] = (await db.query(`select count(*)::integer as total from public.${table}`)).rows[0].total
      }
      await actor(1)
      const result = (await db.query("select public.review_my_document_extracted_fact($1,'confirmed','Patient reviewed synthetic candidate.') as result", [factId])).rows[0].result
      expect(result).toMatchObject({ fact_id: factId, review_status: 'confirmed', review_note: 'Patient reviewed synthetic candidate.' })
      expect(result.reviewed_at).toBeTruthy()
      await actor(8, 'service_role')
      expect((await db.query(`select patient_id,clinical_document_id,extraction_id,source_page,source_section,source_excerpt,confidence,
        review_status,reviewed_by_profile_id,reviewed_at,review_note from public.document_extracted_facts where id=$1`, [factId])).rows[0])
        .toMatchObject({ ...before, review_status: 'confirmed', reviewed_by_profile_id: uid(1), review_note: 'Patient reviewed synthetic candidate.' })
      expect((await db.query('select fact_id,previous_status,new_status,reviewer_profile_id,review_note from public.document_extracted_fact_reviews where fact_id=$1', [factId])).rows)
        .toEqual([{ fact_id: factId, previous_status: 'needs_review', new_status: 'confirmed', reviewer_profile_id: uid(1), review_note: 'Patient reviewed synthetic candidate.' }])
      const clinicalAfter = {}
      for (const table of Object.keys(clinicalBefore)) clinicalAfter[table] = (await db.query(`select count(*)::integer as total from public.${table}`)).rows[0].total
      expect(clinicalAfter).toEqual(clinicalBefore)
    })

    it.each([
      ['unrelated patient', 2, 'authenticated'],
      ['provider', 3, 'authenticated'],
      ['Family member', 6, 'authenticated'],
      ['anonymous caller', null, 'anon'],
    ])('denies review by %s', async (_label, userNumber, role) => {
      const { factId } = await reviewableFact()
      await actor(userNumber, role)
      await expectDenied(() => db.query("select public.review_my_document_extracted_fact($1,'confirmed',null)", [factId]))
      await actor(8, 'service_role')
      expect((await db.query('select review_status from public.document_extracted_facts where id=$1', [factId])).rows)
        .toEqual([{ review_status: 'needs_review' }])
    })

    it.each(['removed document', 'missing source object'])('denies review after %s', async reason => {
      const { id, path, factId } = await reviewableFact()
      await actor(8, 'service_role')
      if (reason === 'removed document') await db.query("update public.clinical_documents set status='removed',removed_at=statement_timestamp() where id=$1", [id])
      else await db.query("delete from storage.objects where bucket_id='medical-documents' and name=$1", [path])
      await actor(1)
      await expectDenied(() => db.query("select public.review_my_document_extracted_fact($1,'confirmed',null)", [factId]))
      await actor(8, 'service_role')
      expect((await db.query('select review_status from public.document_extracted_facts where id=$1', [factId])).rows)
        .toEqual([{ review_status: 'needs_review' }])
    })

    it('rejects repeated or invalid review transitions and preserves rejection as non-active', async () => {
      const { factId } = await reviewableFact()
      const truthTableCounts = async () => {
        const counts = {}
        for (const table of ['patient_conditions','patient_allergies','patient_medications','prescriptions','prescription_items']) {
          counts[table] = (await db.query(`select count(*)::integer as total from public.${table}`)).rows[0].total
        }
        return counts
      }
      const truthBefore = await truthTableCounts()
      await actor(1)
      await db.query("select public.review_my_document_extracted_fact($1,'rejected','Not supported by the source.')", [factId])
      await expectDenied(() => db.query("select public.review_my_document_extracted_fact($1,'confirmed',null)", [factId]))
      await db.exec('savepoint invalid_review_decision')
      let error
      try { await db.query("select public.review_my_document_extracted_fact($1,'reviewed',null)", [factId]) } catch (caught) { error = caught }
      await db.exec('rollback to savepoint invalid_review_decision')
      expect(error).toMatchObject({ code: '23514' })
      await actor(8, 'service_role')
      expect((await db.query('select review_status from public.document_extracted_facts where id=$1', [factId])).rows)
        .toEqual([{ review_status: 'rejected' }])
      expect((await db.query('select count(*)::integer as total from public.document_extracted_fact_reviews where fact_id=$1', [factId])).rows)
        .toEqual([{ total: 1 }])
      expect(await truthTableCounts()).toEqual(truthBefore)
    })
  })

  describe('Phase I Step 5 plain-language candidate explanations', () => {
    async function explainableFact() {
      const { id, runId, factId } = await (async () => {
        const fixture = await (async () => {
          const { id, path, runId } = await classificationRun()
          await actor(8, 'service_role')
          await saveClassification(runId)
          await db.query('select public.record_document_extracted_facts($1,$2,$3::jsonb)', [runId, 'Explanation fixture.', JSON.stringify([{
            factType: 'condition_candidate', name: 'asthma', valueText: null, valueNumeric: null,
            unit: null, referenceRangeText: null, observedAt: null, observedAtTime: null,
            abnormalFlag: null, strengthText: null, formText: null, frequencyText: null,
            instructionText: null, recommendedAt: null, sourceContext: null,
            sourceLocator: { page: 1, section: 'History', excerpt: 'History of asthma is noted.' },
            confidence: 0.82, reviewRequired: true, explanation: 'Source mention only.',
          }])])
          const factId = (await db.query('select id from public.document_extracted_facts where extraction_id=$1', [runId])).rows[0].id
          return { id, path, runId, factId }
        })()
        return fixture
      })()
      return { id, runId, factId }
    }

    const explanationFields = {
      simple_title: 'Condition mention: asthma', short_summary: 'The document mentions asthma.',
      plain_language_explanation: 'The document mentions asthma. This source mention is not a diagnosis confirmed here.',
      why_it_may_matter: 'This may be useful to review with your healthcare professional alongside the original document.',
      review_message: 'AI extracted this from your document. Please review it.',
      uncertainty_note: 'This explanation describes the source, not a diagnosis.',
    }
    const bilingualExplanationFields = {
      simple_title_en: 'Condition mention: asthma', simple_title_my: 'ပန်းနာရင်ကျပ်အကြောင်း ဖော်ပြချက်',
      short_summary_en: 'The document mentions asthma.', short_summary_my: 'စာရွက်စာတမ်းတွင် ပန်းနာရင်ကျပ်ကို ဖော်ပြထားသည်။',
      plain_language_explanation_en: 'The document mentions asthma. This source mention is not a diagnosis confirmed here.',
      plain_language_explanation_my: 'စာရွက်စာတမ်းတွင် ပန်းနာရင်ကျပ်ကို ဖော်ပြထားသည်။ ဤအချက်သည် အတည်ပြုရောဂါမဟုတ်ပါ။',
      why_it_may_matter_en: 'This may be useful to review with your healthcare professional alongside the original document.',
      why_it_may_matter_my: 'မူရင်းစာရွက်စာတမ်းနှင့်အတူ ကျန်းမာရေးပညာရှင်နှင့် ပြန်လည်ဆွေးနွေးနိုင်သည်။',
      review_message_en: 'AI extracted this from your document. Please review it.',
      review_message_my: 'ဒီအချက်အလက်ကို AI က သင့် document ထဲကနေ ထုတ်ယူထားတာပါ။ ကျေးဇူးပြုပြီး ပြန်လည်စစ်ဆေးပါ။',
      uncertainty_note_en: 'This explanation describes the source, not a diagnosis.',
      uncertainty_note_my: 'ဤရှင်းလင်းချက်သည် အရင်းအမြစ်ကိုသာ ဖော်ပြပြီး ရောဂါအတည်ပြုချက်မဟုတ်ပါ။',
      source_assertion: 'affirmed', translation_status: 'complete',
    }

    it('stores a server-linked explanation, blocks spoofed ownership, and synchronizes review state', async () => {
      const { factId } = await explainableFact()
      await actor(8, 'service_role')
      const before = (await db.query('select count(*)::integer as total from public.patient_conditions')).rows[0].total
      await expectDenied(() => db.query('select public.save_my_document_fact_explanation($1,$2,$3::jsonb)', [factId, uid(2), JSON.stringify(explanationFields)]))
      const saved = (await db.query('select public.save_my_document_fact_explanation($1,$2,$3::jsonb) as result', [factId, uid(1), JSON.stringify(bilingualExplanationFields)])).rows[0].result
      expect(saved.explanation.source_reference).toMatchObject({
        fact_id: factId, source_document_id: expect.any(String), review_state: 'needs_review',
        information_origin: expect.stringMatching(/not clinician-confirmed/),
      })
      await actor(1)
      await db.query("select public.review_my_document_extracted_fact($1,'confirmed',null)", [factId])
      await actor(8, 'service_role')
      const confirmedExplanation = (await db.query('select plain_language_explanation from public.document_extracted_facts where id=$1', [factId])).rows[0].plain_language_explanation
      expect(confirmedExplanation).toMatchObject({
        review_message_en: 'Patient reviewed. This is not clinician confirmation.',
        review_message_my: 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။',
        source_reference: { review_state: 'confirmed', fact_id: factId },
      })
      const beforeProjectionRepair = structuredClone(confirmedExplanation)
      beforeProjectionRepair.review_message_my = alternateMyanmarReviewMessage
      await db.query('update public.document_extracted_facts set plain_language_explanation=$1::jsonb where id=$2', [JSON.stringify(beforeProjectionRepair), factId])
      await db.query(`update public.document_extracted_facts
        set plain_language_explanation = jsonb_set(plain_language_explanation, '{review_message_my}', to_jsonb($1::text), true)
        where id=$2 and review_status='confirmed'
          and plain_language_explanation->'source_reference'->>'review_state'='confirmed'
          and plain_language_explanation->>'review_message_my'=$3`, [
        'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။', factId,
        alternateMyanmarReviewMessage,
      ])
      const repairedExplanation = (await db.query('select plain_language_explanation from public.document_extracted_facts where id=$1', [factId])).rows[0].plain_language_explanation
      expect(repairedExplanation).toEqual({ ...confirmedExplanation, review_message_my: 'လူနာမှ ပြန်လည်စစ်ဆေးပြီးဖြစ်သည်။ ၎င်းသည် ဆရာဝန်မှ အတည်ပြုခြင်း မဟုတ်ပါ။' })
      expect((await db.query('select count(*)::integer as total from public.patient_conditions')).rows[0].total).toBe(before)
    })

    it('clears stored explanations when a candidate is rejected', async () => {
      const { factId } = await explainableFact()
      await actor(8, 'service_role')
      await db.query('select public.save_my_document_fact_explanation($1,$2,$3::jsonb)', [factId, uid(1), JSON.stringify(explanationFields)])
      await actor(1)
      await db.query("select public.review_my_document_extracted_fact($1,'rejected',null)", [factId])
      await actor(8, 'service_role')
      expect((await db.query('select plain_language_explanation from public.document_extracted_facts where id=$1', [factId])).rows[0].plain_language_explanation).toBeNull()
    })
  })

  describe('Phase I Step 6 dashboard intelligence authorization', () => {
    async function dashboardFact() {
      const { runId } = await classificationRun()
      await actor(8, 'service_role')
      await saveClassification(runId)
      await db.query('select public.record_document_extracted_facts($1,$2,$3::jsonb)', [runId, 'Dashboard access fixture.', JSON.stringify([{
        factType: 'other', name: 'Synthetic dashboard item', valueText: null, valueNumeric: null,
        unit: null, referenceRangeText: null, observedAt: null, observedAtTime: null, abnormalFlag: null,
        strengthText: null, formText: null, frequencyText: null, instructionText: null, recommendedAt: null,
        sourceContext: null, sourceLocator: { page: 1, section: null, excerpt: 'Synthetic dashboard item noted.' },
        confidence: 0.9, reviewRequired: true, explanation: 'Synthetic source note.',
      }])])
      return (await db.query('select id from public.document_extracted_facts where extraction_id=$1', [runId])).rows[0].id
    }

    it('relies on existing record-scope RLS for owner, family, and unrelated viewers', async () => {
      const factId = await dashboardFact()
      await actor(1)
      expect((await db.query('select id from public.document_extracted_facts where id=$1', [factId])).rows).toHaveLength(1)
      await actor(6)
      expect((await db.query('select id from public.document_extracted_facts where id=$1', [factId])).rows).toHaveLength(1)
      await actor(8)
      expect((await db.query('select id from public.document_extracted_facts where id=$1', [factId])).rows).toEqual([])
      await actor(2)
      expect((await db.query('select id from public.document_extracted_facts where id=$1', [factId])).rows).toEqual([])
    })
  })
})
