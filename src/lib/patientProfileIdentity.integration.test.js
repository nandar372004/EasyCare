// @vitest-environment node
// Executes the actual migration chain in isolated PostgreSQL/WASM. Only managed
// Auth's users table, auth.uid(), and roles are simulated; no hosted DB is used.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { signInPatient } from '../services/authService.js'
import { createSupabaseRepository } from '../services/repositories/supabaseRepository.js'

const directory = join(process.cwd(), 'supabase/migrations')
const repairName = '20260928090000_patient_profile_identity_repair.sql'
const repair = readFileSync(join(directory, repairName), 'utf8')
const registrationConsentTypes = readFileSync(join(directory, '20261004120000_registration_consent_types.sql'), 'utf8')
const registrationConsent = readFileSync(join(directory, '20261004130000_registration_consent_document_identity.sql'), 'utf8')
const userA = '71000000-0000-4000-8000-000000000001'
const userB = '71000000-0000-4000-8000-000000000002'
const userC = '71000000-0000-4000-8000-000000000003'
const providerUser = '71000000-0000-4000-8000-000000000004'

async function baseline() {
  const database = new PGlite({ extensions: { btree_gist, pgcrypto } })
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `)
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql') && name < repairName).sort()) {
    await database.exec(readFileSync(join(directory, name), 'utf8'))
  }
  await database.query('insert into auth.users(id) values ($1), ($2), ($3)', [userA, userB, userC])
  return database
}

const registration = (userId, phone = '+959770000003') => ({
  userId, fullName: 'Synthetic New Patient', phone, dateOfBirth: '1995-04-12',
  gender: 'Prefer not to say', preferredLanguage: 'en', addressCity: 'Yangon',
  emergencyContact: { name: 'Synthetic Contact', relationship: 'Sibling', phone_number: '+959770000009' },
  medicalProfile: { blood_type: 'Unknown', no_known_allergies: true },
})

async function asPatient(database, userId = userA) {
  await database.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
  await database.exec('set local role authenticated')
}

// Minimal transport adapter: application projections and filters execute as SQL
// under the real authenticated role/RLS, rather than returning mocked rows.
function patientClient(database) {
  return {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: { id: userA } }, user: { id: userA } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from(table) {
      if (table !== 'patients') throw new Error('Unexpected test table')
      let columns
      const filters = []
      const chain = {
        select(value) { columns = value; return chain },
        eq(column, value) { filters.push([column, value]); return chain },
        async single() {
          try {
            // All identifiers originate in the checked-in application adapter.
            const where = filters.map(([column], index) => `${column} = $${index + 1}`).join(' and ')
            const { rows } = await database.query(`select ${columns} from public.patients where ${where}`, filters.map(([, value]) => value))
            return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116' } }
          } catch (error) { return { data: null, error } }
        },
      }
      return chain
    },
  }
}

describe('Phase 1 patient/profile identity repair in PostgreSQL', () => {
  let db
  let patientA
  let patientB
  let beforePatient
  let beforeProfile
  let beforeProviders

  beforeAll(async () => {
    db = await baseline()
    // The pre-repair RPC creates a patient with no profile.
    patientA = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify(registration(userA, '+959770000001'))])).rows[0].id
    patientB = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify(registration(userB, '+959770000002'))])).rows[0].id
    // Existing profile demographics/role must never be overwritten by backfill.
    await db.query("insert into public.profiles(id, role, full_name, status) values ($1, 'family', 'Preserve Existing Name', 'inactive')", [userB])
    await db.query('update public.patients set profile_id = $1 where id = $2', [userB, patientB])
    await db.query('insert into auth.users(id) values ($1)', [providerUser])
    await db.query("insert into public.profiles(id, role, full_name) values ($1, 'doctor', 'Synthetic Account Doctor')", [providerUser])
    await db.query("insert into public.providers(profile_id, provider_type, verification_status, display_name) values ($1, 'doctor', 'verified', 'Synthetic Account Doctor')", [providerUser])
    beforePatient = (await db.query('select * from public.patients where id = $1', [patientA])).rows[0]
    beforeProfile = (await db.query('select * from public.profiles where id = $1', [userB])).rows[0]
    beforeProviders = (await db.query('select * from public.providers order by id')).rows
    await db.exec(repair)
    await db.exec(registrationConsentTypes)
    await db.exec(registrationConsent)
  }, 60000)

  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('backfills the missing identity without changing patient data, existing profiles, or providers', async () => {
    const patient = (await db.query('select * from public.patients where id = $1', [patientA])).rows[0]
    const { profile_id, updated_at, ...preserved } = patient
    const { profile_id: oldProfile, updated_at: oldUpdated, ...original } = beforePatient
    expect(oldProfile).toBeNull()
    expect(profile_id).toBe(userA)
    expect(preserved).toEqual(original)
    expect((await db.query('select * from public.profiles where id = $1', [userB])).rows[0]).toEqual(beforeProfile)
    expect((await db.query('select * from public.providers order by id')).rows).toEqual(beforeProviders)
    expect((await db.query('select count(*)::int as count from public.patients')).rows[0].count).toBe(2)
  })

  it('registers a new patient, matching profile, and attributed consents through the existing service RPC', async () => {
    await db.exec('set local role service_role')
    const id = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify(registration(userC))])).rows[0].id
    await db.exec('reset role')
    expect((await db.query('select profile_id, auth_user_id from public.patients where id = $1', [id])).rows[0]).toEqual({ profile_id: userC, auth_user_id: userC })
    expect((await db.query('select role, full_name from public.profiles where id = $1', [userC])).rows[0]).toEqual({ role: 'patient', full_name: 'Synthetic New Patient' })
    const consents = (await db.query('select granted_by_profile_id from public.consents where patient_id = $1', [id])).rows
    expect(consents).toHaveLength(2)
    expect(consents.every((row) => row.granted_by_profile_id === userC)).toBe(true)
  })

  it('creates Account B with new Auth, profile, and patient identities while preserving Account A', async () => {
    const accountA = {
      authUser: (await db.query('select id from auth.users where id=$1', [userA])).rows[0],
      profile: (await db.query('select * from public.profiles where id=$1', [userA])).rows[0],
      patient: (await db.query('select * from public.patients where auth_user_id=$1', [userA])).rows[0],
    }
    await db.exec('set local role service_role')
    const patientBId = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      userId: userC,
      fullName: 'Account B',
      phone: '+959770000003',
      dateOfBirth: '1990-05-06',
      termsAccepted: true,
      privacyConsent: true,
      role: 'doctor',
      patientId: patientA,
    })])).rows[0].id
    await db.exec('reset role')
    const patientB = (await db.query('select * from public.patients where id=$1', [patientBId])).rows[0]
    const profileB = (await db.query('select * from public.profiles where id=$1', [userC])).rows[0]
    expect(patientB.id).not.toBe(patientA)
    expect(patientB.auth_user_id).toBe(userC)
    expect(patientB.profile_id).toBe(userC)
    expect(patientB.full_name).toBe('Account B')
    expect(profileB.id).toBe(userC)
    expect(profileB.role).toBe('patient')
    expect((await db.query('select id from auth.users where id=$1', [userA])).rows[0]).toEqual(accountA.authUser)
    expect((await db.query('select * from public.profiles where id=$1', [userA])).rows[0]).toEqual(accountA.profile)
    expect((await db.query('select * from public.patients where auth_user_id=$1', [userA])).rows[0]).toEqual(accountA.patient)
  })

  it('records Terms and Privacy as separate versioned document acknowledgements', async () => {
    await db.exec('set local role service_role')
    const id = (await db.query('select public.create_patient_registration($1::jsonb) as id', [JSON.stringify({
      ...registration(userC), termsAccepted: true, privacyConsent: true,
    })])).rows[0].id
    await db.exec('reset role')
    const evidence = (await db.query(
      'select document_key, consent_type, version, status, granted_by_profile_id, granted_at from public.consents where patient_id = $1 order by document_key',
      [id],
    )).rows
    expect(evidence).toHaveLength(2)
    expect(evidence.map(({ document_key, consent_type, version, status, granted_by_profile_id, granted_at }) => ({
      document_key, consent_type, version, status, granted_by_profile_id, hasTimestamp: granted_at instanceof Date || Boolean(granted_at),
    }))).toEqual([
      { document_key: 'privacy_policy', consent_type: 'privacy_policy', version: 'privacy-v1', status: 'granted', granted_by_profile_id: userC, hasTimestamp: true },
      { document_key: 'terms_of_service', consent_type: 'terms_of_service', version: 'terms-v1', status: 'granted', granted_by_profile_id: userC, hasTimestamp: true },
    ])
  })

  it('rolls back profile creation when a later patient insert fails', async () => {
    await db.exec('savepoint failed_registration')
    const invalid = registration(userC, '+959770000001')
    await expect(db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(invalid)])).rejects.toThrow()
    await db.exec('rollback to savepoint failed_registration')
    expect((await db.query('select id from public.profiles where id = $1', [userC])).rows).toEqual([])
    expect((await db.query('select id from public.patients where auth_user_id = $1', [userC])).rows).toEqual([])
  })

  it('rejects registration without a managed Auth identity', async () => {
    await expect(db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(registration('71000000-0000-4000-8000-000000000099'))])).rejects.toThrow('Invalid managed Auth user')
  })

  it('preserves existing patient login and the current auth_user_id projection', async () => {
    await asPatient(db)
    const client = patientClient(db)
    const result = await signInPatient({ phoneNumber: '09770000001', password: 'Synthetic123' }, client)
    expect(result.patient.id).toBe(patientA)
    expect(result.patient.auth_user_id).toBe(userA)
    expect(client.auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('loads the patient settings projection and the matching profile under RLS', async () => {
    await asPatient(db)
    const repository = createSupabaseRepository(patientClient(db))
    expect((await repository.getPatientProfile({ patientId: patientA, authUserId: userA })).id).toBe(patientA)
    expect((await db.query('select id, role, status from public.profiles')).rows).toEqual([{ id: userA, role: 'patient', status: 'active' }])
  })

  it('preserves authorized settings updates without changing either identity', async () => {
    await asPatient(db)
    const result = await db.query("update public.patients set full_name = 'Updated Patient', city = 'Mandalay' where id = $1 returning id, profile_id, auth_user_id", [patientA])
    expect(result.rows).toEqual([{ id: patientA, profile_id: userA, auth_user_id: userA }])
  })

  it('blocks cross-patient reads and settings updates even with the other user ID supplied', async () => {
    await asPatient(db)
    const repository = createSupabaseRepository(patientClient(db))
    await expect(repository.getPatientProfile({ patientId: patientB, authUserId: userB })).rejects.toThrow('Repository request failed.')
    expect((await db.query('update public.patients set full_name = $1 where id = $2 returning id', ['Forbidden', patientB])).rows).toEqual([])
    expect((await db.query('select id from public.profiles where id = $1', [userB])).rows).toEqual([])
  })

  it('denies browser registration RPC and identity reassignment', async () => {
    await asPatient(db)
    await db.exec('savepoint denied')
    await expect(db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(registration(userC))])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint denied')
    await expect(db.query('update public.patients set profile_id = $1 where id = $2', [userC, patientA])).rejects.toMatchObject({ code: '42501' })
  })

  it('protects profile identity even if an installation has broader update grants', async () => {
    await db.exec('grant update (profile_id) on public.patients to authenticated')
    await asPatient(db)
    await expect(db.query('update public.patients set profile_id = $1 where id = $2', [userC, patientA])).rejects.toThrow('Patient authentication fields cannot be changed')
  })

  it('does not expose patient or profile identities or registration to anonymous callers', async () => {
    await db.exec('set local role anon; savepoint anonymous_access')
    await expect(db.query('select id from public.patients')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anonymous_access')
    await expect(db.query('select id from public.profiles')).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint anonymous_access')
    await expect(db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(registration(userC))])).rejects.toMatchObject({ code: '42501' })
  })

  it('enforces identity equality and non-null links even for privileged writes', async () => {
    await db.exec('savepoint invalid_link')
    await expect(db.query('update public.patients set profile_id = $1 where id = $2', [userC, patientA])).rejects.toMatchObject({ code: '23514' })
    await db.exec('rollback to savepoint invalid_link')
    await expect(db.query('update public.patients set profile_id = null where id = $1', [patientA])).rejects.toMatchObject({ code: '23502' })
  })

  it('preserves booking with a catalog provider and the current nullable booked_by_profile_id', async () => {
    const slot = (await db.query("select * from public.provider_availability where status = 'available' and service_type = 'teleconsultation' order by id limit 1")).rows[0]
    await asPatient(db)
    const result = await db.query(`insert into public.appointments (
      patient_id, provider_id, provider_availability_id, booked_by_profile_id,
      appointment_type, consultation_channel, scheduled_start, scheduled_end,
      status, fee_amount, currency, booking_code
    ) values ($1, $2, $3, null, 'teleconsultation', 'video', $4, $5, 'pending', 25000, 'MMK', 'ECA-IDENTITY-TEST') returning id`,
    [patientA, slot.provider_id, slot.id, slot.start_at, slot.end_at])
    expect(result.rows).toHaveLength(1)
    await db.exec('reset role')
    expect((await db.query('select status from public.provider_availability where id = $1', [slot.id])).rows[0].status).toBe('booked')
  })

  it('still resolves an existing provider through Auth and its unchanged profile', async () => {
    const identity = (await db.query(`select u.id as auth_id, p.id as profile_id, provider.id as provider_id
      from auth.users u join public.profiles p on p.id = u.id
      join public.providers provider on provider.profile_id = p.id where u.id = $1`, [providerUser])).rows
    expect(identity).toHaveLength(1)
    expect(identity[0]).toMatchObject({ auth_id: providerUser, profile_id: providerUser })
    await asPatient(db, providerUser)
    expect((await db.query('select public.current_profile_role() as role')).rows).toEqual([{ role: 'doctor' }])
    expect((await db.query('select id from public.profiles')).rows).toEqual([{ id: providerUser }])
    expect((await db.query('select id from public.providers where id = $1', [identity[0].provider_id])).rows).toHaveLength(1)
    expect((await db.query('select id from public.patients')).rows).toEqual([])
  })

  it('has no orphan references across any public-table foreign key after repair and registration', async () => {
    await db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(registration(userC))])
    const constraints = (await db.query(`select c.conname, c.convalidated,
        ns.nspname as child_schema, child.relname as child_table,
        parent_ns.nspname as parent_schema, parent.relname as parent_table,
        array(select a.attname from unnest(c.conkey) with ordinality k(num, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num order by k.ord) as child_columns,
        array(select a.attname from unnest(c.confkey) with ordinality k(num, ord)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num order by k.ord) as parent_columns
      from pg_constraint c join pg_class child on child.oid = c.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where c.contype = 'f' and ns.nspname = 'public'`)).rows
    expect(constraints.length).toBeGreaterThan(40)
    const quote = (name) => `"${name.replaceAll('"', '""')}"`
    for (const fk of constraints) {
      expect(fk.convalidated, fk.conname).toBe(true)
      const nonNull = fk.child_columns.map((column) => `child.${quote(column)} is not null`).join(' and ')
      const matches = fk.child_columns.map((column, i) => `child.${quote(column)} = parent.${quote(fk.parent_columns[i])}`).join(' and ')
      const { rows } = await db.query(`select count(*)::int as orphans
        from ${quote(fk.child_schema)}.${quote(fk.child_table)} child where ${nonNull}
        and not exists (select 1 from ${quote(fk.parent_schema)}.${quote(fk.parent_table)} parent where ${matches})`)
      expect(rows[0].orphans, fk.conname).toBe(0)
    }
  })

  it('rejects orphan Auth, patient, and provider references at the database boundary', async () => {
    const missing = '71000000-0000-4000-8000-000000000099'
    await db.exec('savepoint orphan_attempt')
    await expect(db.query("insert into public.profiles(id, role, full_name) values ($1, 'patient', 'Orphan')", [missing])).rejects.toMatchObject({ code: '23503' })
    await db.exec('rollback to savepoint orphan_attempt')
    await expect(db.query("insert into public.providers(profile_id, provider_type) values ($1, 'doctor')", [missing])).rejects.toMatchObject({ code: '23503' })
    await db.exec('rollback to savepoint orphan_attempt')
    await expect(db.query('update public.patients set profile_id = $1, auth_user_id = $1 where id = $2', [missing, patientA])).rejects.toMatchObject({ code: '23503' })
  })

  it('RLS still blocks the other patient when table-level privileges are broad', async () => {
    expect((await db.query("select relrowsecurity from pg_class where oid in ('public.patients'::regclass, 'public.profiles'::regclass)")).rows).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }])
    await db.exec('grant select, update on public.patients, public.profiles to authenticated')
    await asPatient(db, userB)
    expect((await db.query('select id from public.patients')).rows).toEqual([{ id: patientB }])
    expect((await db.query('select id from public.profiles')).rows).toEqual([{ id: userB }])
    expect((await db.query('select id from public.patients where id = $1', [patientA])).rows).toEqual([])
    expect((await db.query("update public.patients set full_name = 'Forbidden' where id = $1 returning id", [patientA])).rows).toEqual([])
    await db.exec('reset role; grant select on public.patients, public.profiles to anon; set local role anon')
    expect((await db.query('select id from public.patients')).rows).toEqual([])
    expect((await db.query('select id from public.profiles')).rows).toEqual([])
  })

  it('keeps the existing consent owner policy usable through the canonical profile link', async () => {
    // Explicitly supply only the privilege needed to exercise the existing
    // policy; baseline grants differ between Supabase installations.
    await db.exec('grant select on public.consents to authenticated')
    await asPatient(db)
    expect((await db.query('select patient_id from public.consents')).rows.every((row) => row.patient_id === patientA)).toBe(true)
    expect((await db.query('select patient_id from public.consents')).rows).toHaveLength(2)
  })

  it('runs the read-only validation script successfully', async () => {
    await db.exec('rollback')
    const results = await db.exec(readFileSync(join(process.cwd(), 'supabase/scripts/patient_profile_identity_validation.sql'), 'utf8'))
    const summary = results.find((result) => result.rows[0]?.patient_count !== undefined).rows[0]
    expect(Number(summary.missing_profile_links)).toBe(0)
    expect(Number(summary.conflicting_links)).toBe(0)
  })
})

