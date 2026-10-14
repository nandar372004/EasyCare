import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const TARGET_PROJECT_REF = 'xyprybspwrtthvhnumdp'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const credentialsPath = path.join(scriptDirectory, '.phase-h-test-identities.local.json')
const credentialsTempPath = `${credentialsPath}.tmp`
const bucketName = 'medical-documents'
const PROVIDER_APPLICATION_BUCKET = 'provider-credential-evidence'
const ownerGroupName = 'PHASE_H_TEST Family Group - synthetic only'
const syntheticDocumentTitle = 'PHASE_H_TEST Synthetic PDF - NOT MEDICAL DATA'
const syntheticDocumentFilename = 'PHASE_H_TEST-owner-synthetic.pdf'
const syntheticRequestReason = 'PHASE_H_TEST - Phase H authorization verification only; no real care requested.'
const adultDateOfBirth = '1980-01-01'
const passwordSize = 32
const maxAuthPages = 100
const authPageSize = 1000

const identitySpecs = [
  { key: 'H_OWNER', emailPrefix: 'phase-h-test-owner', fullName: 'PHASE_H_TEST Owner', kind: 'patient' },
  { key: 'H_UNRELATED_PATIENT', emailPrefix: 'phase-h-test-unrelated-patient', fullName: 'PHASE_H_TEST Unrelated Patient', kind: 'patient' },
  { key: 'H_FAMILY_NO_RECORDS', emailPrefix: 'phase-h-test-family-no-records', fullName: 'PHASE_H_TEST Family No Records', kind: 'patient' },
  { key: 'H_FAMILY_RECORDS', emailPrefix: 'phase-h-test-family-records', fullName: 'PHASE_H_TEST Family Records', kind: 'patient' },
  { key: 'H_PROVIDER_UNRELATED', emailPrefix: 'phase-h-test-provider-unrelated', fullName: 'PHASE_H_TEST Provider Unrelated', kind: 'patient' },
  { key: 'H_PROVIDER_RELATED', emailPrefix: 'phase-h-test-provider-related', fullName: 'PHASE_H_TEST Provider Related', kind: 'patient' },
]

const summary = {
  H_OWNER: false,
  H_UNRELATED_PATIENT: false,
  H_FAMILY_NO_RECORDS: false,
  H_FAMILY_RECORDS: false,
  H_PROVIDER_UNRELATED: false,
  H_PROVIDER_RELATED: false,
  'OWNER SYNTHETIC PDF': false,
  'ISOLATED AUTH CLIENTS': false,
  'IDENTITY INVARIANTS': false,
  'REAL USER DATA MODIFIED': false,
  'CREDENTIALS/TOKENS EXPOSED': false,
  'SAFE TO RUN FINAL PHASE H TESTS': false,
}
let setupFailureStage = 'startup'

function fail() {
  throw new Error('PHASE_H_FIXTURE_SETUP_FAILED')
}

function printStartupCheck() {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const report = {
    urlSeen: typeof url === 'string' && url.length > 0,
    secretSeen: typeof secretKey === 'string' && secretKey.length > 0,
    adminClientInitialized: false,
    firstFailureStep: 'NONE',
  }

  try {
    if (!report.urlSeen || !report.secretSeen) {
      report.firstFailureStep = 'environment-availability'
    } else {
      let parsedUrl
      try {
        parsedUrl = new URL(url)
      } catch {
        report.firstFailureStep = 'staging-url-validation'
      }
      if (report.firstFailureStep === 'NONE'
        && (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== `${TARGET_PROJECT_REF}.supabase.co`)) {
        report.firstFailureStep = 'staging-url-validation'
      }
      if (report.firstFailureStep === 'NONE') {
        try {
          makeMemoryClient(url, secretKey)
          report.adminClientInitialized = true
        } catch {
          report.firstFailureStep = 'admin-client-initialization'
        }
      }
    }
  } catch {
    report.firstFailureStep = 'startup-diagnostic'
  }

  console.log(`SUPABASE_URL SEEN BY SCRIPT? ${report.urlSeen ? 'YES' : 'NO'}`)
  console.log(`SUPABASE_SECRET_KEY SEEN BY SCRIPT? ${report.secretSeen ? 'YES' : 'NO'}`)
  console.log(`ADMIN CLIENT INITIALIZATION REACHED? ${report.adminClientInitialized ? 'YES' : 'NO'}`)
  console.log(`FIRST REAL FAILURE STEP: ${report.firstFailureStep}`)
  // This dry check confirms local initialization only, not remote Auth/admin permissions.
  console.log('SAFE TO RUN FIXTURE CREATION NEXT? NO')
  if (report.firstFailureStep !== 'NONE') process.exitCode = 1
}

const PREFLIGHT_TABLES = [
  ['profiles', 'id,email,role,status,full_name,phone,preferred_language'],
  ['patients', 'id,profile_id,auth_user_id,status,date_of_birth,primary_phone'],
  ['providers', 'id,profile_id,provider_type,license_number,verification_status,display_name,verified_at,years_experience,bio,languages,service_area,home_visit_enabled,teleconsult_enabled'],
  ['family_groups', 'id,display_name,created_by'],
  ['family_group_members', 'id,family_group_id,patient_id,relationship,role,status,added_by'],
  ['family_invitations', 'id,family_group_id,invited_profile_id,status,expires_at'],
  ['family_authorizations', 'id,patient_id,family_profile_id,status,can_view_records,source_family_group_id,consent_id,expires_at,revoked_at'],
  ['consents', 'id,patient_id,status,consent_type'],
  ['care_requests', 'id,patient_id,requested_by_profile_id,service_type,reason_symptoms,status'],
  ['care_assignments', 'id,care_request_id,provider_id,assigned_by_profile_id,status,assigned_at'],
  ['clinical_documents', 'id,patient_id,uploaded_by_profile_id,source,status,original_filename,storage_bucket,storage_path,mime_type,file_size'],
]
const FAMILY_RPC_NAMES = [
  'create_family_group', 'create_family_join_code', 'invite_family_member',
  'respond_family_invitation', 'grant_family_authorization',
]

function safeErrorClass(error) {
  const status = Number(error?.status ?? error?.context?.status)
  const code = String(error?.code ?? '').toUpperCase()
  if (status === 401 || status === 403 || code === '42501') return 'PERMISSION_DENIED'
  if (status === 404 || code === 'PGRST202' || code === 'PGRST204') return 'OBJECT_OR_RPC_UNAVAILABLE'
  if (status >= 500 && status < 600) return 'REMOTE_SERVICE_ERROR'
  if (error?.name === 'TypeError') return 'NETWORK_OR_URL_ERROR'
  if (error) return 'REQUEST_FAILED'
  return 'NONE'
}

