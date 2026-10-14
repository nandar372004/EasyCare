#!/usr/bin/env node
// Read-only Phase I Step 1 Staging preflight. This script executes SELECT-only
// catalog/data checks through the authenticated Supabase CLI and never applies SQL.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const targetProjectRef = 'xyprybspwrtthvhnumdp'
const targetMigrationVersion = '20261007100000'
const targetMigrationName = `${targetMigrationVersion}_document_extraction_foundation.sql`
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntrypoint = path.join(repoRoot, 'node_modules', 'supabase', 'dist', 'supabase.js')
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', targetMigrationName)

const preflightSql = `
select jsonb_build_object(
  'clinical_documents_table', to_regclass('public.clinical_documents') is not null,
  'clinical_documents_required_columns', (
    select count(*) = 8
    from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_documents'
      and column_name in ('id','patient_id','uploaded_by_profile_id','storage_path','storage_bucket','source','status','removed_at')
  ),
  'clinical_documents_missing_columns', (
    select coalesce(jsonb_agg(expected.column_name order by expected.column_name),'[]'::jsonb)
    from unnest(array['id','patient_id','uploaded_by_profile_id','storage_path','storage_bucket','source','status','removed_at']::text[]) expected(column_name)
    where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='clinical_documents' and c.column_name=expected.column_name)
  ),
  'clinical_documents_primary_key', exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu using (constraint_catalog,constraint_schema,constraint_name,table_name)
    where tc.table_schema='public' and tc.table_name='clinical_documents'
      and tc.constraint_type='PRIMARY KEY' and kcu.column_name='id'
      and (select count(*) from information_schema.key_column_usage k where k.constraint_catalog=tc.constraint_catalog and k.constraint_schema=tc.constraint_schema and k.constraint_name=tc.constraint_name and k.table_name=tc.table_name)=1
  ),
  'clinical_documents_patient_fk', exists (
    select 1 from pg_constraint c where c.contype='f'
      and c.conrelid=to_regclass('public.clinical_documents')
      and c.confrelid=to_regclass('public.patients')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['patient_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['id']
  ),
  'clinical_documents_uploader_fk', exists (
    select 1 from pg_constraint c where c.contype='f'
      and c.conrelid=to_regclass('public.clinical_documents')
      and c.confrelid=to_regclass('public.profiles')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['uploaded_by_profile_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['id']
  ),
  'clinical_documents_rls', coalesce((select c.relrowsecurity from pg_class c where c.oid=to_regclass('public.clinical_documents')),false),
  'clinical_documents_authorized_read_policy', exists (
    select 1 from pg_policies p where p.schemaname='public' and p.tablename='clinical_documents'
      and p.policyname='clinical_documents_authorized_read' and p.cmd='SELECT'
      and 'authenticated'=any(p.roles) and p.qual ilike '%can_access_patient%'
  ),
  'phase_h_fields', (
    select count(*) = 7 from information_schema.columns
    where table_schema='public' and table_name='clinical_documents'
      and column_name in ('source','status','storage_bucket','storage_path','original_filename','removed_at','updated_at')
  ),
  'phase_h_missing_columns', (
    select coalesce(jsonb_agg(expected.column_name order by expected.column_name),'[]'::jsonb)
    from unnest(array['source','status','storage_bucket','storage_path','original_filename','removed_at','updated_at']::text[]) expected(column_name)
    where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='clinical_documents' and c.column_name=expected.column_name)
  ),
  'patients_table', to_regclass('public.patients') is not null,
  'profiles_table', to_regclass('public.profiles') is not null,
  'auth_users_table', to_regclass('auth.users') is not null,
  'storage_objects_table', to_regclass('storage.objects') is not null,
  'patients_profile_columns', (
    select count(*) = 4 from information_schema.columns
    where table_schema='public' and table_name='patients'
      and column_name in ('id','profile_id','auth_user_id','status')
  ),
  'patients_missing_columns', (
    select coalesce(jsonb_agg(expected.column_name order by expected.column_name),'[]'::jsonb)
    from unnest(array['id','profile_id','auth_user_id','status']::text[]) expected(column_name)
    where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='patients' and c.column_name=expected.column_name)
  ),
  'profiles_identity_columns', (
    select count(*) = 3 from information_schema.columns
    where table_schema='public' and table_name='profiles'
      and column_name in ('id','role','status')
  ),
  'profiles_missing_columns', (
    select coalesce(jsonb_agg(expected.column_name order by expected.column_name),'[]'::jsonb)
    from unnest(array['id','role','status']::text[]) expected(column_name)
    where not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='profiles' and c.column_name=expected.column_name)
  ),
  'auth_users_id_column', exists (
    select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='id'
  ),
  'storage_object_columns', (
    select count(*) = 2 from information_schema.columns
    where table_schema='storage' and table_name='objects' and column_name in ('bucket_id','name')
  ),
  'patient_pk', exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu using (constraint_catalog,constraint_schema,constraint_name,table_name)
    where tc.table_schema='public' and tc.table_name='patients' and tc.constraint_type='PRIMARY KEY'
      and kcu.column_name='id'
      and (select count(*) from information_schema.key_column_usage k where k.constraint_catalog=tc.constraint_catalog and k.constraint_schema=tc.constraint_schema and k.constraint_name=tc.constraint_name and k.table_name=tc.table_name)=1
  ),
  'profile_pk', exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu using (constraint_catalog,constraint_schema,constraint_name,table_name)
    where tc.table_schema='public' and tc.table_name='profiles' and tc.constraint_type='PRIMARY KEY'
      and kcu.column_name='id'
      and (select count(*) from information_schema.key_column_usage k where k.constraint_catalog=tc.constraint_catalog and k.constraint_schema=tc.constraint_schema and k.constraint_name=tc.constraint_name and k.table_name=tc.table_name)=1
  ),
  'auth_users_pk', exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu using (constraint_catalog,constraint_schema,constraint_name,table_name)
    where tc.table_schema='auth' and tc.table_name='users' and tc.constraint_type='PRIMARY KEY'
      and kcu.column_name='id'
      and (select count(*) from information_schema.key_column_usage k where k.constraint_catalog=tc.constraint_catalog and k.constraint_schema=tc.constraint_schema and k.constraint_name=tc.constraint_name and k.table_name=tc.table_name)=1
  ),
  'patient_profile_fk', exists (
    select 1 from pg_constraint c where c.contype='f'
      and c.conrelid=to_regclass('public.patients') and c.confrelid=to_regclass('public.profiles')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['profile_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['id']
  ),
  'patient_auth_user_fk', exists (
    select 1 from pg_constraint c where c.contype='f'
      and c.conrelid=to_regclass('public.patients') and c.confrelid=to_regclass('auth.users')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['auth_user_id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['id']
  ),
  'profile_auth_user_fk', exists (
    select 1 from pg_constraint c where c.contype='f'
      and c.conrelid=to_regclass('public.profiles') and c.confrelid=to_regclass('auth.users')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['id']
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=array['id']
  ),
  'patient_identity_check', exists (
    select 1 from pg_constraint c where c.contype='c' and c.conrelid=to_regclass('public.patients')
      and c.conname='patients_profile_auth_identity_check' and c.convalidated
      and position('profile_id = auth_user_id' in pg_get_constraintdef(c.oid)) > 0
  ),
  'patient_profile_unique', exists (
    select 1 from pg_constraint c where c.contype='u' and c.conrelid=to_regclass('public.patients')
      and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['profile_id']
  ),
  'patient_auth_user_unique', exists (
    select 1 from pg_index i where i.indrelid=to_regclass('public.patients') and i.indisunique and i.indnkeyatts=1
      and (select array_agg(a.attname::text order by k.ord) from unnest(i.indkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where k.ord<=i.indnkeyatts)=array['auth_user_id']
  ),
  'auth_uid_helper', to_regprocedure('auth.uid()') is not null,
  'clinical_access_helper', to_regprocedure('public.can_access_patient(uuid,text)') is not null
    and has_function_privilege('authenticated',to_regprocedure('public.can_access_patient(uuid,text)'),'EXECUTE'),
  'updated_at_helper', to_regprocedure('public.set_updated_at()') is not null,
  'extraction_table_conflicts', to_regclass('public.document_extractions') is not null
    or to_regclass('public.document_extracted_facts') is not null,
  'extraction_rpc_conflict', to_regprocedure('public.request_my_document_extraction(uuid)') is not null,
  'extraction_index_conflicts', exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='i' and c.relname in (
      'document_extractions_patient_created_idx','document_extractions_document_created_idx','document_extractions_one_active_run_uidx',
      'document_extracted_facts_patient_created_idx','document_extracted_facts_extraction_idx','document_extracted_facts_document_idx'
    )
  ),
  'extraction_policy_conflicts', exists (
    select 1 from pg_policies where schemaname='public'
      and policyname in ('document_extractions_authorized_read','document_extracted_facts_authorized_read')
  ),
  'extraction_trigger_conflict', exists (
    select 1 from pg_trigger where not tgisinternal and tgname='document_extractions_updated_at'
  ),
  'identity_mismatch_count', case
    when to_regclass('public.patients') is not null and to_regclass('public.profiles') is not null and to_regclass('auth.users') is not null
      and (select count(*)=4 from information_schema.columns where table_schema='public' and table_name='patients' and column_name in ('id','profile_id','auth_user_id','status'))
      and (select count(*)=3 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('id','role','status'))
      and (select exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='id'))
    then (select count(*) from public.patients p left join public.profiles pr on pr.id=p.profile_id left join auth.users au on au.id=p.auth_user_id
      where p.profile_id is null or p.auth_user_id is null or p.profile_id is distinct from p.auth_user_id or pr.id is null or au.id is null)
    else null end
) as preflight;
`