describe('identity backfill conflicts fail atomically', () => {
  it.each(['identity', 'phone', 'email'])('refuses %s conflicts without partial backfill', async (conflict) => {
    const db = await baseline()
    try {
      await db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify(registration(userA, '+959770000001'))])
      if (conflict === 'email') {
        await db.query('select public.create_patient_registration($1::jsonb)', [JSON.stringify({ ...registration(userB, '+959770000002'), email: 'same@example.invalid' })])
        await db.query("update public.patients set email = 'SAME@example.invalid' where auth_user_id = $1", [userA])
      } else {
        await db.query("insert into public.profiles(id, role, full_name, phone) values ($1, 'doctor', 'Unrelated Profile', $2)", [userB, conflict === 'phone' ? '+959770000001' : null])
        if (conflict === 'identity') await db.query('update public.patients set profile_id = $1 where auth_user_id = $2', [userB, userA])
      }
      const before = (await db.query('select * from public.patients order by id')).rows
      await expect(db.exec(repair)).rejects.toThrow('Identity repair stopped')
      await db.exec('rollback')
      expect((await db.query('select * from public.patients order by id')).rows).toEqual(before)
      expect((await db.query('select id from public.profiles where id = $1', [userA])).rows).toEqual([])
    } finally { await db.close() }
  }, 60000)
})