function sanitizeDataApiError(error, table, status = undefined) {
  const resolvedStatus = status ?? error?.status ?? error?.context?.status
  let message = String(error?.message ?? 'NONE')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:sb_(?:secret|publishable)_|eyJ)[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (message.length > 220) message = `${message.slice(0, 217)}...`
  return {
    table,
    status: Number.isInteger(Number(resolvedStatus)) ? String(Number(resolvedStatus)) : 'UNAVAILABLE',
    code: String(error?.code ?? 'NONE').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'UNAVAILABLE',
    message: message || 'NONE',
  }
}

function keyHasAdminRole(key) {
  if (key.startsWith('sb_secret_')) return true
  const token = key.split('.')
  if (token.length < 2) return false
  try {
    const payload = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

async function runPreflight() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const out = {
    adminAuth: false,
    registrationRpc: false,
    familyRpc: false,
    providerApplicationFlow: false,
    providerTables: false,
    clinicalDocuments: false,
    bucket: false,
    edge: false,
    adminSession: false,
    firstFailureStep: 'NONE',
    firstFailureError: 'NONE',
    scriptAssumptionWrong: false,
    tableDiagnostics: [],
  }
  const failCheck = (step, errorClass) => {
    if (out.firstFailureStep === 'NONE') {
      out.firstFailureStep = step
      out.firstFailureError = errorClass
    }
  }
  const urlValid = typeof url === 'string' && typeof key === 'string' && key.length > 0
    && (() => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === `${TARGET_PROJECT_REF}.supabase.co` } catch { return false } })()

  if (!urlValid) {
    failCheck('environment-and-staging-url', 'MISSING_OR_INVALID_CONFIGURATION')
  } else {
    let client
    try {
      client = makeMemoryClient(url, key)
    } catch {
      failCheck('admin-client-initialization', 'CLIENT_INITIALIZATION_FAILED')
    }

    if (client) {
      const authResult = await client.auth.admin.listUsers({ page: 1, perPage: 1 }).catch(error => ({ error }))
      out.adminAuth = !authResult.error && Array.isArray(authResult.data?.users)
      if (!out.adminAuth) failCheck('admin-auth-read', safeErrorClass(authResult.error))

      // OpenAPI discovery is a GET-only schema-cache inspection; it does not invoke RPCs.
      let rpcPaths = new Set()
      let apiTablePaths = new Set()
      try {
        const response = await fetch(`${url}/rest/v1/`, {
          method: 'GET',
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
          signal: AbortSignal.timeout(15_000),
        })
        if (response.ok) {
          const spec = await response.json()
          const paths = Object.keys(spec?.paths ?? {})
          rpcPaths = new Set(paths.filter(route => route.startsWith('/rpc/')).map(route => route.slice(5)))
          apiTablePaths = new Set(paths.filter(route => route.startsWith('/') && !route.startsWith('/rpc/'))
            .map(route => route.slice(1).split('/')[0]))
        } else {
          failCheck('rpc-schema-discovery', `HTTP_${response.status}`)
        }
      } catch {
        failCheck('rpc-schema-discovery', 'NETWORK_OR_SCHEMA_DISCOVERY_ERROR')
      }
      out.registrationRpc = rpcPaths.has('create_patient_registration')
      if (!out.registrationRpc) failCheck('patient-registration-rpc', 'RPC_NOT_EXPOSED_IN_SCHEMA_CACHE')
      out.familyRpc = FAMILY_RPC_NAMES.every(name => rpcPaths.has(name))
      if (!out.familyRpc) failCheck('family-rpc-set', 'ONE_OR_MORE_FAMILY_RPCS_NOT_EXPOSED_IN_SCHEMA_CACHE')
      const providerRpcs = ['save_provider_application_draft', 'record_provider_application_document',
        'submit_provider_application', 'get_my_provider_application', 'admin_start_provider_application_review',
        'admin_approve_provider_application', 'get_my_provider_identity']
      out.providerApplicationFlow = providerRpcs.every(name => rpcPaths.has(name))
      if (!out.providerApplicationFlow) failCheck('provider-application-rpc-set', 'PROVIDER_APPLICATION_FLOW_RPC_NOT_EXPOSED')

      // OpenAPI route discovery confirms Data API exposure without a service-role
      // table SELECT, which is intentionally unavailable in this Staging ACL.
      const requiredFlowTables = ['profiles', 'patients', 'providers', 'family_groups', 'family_group_members',
        'family_invitations', 'family_authorizations', 'consents', 'care_requests', 'care_assignments']
      out.providerTables = requiredFlowTables.every(name => apiTablePaths.has(name))
      out.clinicalDocuments = apiTablePaths.has('clinical_documents')
      out.tableDiagnostics = ['profiles', 'providers', 'care_requests', 'care_assignments'].map(table => ({
        table,
        status: apiTablePaths.has(table) ? 'SCHEMA_PATH' : 'UNAVAILABLE',
        code: apiTablePaths.has(table) ? 'NONE' : 'PATH_NOT_EXPOSED',
        message: apiTablePaths.has(table) ? 'ROUTE_DISCOVERED; USER-FLOW ACL CHECK REQUIRED' : 'NO_DATA_API_ROUTE',
      }))
      if (!out.providerTables) failCheck('provider-family-schema-routes', 'ONE_OR_MORE_DATA_API_ROUTES_NOT_EXPOSED')
      if (!out.clinicalDocuments) failCheck('clinical-documents-schema-route', 'DATA_API_ROUTE_NOT_EXPOSED')

      try {
        const bucketResult = await client.storage.getBucket(bucketName)
        out.bucket = !bucketResult.error && bucketResult.data?.public === false
        if (!out.bucket) failCheck('medical-documents-bucket', safeErrorClass(bucketResult.error) === 'NONE' ? 'BUCKET_MISSING_OR_NOT_PRIVATE' : safeErrorClass(bucketResult.error))
      } catch (error) {
        failCheck('medical-documents-bucket', safeErrorClass(error))
      }

      try {
        const response = await fetch(`${url}/functions/v1/medical-document-intake`, {
          method: 'OPTIONS',
          headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, apikey, content-type' },
          signal: AbortSignal.timeout(15_000),
        })
        out.edge = response.status === 204 && response.headers.get('access-control-allow-origin') === 'http://localhost:5173'
        if (!out.edge) failCheck('medical-document-intake-options', `HTTP_${response.status}_ORIGIN_OR_FUNCTION_NOT_READY`)
      } catch {
        failCheck('medical-document-intake-options', 'NETWORK_OR_FUNCTION_UNREACHABLE')
      }

      const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
      const adminEmail = process.env.PHASE_H_ADMIN_EMAIL
      const adminPassword = process.env.PHASE_H_ADMIN_PASSWORD
      if (publicKey && adminEmail && adminPassword) {
        const sessionClient = makeMemoryClient(url, publicKey)
        const signedIn = await sessionClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
        if (!signedIn.error && signedIn.data?.session) {
          const { data: adminFlag, error: adminFlagError } = await sessionClient.rpc('is_main_admin')
          out.adminSession = !adminFlagError && adminFlag === true
        }
      }
      if (!out.adminSession) failCheck('authenticated-main-admin-preflight', 'MAIN_ADMIN_SESSION_NOT_CONFIRMED')
    }
  }

  console.log(`ADMIN AUTH ACCESS? ${out.adminAuth ? 'YES' : 'NO'}`)
  console.log(`PATIENT REGISTRATION RPC? ${out.registrationRpc ? 'YES' : 'NO'}`)
  console.log(`FAMILY RPC SET COMPLETE? ${out.familyRpc ? 'YES' : 'NO'}`)
  console.log(`PROVIDER APPLICATION FLOW? ${out.providerApplicationFlow ? 'YES' : 'NO'}`)
  console.log(`PROVIDER/FAMILY DATA API ROUTES DISCOVERED? ${out.providerTables ? 'YES' : 'NO'}`)
  console.log(`CLINICAL DOCUMENTS READY? ${out.clinicalDocuments ? 'YES' : 'NO'}`)
  console.log(`PRIVATE MEDICAL BUCKET READY? ${out.bucket ? 'YES' : 'NO'}`)
  console.log(`EDGE FUNCTION READY? ${out.edge ? 'YES' : 'NO'}`)
  console.log(`MAIN-ADMIN SESSION VERIFIED? ${out.adminSession ? 'YES' : 'NO'}`)
  console.log(`FIRST PREFLIGHT FAILURE STEP: ${out.firstFailureStep}`)
  console.log(`FIRST PREFLIGHT ERROR: ${out.firstFailureError}`)
  for (const tableName of ['profiles', 'providers', 'care_requests', 'care_assignments']) {
    const diagnostic = out.tableDiagnostics.find(item => item.table === tableName)
      ?? { status: 'UNAVAILABLE', code: 'UNAVAILABLE', message: 'CHECK_NOT_RUN' }
    console.log(`${tableName.toUpperCase()}:`)
    console.log(`STATUS: ${diagnostic.status}`)
    console.log(`CODE: ${diagnostic.code}`)
    console.log(`MESSAGE: ${diagnostic.message}`)
  }
  console.log('REAL DB PERMISSION ISSUE? UNVERIFIED (NO PRIVILEGED TABLE SELECTS ATTEMPTED)')
  console.log('SECRET KEY DATA API AUTHENTICATION? UNVERIFIED (ROUTE DISCOVERY IS NOT ACL PROOF)')
  const firstTableError = out.tableDiagnostics.find(item => item.status === 'UNAVAILABLE')
  const firstDataApiRouteMiss = out.tableDiagnostics.find(item => item.status === 'UNAVAILABLE')
  const firstFailureDetail = firstTableError
    ? `${firstTableError.table} HTTP ${firstTableError.status} CODE ${firstTableError.code}: ${firstTableError.message}`
    : out.firstFailureStep !== 'NONE'
      ? `${out.firstFailureStep}: ${out.firstFailureError}`
      : 'NONE'
  console.log(`FIRST REAL FAILURE: ${firstDataApiRouteMiss ? `${firstDataApiRouteMiss.table} ${firstDataApiRouteMiss.code}` : firstFailureDetail}`)
  console.log(`SCRIPT ASSUMPTION WRONG? ${out.scriptAssumptionWrong ? 'YES' : 'NO'}`)
  // Route discovery is not an ACL/write-capability test. This preflight only
  // confirms prerequisites; actual authenticated writes are performed by the
  // approved flows below and abort on the first denied operation.
  out.preflightReady = out.adminAuth && out.registrationRpc && out.familyRpc && out.providerApplicationFlow
    && out.providerTables && out.clinicalDocuments && out.bucket && out.edge && out.adminSession
  console.log(`PREREQUISITE PREFLIGHT PASSED? ${out.preflightReady ? 'YES' : 'NO'}`)
  console.log('AUTHENTICATED FLOW ACLs PROVEN BY PREFLIGHT? NO')
  if (out.firstFailureStep !== 'NONE') process.exitCode = 1
  return out
}