function runCli(args) {
  if (!existsSync(cliEntrypoint)) return { ok: false }
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error || result.status !== 0 || !result.stdout) {
    return { ok: false, failure: sanitizeCliFailure(result, args[0] === 'db' ? 'DATABASE_QUERY' : 'PROJECT_LIST') }
  }
  const value = parseJsonOutput(result.stdout)
  return value === null
    ? { ok: false, failure: { code: 'CLI_OUTPUT_UNPARSEABLE', message: 'Supabase CLI returned no parseable JSON result.' } }
    : { ok: true, value }
}

function sanitizeCliFailure(result, stage) {
  const raw = [result?.error?.message, result?.stdout, result?.stderr].filter(Boolean).join('\n')
  const permission = raw.match(/Missing required permission\(s\):\s*([a-z0-9_, ]+)/i)
  if (permission) return { code: '403', message: `Missing Supabase permission(s): ${permission[1].trim()}.` }
  const missingObject = raw.match(/(?:relation|function|column|table)\s+["']?([a-z0-9_.()]+)["']?\s+(?:does not exist|not found)/i)
  const pgCode = raw.match(/\b([0-9A-Z]{5})\b/)
  if (missingObject) return { code: pgCode?.[1] ?? 'OBJECT_NOT_FOUND', message: `Database object not found: ${missingObject[1]}.` }
  const denied = raw.match(/permission denied for (?:table|relation|function|schema)\s+["']?([a-z0-9_.()]+)["']?/i)
  if (denied) return { code: pgCode?.[1] ?? '42501', message: `Permission denied for database object: ${denied[1]}.` }
  if (pgCode) return { code: pgCode[1], message: `${stage} failed with a database/CLI error; raw output suppressed.` }
  return { code: `CLI_${stage}_FAILED`, message: `${stage} failed; raw output suppressed.` }
}

function parseJsonOutput(output) {
  for (let index = 0; index < output.length; index += 1) {
    const opener = output[index]
    if (opener !== '{' && opener !== '[') continue
    const stack = []
    let inString = false
    let escaped = false
    for (let cursor = index; cursor < output.length; cursor += 1) {
      const character = output[cursor]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '{' || character === '[') stack.push(character)
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '['
        if (stack.pop() !== expected) break
        if (stack.length === 0) {
          try { return JSON.parse(output.slice(index, cursor + 1)) } catch { break }
        }
      }
    }
  }
  return null
}

function configuredTargetUrlCheck() {
  const configuredUrl = process.env.SUPABASE_URL?.trim()
  if (!configuredUrl) return { status: 'MISSING URL', matches: null }
  let parsedUrl
  try {
    parsedUrl = new URL(configuredUrl)
  } catch {
    return { status: 'MALFORMED URL', matches: null }
  }
  const expectedHostname = `${targetProjectRef}.supabase.co`
  if (parsedUrl.hostname.toLowerCase() !== expectedHostname) {
    return { status: 'WRONG HOSTNAME/PROJECT REF', matches: false }
  }
  return { status: 'MATCH', matches: true }
}

function parseProjectsList(value) {
  if (Array.isArray(value) && value.every((project) => project && typeof project === 'object' && (project.ref || project.id))) {
    return value
  }
  if (value && typeof value === 'object' && Array.isArray(value.projects)
    && value.projects.every((project) => project && typeof project === 'object' && (project.ref || project.id))) {
    return value.projects
  }
  return null
}

function findPreflight(value) {
  if (!value || typeof value !== 'object') return null
  if (value.preflight && typeof value.preflight === 'object') return value.preflight
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPreflight(item)
      if (found) return found
    }
    return null
  }
  for (const item of Object.values(value)) {
    const found = findPreflight(item)
    if (found) return found
  }
  return null
}

