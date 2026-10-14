// Read-only negative Staging probes. No account creation, admin credentials,
// impersonation, authorization changes, or patient data are used or printed.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]] : []
}))
const target = 'xyprybspwrtthvhnumdp.supabase.co'
if (!env.VITE_SUPABASE_URL || new URL(env.VITE_SUPABASE_URL).hostname !== target) {
  console.log(JSON.stringify({ stagingTargetMatches: false, liveVerification: 'not run' }))
  process.exit(1)
}
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
let role
try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role } catch { /* publishable keys are not JWTs */ }
if (!key || key.startsWith('sb_secret_') || !key.startsWith('sb_publishable_') && role !== 'anon') throw new Error('A browser-safe Staging key is required.')
let settings
try {
  settings = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) })
} catch {
  console.log(JSON.stringify({ stagingTargetMatches: true, networkAvailable: false, liveVerification: 'not run', authenticatedAccountsVerified: false }))
  process.exit(2)
}
if (!settings.ok) { console.log(JSON.stringify({ stagingTargetMatches: true, publicKeyAccepted: false })); process.exit(1) }
const client = createClient(env.VITE_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) } })
const nonexistent = '00000000-0000-4000-8000-000000000000'
const probes = await Promise.all([
  ['family directory', 'get_my_family_groups', {}],
  ['direct member route boundary', 'get_family_health_members', { p_group_id: nonexistent }],
  ['direct plan projection boundary', 'get_family_care_plan_readout', { p_group_id: nonexistent, p_member_id: nonexistent }],
].map(async ([name, rpc, args]) => {
  const { data, error } = await client.rpc(rpc, args)
  return { name, denied: error?.code === '42501' && data === null, errorCode: error?.code || null }
}))
console.log(JSON.stringify({ stagingTargetMatches: true, publicKeyAccepted: true, anonymousProbes: probes, authenticatedAccountsVerified: false }, null, 2))
if (probes.some(probe => !probe.denied)) process.exitCode = 1