function assert(condition) {
  if (!condition) fail()
}

function fixtureEmail(spec, runId) {
  return `${spec.emailPrefix}-${runId}@example.invalid`
}

function requireNoError(result) {
  assert(result && !result.error)
  return result.data
}

function checkCredentialFileIgnored() {
  const relativePath = path.relative(repositoryRoot, credentialsPath)
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', relativePath], {
    cwd: repositoryRoot,
    windowsHide: true,
    encoding: 'utf8',
  })
  assert(result.status === 0)
  const tempRelativePath = path.relative(repositoryRoot, credentialsTempPath)
  const tempResult = spawnSync('git', ['check-ignore', '--quiet', '--no-index', tempRelativePath], {
    cwd: repositoryRoot,
    windowsHide: true,
    encoding: 'utf8',
  })
  assert(tempResult.status === 0)
}

async function protectCredentialFile(filePath) {
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o600)
    return
  }
  const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    windowsHide: true,
    encoding: 'utf8',
  })
  const sid = `${identity.stdout ?? ''}\n${identity.stderr ?? ''}`.match(/S-1-(?:[0-9]+-)+[0-9]+/)?.[0]
  assert(identity.status === 0 && sid)
  const acl = spawnSync('icacls.exe', [filePath, '/inheritance:r', '/grant:r', `*${sid}:(F)`], {
    windowsHide: true,
    encoding: 'utf8',
  })
  assert(acl.status === 0)
}

async function readCredentialState() {
  if (!existsSync(credentialsPath)) return null
  await protectCredentialFile(credentialsPath)
  let parsed
  try {
    parsed = JSON.parse(await readFile(credentialsPath, 'utf8'))
  } catch {
    fail()
  }
  assert(parsed?.version === 1 && parsed?.projectRef === TARGET_PROJECT_REF)
  assert(typeof parsed?.fixtureRunId === 'string' && /^[a-f0-9]{12}$/.test(parsed.fixtureRunId))
  assert(parsed?.identities && typeof parsed.identities === 'object')
  for (const spec of identitySpecs) {
    const entry = parsed.identities[spec.key]
    assert(entry?.email === fixtureEmail(spec, parsed.fixtureRunId))
    assert(typeof entry.password === 'string' && entry.password.length >= 24)
    assert(entry.kind === spec.kind)
    if (spec.kind === 'patient') assert(entry.phone === `PHASE_H_TEST_${spec.key}`)
  }
  return parsed
}