function yn(value) {
  return value === true ? 'YES' : value === false ? 'NO' : 'UNVERIFIED'
}

function runDataQuery() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'easycare-phase-i-preflight-'))
  const sqlPath = path.join(tempDir, 'read-only-preflight.sql')
  try {
    writeFileSync(sqlPath, preflightSql, { encoding: 'utf8', flag: 'wx' })
    const result = runCli(['db','query','--linked','--project-ref',targetProjectRef,'--output','json','--file',sqlPath])
    if (!result.ok) return { catalog: null, failure: result.failure }
    const catalog = findPreflight(result.value)
    return catalog ? { catalog, failure: null } : { catalog: null, failure: { code: 'CLI_RESULT_SHAPE_UNEXPECTED', message: 'Database query succeeded but returned no preflight result object.' } }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

function main() {
  const localMigrationExists = existsSync(migrationPath)
  const sameVersionMigrations = readdirSync(path.join(repoRoot, 'supabase', 'migrations'))
    .filter((name) => name.startsWith(`${targetMigrationVersion}_`) && name.endsWith('.sql'))
  const migrationVersionMatches = localMigrationExists && sameVersionMigrations.length === 1 && sameVersionMigrations[0] === targetMigrationName
  const urlTargetCheck = configuredTargetUrlCheck()
  const projectResult = runCli(['projects','list','--output','json'])
  const projects = projectResult.ok ? parseProjectsList(projectResult.value) : null
  const stagingProject = projects?.find((project) => (project.ref ?? project.id) === targetProjectRef)
  const cliTargetCheck = projects === null
    ? 'UNVERIFIED'
    : stagingProject && (!stagingProject.name || stagingProject.name === 'EasyCare Staging') ? 'YES' : 'NO'
  const targetCorrect = urlTargetCheck.matches === true
    ? true
    : urlTargetCheck.matches === false ? false : null

  const queryResult = targetCorrect === true && cliTargetCheck !== 'NO' && migrationVersionMatches
    ? runDataQuery()
    : { catalog: null, failure: null }
  const catalog = queryResult.catalog
  const identityMismatchCount = catalog?.identity_mismatch_count
  const tablesReady = catalog && catalog.clinical_documents_table && catalog.patients_table && catalog.profiles_table && catalog.auth_users_table
  const clinicalReady = catalog
    ? Boolean(catalog.clinical_documents_table && catalog.clinical_documents_required_columns && catalog.clinical_documents_primary_key && catalog.clinical_documents_patient_fk && catalog.clinical_documents_uploader_fk && catalog.clinical_documents_rls && catalog.clinical_documents_authorized_read_policy)
    : null
  const phaseHFieldsReady = catalog ? Boolean(catalog.phase_h_fields) : null
  const patientProfileReady = catalog
    ? Boolean(catalog.patients_profile_columns && catalog.profiles_identity_columns && catalog.auth_users_id_column && catalog.patient_pk && catalog.profile_pk && catalog.auth_users_pk && catalog.patient_profile_fk && catalog.patient_auth_user_fk && catalog.profile_auth_user_fk && catalog.patient_identity_check && catalog.patient_profile_unique && catalog.patient_auth_user_unique && identityMismatchCount === 0)
    : null
  const authHelpersReady = catalog
    ? Boolean(catalog.auth_uid_helper && catalog.clinical_access_helper && catalog.updated_at_helper && catalog.storage_objects_table && catalog.storage_object_columns)
    : null
  const objectConflicts = catalog
    ? Boolean(catalog.extraction_table_conflicts || catalog.extraction_rpc_conflict || catalog.extraction_index_conflicts || catalog.extraction_policy_conflicts || catalog.extraction_trigger_conflict)
    : null
  const dataConstraintBlocker = catalog
    ? Boolean(!catalog.clinical_documents_primary_key || !catalog.clinical_documents_patient_fk || !catalog.clinical_documents_uploader_fk || !catalog.patient_pk || !catalog.profile_pk || !catalog.auth_users_pk || !catalog.patient_profile_fk || !catalog.patient_auth_user_fk || !catalog.profile_auth_user_fk || !catalog.patient_identity_check || !catalog.patient_profile_unique || !catalog.patient_auth_user_unique || identityMismatchCount !== 0)
    : null
  const safe = Boolean(targetCorrect && cliTargetCheck !== 'NO' && migrationVersionMatches && tablesReady && clinicalReady && phaseHFieldsReady && patientProfileReady && authHelpersReady && objectConflicts === false && dataConstraintBlocker === false)

  let firstFailure = null
  if (targetCorrect !== true) firstFailure = { code: urlTargetCheck.status.replaceAll(' ','_'), message: `SUPABASE_URL target check: ${urlTargetCheck.status}.` }
  else if (cliTargetCheck === 'NO') firstFailure = { code: 'CLI_TARGET_MISMATCH', message: `Supabase CLI project list did not include project ${targetProjectRef}.` }
  else if (!migrationVersionMatches) firstFailure = { code: 'LOCAL_MIGRATION_VERSION_MISMATCH', message: `Expected exactly one local migration named ${targetMigrationName}.` }
  else if (!catalog) firstFailure = queryResult.failure ?? { code: 'PREFLIGHT_RESULT_UNAVAILABLE', message: 'Schema query returned no result.' }
  else if (!catalog.clinical_documents_table) firstFailure = { code: '42P01', message: 'Missing required table public.clinical_documents.' }
  else if (catalog.clinical_documents_missing_columns?.length) firstFailure = { code: '42703', message: `Missing public.clinical_documents column: ${catalog.clinical_documents_missing_columns[0]}.` }
  else if (catalog.phase_h_missing_columns?.length) firstFailure = { code: '42703', message: `Missing Phase H column public.clinical_documents.${catalog.phase_h_missing_columns[0]}.` }
  else if (catalog.patients_missing_columns?.length) firstFailure = { code: '42703', message: `Missing public.patients column: ${catalog.patients_missing_columns[0]}.` }
  else if (catalog.profiles_missing_columns?.length) firstFailure = { code: '42703', message: `Missing public.profiles column: ${catalog.profiles_missing_columns[0]}.` }
  else if (identityMismatchCount > 0) firstFailure = { code: 'IDENTITY_LINK_MISMATCH', message: `Found ${identityMismatchCount} patient/profile/Auth identity link mismatch(es); row identifiers suppressed.` }
  else if (objectConflicts) firstFailure = { code: 'OBJECT_NAME_CONFLICT', message: 'A Step 1 table, RPC, index, policy, or trigger name already exists.' }
  else if (dataConstraintBlocker) firstFailure = { code: 'DEPENDENCY_CONSTRAINT_MISMATCH', message: 'A required primary key, foreign key, identity constraint, or identity row check failed.' }
  else if (clinicalReady === false) firstFailure = { code: 'CLINICAL_DOCUMENTS_CONTRACT_MISMATCH', message: 'public.clinical_documents keys, RLS, or authorized read policy are incompatible.' }
  else if (authHelpersReady === false) firstFailure = { code: 'AUTH_HELPER_MISSING', message: 'A required auth, clinical access, timestamp, or Storage object helper is unavailable.' }

  console.log(`SUPABASE URL HOSTNAME CHECK: ${urlTargetCheck.status}`)
  console.log(`CLI TARGET CHECK: ${cliTargetCheck}`)
  console.log(`STAGING TARGET CORRECT? ${yn(targetCorrect)}`)
  console.log(`CLINICAL_DOCUMENTS READY? ${yn(clinicalReady)}`)
  console.log(`PHASE H DOCUMENT FIELDS READY? ${yn(phaseHFieldsReady)}`)
  console.log(`PATIENT/PROFILE PREREQUISITES READY? ${yn(patientProfileReady)}`)
  console.log(`REQUIRED AUTH HELPERS READY? ${yn(authHelpersReady)}`)
  console.log(`OBJECT NAME CONFLICTS? ${yn(objectConflicts)}`)
  console.log(`DATA CONSTRAINT BLOCKER? ${yn(dataConstraintBlocker)}`)
  console.log(`FIRST FAILURE: ${firstFailure ? `${firstFailure.code} — ${firstFailure.message}` : 'NONE'}`)
  console.log(`SAFE TO APPLY ${targetMigrationVersion} BY ITSELF? ${safe ? 'YES' : 'NO'}`)
}

main()