async function persistCredentialState(state) {
  checkCredentialFileIgnored()
  const contents = `${JSON.stringify(state, null, 2)}\n`
  await writeFile(credentialsTempPath, contents, { encoding: 'utf8', mode: 0o600 })
  try {
    await protectCredentialFile(credentialsTempPath)
    await rename(credentialsTempPath, credentialsPath)
  } catch {
    await unlink(credentialsTempPath).catch(() => {})
    fail()
  }
}

async function newCredentialState() {
  const fixtureRunId = randomUUID().replaceAll('-', '').slice(0, 12)
  const identities = {}
  for (const spec of identitySpecs) {
    identities[spec.key] = {
      email: fixtureEmail(spec, fixtureRunId),
      password: randomBytes(passwordSize).toString('base64url'),
      userId: null,
      kind: spec.kind,
      ...(spec.kind === 'patient' ? { phone: `PHASE_H_TEST_${spec.key}` } : {}),
      ...(spec.kind === 'patient' ? { patientId: null } : { providerId: null }),
    }
  }
  return { version: 1, projectRef: TARGET_PROJECT_REF, fixtureRunId, identities, familyGroupId: null, documentId: null, careRequestId: null }
}

async function inspectAuthUsers(admin, emails) {
  const matches = new Map()
  for (let page = 1; page <= maxAuthPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: authPageSize })
    assert(!error && Array.isArray(data?.users))
    for (const user of data.users) {
      if (emails.has(String(user.email ?? '').toLowerCase())) {
        const email = String(user.email).toLowerCase()
        if (matches.has(email)) fail()
        matches.set(email, user)
      }
    }
    if (data.users.length < authPageSize) return matches
  }
  fail()
}

async function preflightExistingFixtures(admin, state) {
  const emails = new Set(identitySpecs.map(spec => state.identities[spec.key].email.toLowerCase()))
  const authMatches = await inspectAuthUsers(admin, emails)

  for (const spec of identitySpecs) {
    const entry = state.identities[spec.key]
    const authUser = authMatches.get(state.identities[spec.key].email.toLowerCase())
    if (authUser) {
      assert(authUser.user_metadata?.phase_h_test_identity === spec.key)
      assert(authUser.user_metadata?.phase_h_test_fixture === true)
      assert(authUser.user_metadata?.fixture_marker === 'PHASE_H_TEST')
      if (entry.userId) assert(authUser.id === entry.userId)
      else entry.userId = authUser.id
    } else {
      assert(!entry.userId)
    }
  }
  await persistCredentialState(state)
  return { authMatches }
}

async function ensureAuthUser(admin, state, spec, authMatches) {
  const entry = state.identities[spec.key]
  const existing = authMatches.get(entry.email.toLowerCase())
  if (existing) {
    assert(existing.user_metadata?.phase_h_test_identity === spec.key)
    assert(existing.user_metadata?.phase_h_test_fixture === true)
    assert(!entry.userId || entry.userId === existing.id)
    entry.userId = existing.id
    await persistCredentialState(state)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: entry.email,
    password: entry.password,
    email_confirm: true,
    user_metadata: {
      phase_h_test_identity: spec.key,
      phase_h_test_fixture: true,
      fixture_marker: 'PHASE_H_TEST',
      full_name: spec.fullName,
    },
  })
  assert(!error && data?.user?.id)
  assert(data.user.email?.toLowerCase() === entry.email.toLowerCase())
  assert(data.user.user_metadata?.phase_h_test_identity === spec.key)
  entry.userId = data.user.id
  await persistCredentialState(state)
  return data.user.id
}

async function ensurePatientIdentity(admin, state, spec, userId, patientClient) {
  const entry = state.identities[spec.key]
  const patientResult = await patientClient.from('patients')
    .select('id,profile_id,auth_user_id,status,date_of_birth')
    .eq('auth_user_id', userId).maybeSingle()
  assert(!patientResult.error)
  let patient = patientResult.data
  if (!patient) {
    const registration = {
      userId,
      fullName: spec.fullName,
      phone: entry.phone,
      email: entry.email,
      dateOfBirth: adultDateOfBirth,
      preferredLanguage: 'en',
      termsAccepted: true,
      privacyConsent: true,
    }
    const { data, error } = await admin.rpc('create_patient_registration', { registration })
    assert(!error && typeof data === 'string')
    entry.patientId = data
    await persistCredentialState(state)
    const created = await patientClient.from('patients')
      .select('id,profile_id,auth_user_id,status,date_of_birth')
      .eq('auth_user_id', userId).single()
    assert(!created.error)
    patient = created.data
  }
  const roleResult = await callRpc(patientClient, 'current_profile_role', {})
  assert(patient && (roleResult === 'patient' || roleResult === 'nurse'))
  assert(patient.profile_id === userId && patient.auth_user_id === userId)
  assert(patient.status === 'active' && patient.date_of_birth === adultDateOfBirth)
  assert(patient.id !== userId)
  if (entry.patientId) assert(entry.patientId === patient.id)
  entry.patientId = patient.id
  await persistCredentialState(state)
  return patient
}

async function ensureProviderIdentity(adminReviewClient, applicantClient, state, spec, userId) {
  const entry = state.identities[spec.key]
  const providerType = 'nurse_aide'
  const licenseNumber = `PHASE_H_TEST_${spec.key}`
  const loaded = await callRpc(applicantClient, 'get_my_provider_application', {})
  let application = loaded?.application ?? null

  if (!application) {
    const applicationId = await callRpc(applicantClient, 'save_provider_application_draft', {
      p_application_id: null,
      p_fields: {
        requested_provider_type: providerType,
        specialty_id: null,
        license_number: licenseNumber,
        license_issuer: 'PHASE_H_TEST - not a real issuer',
        qualifications: 'PHASE_H_TEST - synthetic test data, not a real qualification or credential.',
        years_experience: 0,
        organization: 'PHASE_H_TEST synthetic organization',
        professional_bio: 'PHASE_H_TEST - synthetic identity used only for authorization testing.',
        languages: ['en'],
        service_area: 'PHASE_H_TEST staging fixture only',
      },
    })
    assert(typeof applicationId === 'string')
    entry.applicationId = applicationId
    await persistCredentialState(state)
    application = { id: applicationId, status: 'draft', requested_provider_type: providerType, license_number: licenseNumber, documents: [] }
    loaded.application = application
  }

  assert(application.requested_provider_type === providerType && application.license_number === licenseNumber)
  entry.applicationId = application.id
  await persistCredentialState(state)
  if (application.status === 'verified') {
    const { data, error } = await applicantClient.rpc('get_my_provider_identity')
    const existingDocs = Array.isArray(application.documents) ? application.documents : []
    assert(!error && Array.isArray(data) && data.length === 1 && data[0].provider_type === providerType)
    assert(existingDocs.length === 1
      && existingDocs[0].file_name === `PHASE_H_TEST-${spec.key}-synthetic-credential.pdf`
      && existingDocs[0].storage_path.startsWith(`${userId}/${application.id}/`)
      && existingDocs[0].mime_type === 'application/pdf')
    entry.providerId = data[0].provider_id
    await persistCredentialState(state)
    return data[0]
  }
  assert(['draft', 'submitted', 'under_review'].includes(application.status))

  const documents = Array.isArray(application.documents) ? application.documents : []
  if (application.status === 'draft' && documents.length === 0) {
    const fileName = `PHASE_H_TEST-${spec.key}-synthetic-credential.pdf`
    const storagePath = `${userId}/${application.id}/${randomUUID()}-${fileName}`
    const pdf = await buildSyntheticPdf('PHASE_H_TEST - NOT A REAL MEDICAL CREDENTIAL')
    const { error: uploadError } = await applicantClient.storage
      .from(PROVIDER_APPLICATION_BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
    assert(!uploadError)
    try {
      await callRpc(applicantClient, 'record_provider_application_document', {
        p_application_id: application.id,
        p_document_type: 'other',
        p_file_name: fileName,
        p_storage_path: storagePath,
        p_mime_type: 'application/pdf',
        p_file_size: pdf.length,
      })
    } catch {
      const { error: cleanupError } = await applicantClient.storage.from(PROVIDER_APPLICATION_BUCKET).remove([storagePath])
      if (cleanupError) throw new Error('PHASE_H_SYNTHETIC_CREDENTIAL_CLEANUP_FAILED')
      throw new Error('PHASE_H_SYNTHETIC_CREDENTIAL_METADATA_FAILED')
    }
    loaded.application.documents = [...documents, { file_name: fileName, storage_path: storagePath, mime_type: 'application/pdf' }]
  }
  const finalDocuments = Array.isArray(application.documents) ? application.documents : loaded.application?.documents ?? documents
  assert(finalDocuments.length === 1
    && finalDocuments[0].file_name === `PHASE_H_TEST-${spec.key}-synthetic-credential.pdf`
    && finalDocuments[0].storage_path.startsWith(`${userId}/${application.id}/`)
    && finalDocuments[0].mime_type === 'application/pdf')
  const { data: evidence, error: evidenceError } = await applicantClient.storage
    .from(PROVIDER_APPLICATION_BUCKET).download(finalDocuments[0].storage_path)
  assert(!evidenceError && evidence)
  const evidenceBytes = Buffer.from(await evidence.arrayBuffer())
  assert(evidenceBytes.subarray(0, 5).toString('ascii') === '%PDF-'
    && evidenceBytes.includes(Buffer.from('PHASE_H_TEST - NOT A REAL MEDICAL CREDENTIAL', 'ascii')))

  if (application.status === 'draft') {
    const submitted = await callRpc(applicantClient, 'submit_provider_application', { p_application_id: application.id })
    assert(submitted === 'submitted')
    application.status = 'submitted'
  }
  if (application.status === 'submitted') {
    const reviewed = await callRpc(adminReviewClient, 'admin_start_provider_application_review', { p_application_id: application.id })
    assert(reviewed === 'under_review')
    application.status = 'under_review'
  }
  if (application.status === 'under_review') {
    const providerId = await callRpc(adminReviewClient, 'admin_approve_provider_application', { p_application_id: application.id })
    assert(typeof providerId === 'string')
    entry.providerId = providerId
  }

  const { data, error } = await applicantClient.rpc('get_my_provider_identity')
  assert(!error && Array.isArray(data) && data.length === 1)
  assert(data[0].provider_id === entry.providerId && data[0].provider_type === providerType)
  await persistCredentialState(state)
  return data[0]
}

function makeMemoryClient(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

async function signInIsolated(url, key, entry, expectedUserId) {
  const client = makeMemoryClient(url, key)
  const { data, error } = await client.auth.signInWithPassword({ email: entry.email, password: entry.password })
  assert(!error && data?.user?.id === expectedUserId && data?.session?.access_token)
  const { data: current, error: currentError } = await client.auth.getUser()
  assert(!currentError && current?.user?.id === expectedUserId)
  return client
}

async function callRpc(client, name, args) {
  return requireNoError(await client.rpc(name, args))
}

async function ownerFamilyMembers(ownerClient, groupId) {
  const members = await callRpc(ownerClient, 'get_family_members', { p_group_id: groupId })
  assert(Array.isArray(members))
  return members
}

async function ensureFamilyGroup(ownerClient, state) {
  const groups = await callRpc(ownerClient, 'get_my_family_groups', {})
  assert(Array.isArray(groups))
  const matching = groups.filter(group => group.display_name === ownerGroupName && group.is_owner)
  assert(matching.length <= 1)
  const groupId = matching[0]?.id ?? await callRpc(ownerClient, 'create_family_group', { p_display_name: ownerGroupName })
  state.familyGroupId = groupId
  await persistCredentialState(state)
  const members = await ownerFamilyMembers(ownerClient, groupId)
  assert(members.some(member => member.is_self && member.role === 'owner'))
  return { groupId, members }
}

async function ensureFamilyMember(ownerClient, memberClient, state, memberKey, groupId, memberFullName, members) {
  let existing = members.filter(member => member.display_name === memberFullName && !member.is_self && member.role === 'member')
  assert(existing.length <= 1)
  if (existing.length === 1) return existing[0]

  const invitations = await callRpc(memberClient, 'get_my_family_invitations', {})
  assert(Array.isArray(invitations))
  const pending = invitations.filter(item => item.is_incoming && item.family_group_id === groupId
    && item.display_name === ownerGroupName && item.status === 'pending' && Date.parse(item.expires_at) > Date.now())
  assert(pending.length <= 1)
  let invitationId = pending[0]?.id ?? state.identities[memberKey].invitationId
  if (!invitationId) {
    const joinCode = await callRpc(memberClient, 'create_family_join_code', {})
    assert(typeof joinCode === 'string' && joinCode.length >= 16)
    invitationId = await callRpc(ownerClient, 'invite_family_member', {
      p_group_id: groupId, p_join_code: joinCode, p_relationship: 'sibling',
    })
    state.identities[memberKey].invitationId = invitationId
    await persistCredentialState(state)
  }
  await callRpc(memberClient, 'respond_family_invitation', { p_invitation_id: invitationId, p_accept: true })
  members = await ownerFamilyMembers(ownerClient, groupId)
  existing = members.filter(member => member.display_name === memberFullName && !member.is_self && member.role === 'member')
  assert(existing.length === 1 && existing[0].relationship === 'sibling')
  state.identities[memberKey].familyMemberId = existing[0].id
  await persistCredentialState(state)
  return existing[0]
}

async function ensureFamilyReadScopes(ownerClient, state, groupId, members) {
  const noRecords = members.find(member => member.display_name === identitySpecs.find(spec => spec.key === 'H_FAMILY_NO_RECORDS').fullName)
  const records = members.find(member => member.display_name === identitySpecs.find(spec => spec.key === 'H_FAMILY_RECORDS').fullName)
  assert(noRecords && records)
  assert(!noRecords.authorization?.records)

  if (!(records.authorization?.status === 'active' && records.authorization?.records === true
    && Date.parse(records.authorization?.expires_at) > Date.now())) {
    await callRpc(ownerClient, 'grant_family_authorization', {
      p_viewer_member_id: records.id,
      p_permissions: { records: true },
      p_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    members = await ownerFamilyMembers(ownerClient, groupId)
  }
  const updated = members.find(member => member.display_name === identitySpecs.find(spec => spec.key === 'H_FAMILY_RECORDS').fullName)
  assert(updated?.authorization?.status === 'active' && updated.authorization.records === true)
  return members
}

async function ensureRelatedCareAssignment(ownerClient, adminSessionClient, state, owner, ownerProfileId, providerId, adminProfileId) {
  let requestsResult = await ownerClient.from('care_requests')
    .select('id,patient_id,requested_by_profile_id,service_type,reason_symptoms,urgency_level,status')
    .eq('patient_id', owner.id).eq('reason_symptoms', syntheticRequestReason).limit(2)
  assert(!requestsResult.error && Array.isArray(requestsResult.data) && requestsResult.data.length <= 1)
  let request = requestsResult.data[0]
  if (!request) {
    const result = await ownerClient.from('care_requests').insert({
      patient_id: owner.id,
      requested_by_profile_id: ownerProfileId,
      service_type: 'nurse_home_visit',
      reason_symptoms: syntheticRequestReason,
      urgency_level: 'unassessed',
      status: 'new',
    }).select('id,patient_id,requested_by_profile_id,service_type,reason_symptoms,urgency_level,status').single()
    assert(!result.error && result.data?.id)
    request = result.data
    state.careRequestId = request.id
    await persistCredentialState(state)
  }
  assert(request.patient_id === owner.id && request.requested_by_profile_id === ownerProfileId)
  assert(request.service_type === 'nurse_home_visit' && request.reason_symptoms === syntheticRequestReason)
  assert(request.urgency_level === 'unassessed' && request.status === 'new')

  let assignmentResult = await adminSessionClient.from('care_assignments')
    .select('id,care_request_id,provider_id,assigned_by_profile_id,status,assigned_at')
    .eq('care_request_id', request.id).eq('provider_id', providerId).limit(2)
  assert(!assignmentResult.error && Array.isArray(assignmentResult.data) && assignmentResult.data.length <= 1)
  let assignment = assignmentResult.data[0]
  if (!assignment) {
    const inserted = await adminSessionClient.from('care_assignments').insert({
      care_request_id: request.id,
      provider_id: providerId,
      assigned_by_profile_id: adminProfileId,
      status: 'assigned',
      assigned_at: new Date().toISOString(),
      match_reason: { marker: 'PHASE_H_TEST', purpose: 'Synthetic Phase H authorization verification only.' },
    }).select('id,care_request_id,provider_id,assigned_by_profile_id,status,assigned_at').single()
    assert(!inserted.error && inserted.data?.id)
    assignment = inserted.data
  }
  assert(assignment.provider_id === providerId && assignment.care_request_id === request.id)
  state.careRequestId = request.id
  state.careAssignmentId = assignment.id
  await persistCredentialState(state)
  return { request, assignment }
}

async function buildSyntheticPdf(marker = 'PHASE_H_TEST Synthetic PDF - NOT MEDICAL DATA') {
  const pdfMarker = String(marker).replace(/[()\\]/g, value => `\\${value}`)
  const pageContent = `BT /F1 14 Tf 72 720 Td (${pdfMarker}) Tj ET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(pageContent, 'ascii')} >>\nstream\n${pageContent}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document, 'ascii'))
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(document, 'ascii')
}

async function ensureOwnerDocument(state, ownerClient, owner, ownerProfileId) {
  const selectColumns = 'id,patient_id,uploaded_by_profile_id,source,status,original_filename,storage_bucket,storage_path,mime_type,file_size,title'
  let query = ownerClient.from('clinical_documents').select(selectColumns)
  if (state.documentId) query = query.eq('id', state.documentId)
  else query = query.eq('patient_id', owner.id).eq('uploaded_by_profile_id', ownerProfileId)
    .eq('source', 'patient_upload').eq('original_filename', syntheticDocumentFilename)
  const listed = await query.limit(2)
  assert(!listed.error && Array.isArray(listed.data) && listed.data.length <= 1)
  let document = listed.data[0]

  if (!document) {
    const pdf = await buildSyntheticPdf()
    const form = new FormData()
    form.append('action', 'upload')
    form.append('document_type', 'other')
    form.append('title', syntheticDocumentTitle)
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), syntheticDocumentFilename)
    const { data, error } = await ownerClient.functions.invoke('medical-document-intake', {
      body: form,
      timeout: 60_000,
    })
    assert(!error && data?.ok === true && typeof data.id === 'string')
    state.documentId = data.id
    await persistCredentialState(state)
    const created = await ownerClient.from('clinical_documents').select(selectColumns).eq('id', data.id).single()
    assert(!created.error)
    document = created.data
  }

  assert(document.patient_id === owner.id && document.uploaded_by_profile_id === ownerProfileId)
  assert(document.source === 'patient_upload' && document.status === 'active')
  assert(document.storage_bucket === bucketName && document.original_filename === syntheticDocumentFilename)
  assert(document.mime_type === 'application/pdf' && document.title === syntheticDocumentTitle)
  assert(document.file_size > 0 && document.file_size <= 10 * 1024 * 1024)
  const { data: object, error: objectError } = await ownerClient.storage.from(bucketName).download(document.storage_path)
  assert(!objectError && object)
  const bytes = Buffer.from(await object.arrayBuffer())
  assert(bytes.subarray(0, 5).toString('ascii') === '%PDF-')
  state.documentId = document.id
  await persistCredentialState(state)
  return document
}

async function readDocumentAs(client, documentId) {
  const { data, error } = await client.from('clinical_documents').select('id').eq('id', documentId)
  assert(!error && Array.isArray(data))
  return data.length === 1
}

async function canReadSignedObject(client, storagePath) {
  const { data, error } = await client.storage.from(bucketName).createSignedUrl(storagePath, 60)
  if (error) {
    const status = Number(error.statusCode ?? error.status ?? 0)
    assert([400, 403, 404].includes(status))
    return false
  }
  assert(typeof data?.signedUrl === 'string' && data.signedUrl.length > 0)
  return true
}

async function canAccessPatient(client, patientId) {
  const value = await callRpc(client, 'can_access_patient', {
    target_patient_id: patientId,
    permission_name: 'clinical',
  })
  assert(typeof value === 'boolean')
  return value
}

async function edgeActionDenied(client, body) {
  const result = await client.functions.invoke('medical-document-intake', { body, timeout: 60_000 })
  if (!result.error) return false
  const status = result.error.context?.status
  return status === 403
}

async function verifyIsolationAndScopes(clients, identities, owner, document, providers) {
  const ownerId = identities.H_OWNER.userId
  const unrelatedClient = clients.H_UNRELATED_PATIENT
  assert(await canAccessPatient(clients.H_OWNER, owner.id))
  assert(!(await canAccessPatient(unrelatedClient, owner.id)))
  assert(!(await readDocumentAs(unrelatedClient, document.id)))
  assert(!(await canReadSignedObject(unrelatedClient, document.storage_path)))

  assert(!(await canAccessPatient(clients.H_FAMILY_NO_RECORDS, owner.id)))
  assert(!(await readDocumentAs(clients.H_FAMILY_NO_RECORDS, document.id)))
  assert(!(await canReadSignedObject(clients.H_FAMILY_NO_RECORDS, document.storage_path)))

  assert(await canAccessPatient(clients.H_FAMILY_RECORDS, owner.id))
  assert(await readDocumentAs(clients.H_FAMILY_RECORDS, document.id))
  assert(await canReadSignedObject(clients.H_FAMILY_RECORDS, document.storage_path))

  assert(!(await canAccessPatient(clients.H_PROVIDER_UNRELATED, owner.id)))
  assert(!(await readDocumentAs(clients.H_PROVIDER_UNRELATED, document.id)))
  assert(!(await canReadSignedObject(clients.H_PROVIDER_UNRELATED, document.storage_path)))

  assert(await canAccessPatient(clients.H_PROVIDER_RELATED, owner.id))
  assert(await readDocumentAs(clients.H_PROVIDER_RELATED, document.id))
  assert(await canReadSignedObject(clients.H_PROVIDER_RELATED, document.storage_path))

  for (const key of ['H_PROVIDER_UNRELATED', 'H_PROVIDER_RELATED']) {
    assert(await edgeActionDenied(clients[key], { action: 'upload' }))
    assert(await edgeActionDenied(clients[key], { action: 'remove', document_id: document.id }))
    const { data, error } = await clients[key].rpc('get_my_provider_identity')
    assert(!error && Array.isArray(data) && data.length === 1)
    assert(data[0].provider_id === providers[key].provider_id && data[0].provider_type === 'nurse_aide')
  }

  const { data: ownerIdentity, error: ownerIdentityError } = await clients.H_OWNER.auth.getUser()
  assert(!ownerIdentityError && ownerIdentity.user.id === ownerId)
}

function printSummary() {
  console.log(`H_OWNER READY? ${summary.H_OWNER ? 'YES' : 'NO'}`)
  console.log(`H_UNRELATED_PATIENT READY? ${summary.H_UNRELATED_PATIENT ? 'YES' : 'NO'}`)
  console.log(`H_FAMILY_NO_RECORDS READY? ${summary.H_FAMILY_NO_RECORDS ? 'YES' : 'NO'}`)
  console.log(`H_FAMILY_RECORDS READY? ${summary.H_FAMILY_RECORDS ? 'YES' : 'NO'}`)
  console.log(`H_PROVIDER_UNRELATED READY? ${summary.H_PROVIDER_UNRELATED ? 'YES' : 'NO'}`)
  console.log(`H_PROVIDER_RELATED READY? ${summary.H_PROVIDER_RELATED ? 'YES' : 'NO'}`)
  console.log(`OWNER SYNTHETIC PDF READY? ${summary['OWNER SYNTHETIC PDF'] ? 'YES' : 'NO'}`)
  console.log(`ISOLATED AUTH CLIENTS WORK? ${summary['ISOLATED AUTH CLIENTS'] ? 'YES' : 'NO'}`)
  console.log(`IDENTITY INVARIANTS PRESERVED? ${summary['IDENTITY INVARIANTS'] ? 'YES' : 'NO'}`)
  console.log(`REAL USER DATA MODIFIED? ${summary['REAL USER DATA MODIFIED'] ? 'YES' : 'NO'}`)
  console.log(`CREDENTIALS/TOKENS EXPOSED? ${summary['CREDENTIALS/TOKENS EXPOSED'] ? 'YES' : 'NO'}`)
  console.log(`SAFE TO RUN FINAL PHASE H AUTHORIZATION TESTS? ${summary['SAFE TO RUN FINAL PHASE H TESTS'] ? 'YES' : 'NO'}`)
}

async function main() {
  setupFailureStage = 'configuration-preflight'
  assert(process.argv.includes('--create-fixtures'))
  assert(process.argv.includes('--confirm-synthetic-provider-approval'))
  checkCredentialFileIgnored()
  const supabaseUrl = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
  const adminEmail = process.env.PHASE_H_ADMIN_EMAIL
  const adminPassword = process.env.PHASE_H_ADMIN_PASSWORD
  assert(typeof supabaseUrl === 'string' && typeof secretKey === 'string' && secretKey.length > 0)
  assert(typeof publicKey === 'string' && publicKey.length > 0)
  assert(typeof adminEmail === 'string' && adminEmail.length > 0)
  assert(typeof adminPassword === 'string' && adminPassword.length > 0)
  const parsedUrl = new URL(supabaseUrl)
  assert(parsedUrl.protocol === 'https:' && parsedUrl.hostname === `${TARGET_PROJECT_REF}.supabase.co`)

  const admin = makeMemoryClient(supabaseUrl, secretKey)
  const preflight = await runPreflight()
  assert(preflight.preflightReady)

  const adminSessionClient = makeMemoryClient(supabaseUrl, publicKey)
  const adminSignIn = await adminSessionClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  assert(!adminSignIn.error && adminSignIn.data?.user?.id && adminSignIn.data?.session)
  const adminProfileId = adminSignIn.data.user.id
  const { data: isAdmin, error: adminCheckError } = await adminSessionClient.rpc('is_main_admin')
  assert(!adminCheckError && isAdmin === true)

  let state = await readCredentialState()
  if (!state) {
    // Do not create fixtures if a reserved synthetic address is already occupied.
    state = await newCredentialState()
    const emails = new Set(identitySpecs.map(spec => state.identities[spec.key].email.toLowerCase()))
    const authMatches = await inspectAuthUsers(admin, emails)
    assert(authMatches.size === 0)
    await persistCredentialState(state)
  }

  const { authMatches } = await preflightExistingFixtures(admin, state)
  const identities = {}
  const patientRows = {}
  const providerRows = {}
  const clients = {}

  for (const spec of identitySpecs) {
    setupFailureStage = `auth-user:${spec.key}`
    const userId = await ensureAuthUser(admin, state, spec, authMatches)
    identities[spec.key] = { userId, ...state.identities[spec.key] }
    clients[spec.key] = await signInIsolated(supabaseUrl, publicKey, state.identities[spec.key], userId)
    setupFailureStage = `patient-registration:${spec.key}`
    patientRows[spec.key] = await ensurePatientIdentity(admin, state, spec, userId, clients[spec.key])
  }

  const patientKeys = identitySpecs.map(spec => spec.key)
  summary['IDENTITY INVARIANTS'] = patientKeys.every(key => {
    const patient = patientRows[key]
    const id = identities[key].userId
    return patient?.profile_id === id && patient?.auth_user_id === id && patient?.id !== id && patient?.status === 'active'
  })
  assert(summary['IDENTITY INVARIANTS'])
  summary['ISOLATED AUTH CLIENTS'] = Object.keys(clients).length === identitySpecs.length

  for (const key of ['H_PROVIDER_UNRELATED', 'H_PROVIDER_RELATED']) {
    setupFailureStage = `provider-application-approval:${key}`
    const spec = identitySpecs.find(item => item.key === key)
    providerRows[key] = await ensureProviderIdentity(adminSessionClient, clients[key], state, spec, identities[key].userId)
  }

  const owner = patientRows.H_OWNER
  setupFailureStage = 'family-rpc-fixtures'
  const family = await ensureFamilyGroup(clients.H_OWNER, state)
  let familyMembers = await ensureFamilyMember(
    clients.H_OWNER, clients.H_FAMILY_NO_RECORDS, state, 'H_FAMILY_NO_RECORDS', family.groupId,
    identitySpecs.find(spec => spec.key === 'H_FAMILY_NO_RECORDS').fullName, family.members,
  )
  familyMembers = await ownerFamilyMembers(clients.H_OWNER, family.groupId)
  await ensureFamilyMember(
    clients.H_OWNER, clients.H_FAMILY_RECORDS, state, 'H_FAMILY_RECORDS', family.groupId,
    identitySpecs.find(spec => spec.key === 'H_FAMILY_RECORDS').fullName, familyMembers,
  )
  familyMembers = await ownerFamilyMembers(clients.H_OWNER, family.groupId)
  familyMembers = await ensureFamilyReadScopes(clients.H_OWNER, state, family.groupId, familyMembers)
  summary.H_FAMILY_NO_RECORDS = true
  summary.H_FAMILY_RECORDS = true

  setupFailureStage = 'patient-care-request-and-admin-assignment'
  const relationship = await ensureRelatedCareAssignment(
    clients.H_OWNER, adminSessionClient, state, owner, identities.H_OWNER.userId,
    providerRows.H_PROVIDER_RELATED.provider_id, adminProfileId,
  )
  assert(relationship.assignment.provider_id === providerRows.H_PROVIDER_RELATED.provider_id)

  setupFailureStage = 'owner-medical-document-intake'
  const document = await ensureOwnerDocument(
    state, clients.H_OWNER, owner, identities.H_OWNER.userId,
  )
  summary['OWNER SYNTHETIC PDF'] = true

  setupFailureStage = 'authorization-verification'
  await verifyIsolationAndScopes(clients, identities, owner, document, providerRows)
  setupFailureStage = 'NONE'
  for (const spec of identitySpecs) summary[spec.key] = true
  summary['REAL USER DATA MODIFIED'] = false
  summary['CREDENTIALS/TOKENS EXPOSED'] = false
  summary['SAFE TO RUN FINAL PHASE H TESTS'] = true
}

if (process.argv.includes('--preflight')) {
  try {
    await runPreflight()
  } catch {
    // Do not print raw SDK, URL, Auth, or HTTP error details.
    console.log('ADMIN AUTH ACCESS? NO')
    console.log('PATIENT REGISTRATION RPC? NO')
    console.log('FAMILY RPC SET COMPLETE? NO')
    console.log('PROVIDER FIXTURE TABLES READY? NO')
    console.log('CLINICAL DOCUMENTS READY? NO')
    console.log('PRIVATE MEDICAL BUCKET READY? NO')
    console.log('EDGE FUNCTION READY? NO')
    console.log('MAIN-ADMIN SESSION VERIFIED? NO')
    console.log('FIRST PREFLIGHT FAILURE STEP: preflight-diagnostic')
    console.log('FIRST PREFLIGHT ERROR: SANITIZED_PREFLIGHT_FAILURE')
    console.log('SCRIPT ASSUMPTION WRONG? NO')
    console.log('SAFE TO RUN FIXTURE CREATION? NO')
    process.exitCode = 1
  }
} else if (process.argv.includes('--startup-check')) {
  printStartupCheck()
} else if (process.argv.includes('--create-fixtures')) {
  try {
    await main()
  } catch {
    // Keep partial synthetic state resumable; never expose raw Auth/RPC errors.
    console.log(`FIRST SETUP FAILURE STEP: ${setupFailureStage}`)
    summary['REAL USER DATA MODIFIED'] = false
    summary['CREDENTIALS/TOKENS EXPOSED'] = false
    summary['SAFE TO RUN FINAL PHASE H TESTS'] = false
    process.exitCode = 1
  } finally {
    printSummary()
  }
} else {
  console.log('NO ACTION TAKEN. Use --startup-check, --preflight, or the explicitly confirmed --create-fixtures mode.')
}
