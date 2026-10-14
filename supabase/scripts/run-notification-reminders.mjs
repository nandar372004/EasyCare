import { pathToFileURL } from 'node:url'

export const STAGING_SUPABASE_URL = 'https://xyprybspwrtthvhnumdp.supabase.co'

export async function runNotificationReminders({ supabaseUrl, serviceRoleKey, fetchImpl = fetch }) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('REMINDER_CONFIGURATION_MISSING')
  const base = new URL(supabaseUrl)
  // Reject every other project before sending the service-role credential.
  if (base.origin !== STAGING_SUPABASE_URL || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw new Error('REMINDER_STAGING_TARGET_REQUIRED')
  }
  let response
  try {
    response = await fetchImpl(`${base.origin}${base.pathname.replace(/\/$/, '')}/rest/v1/rpc/generate_patient_notification_reminders`, {
      method: 'POST', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(120_000),
    })
  } catch { throw new Error('REMINDER_RPC_TRANSPORT_FAILED') }
  if (!response.ok) throw new Error(`REMINDER_RPC_HTTP_${response.status}`)
  const generated = await response.json()
  if (!Number.isInteger(generated) || generated < 0) throw new Error('REMINDER_RPC_RESPONSE_INVALID')
  return generated
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNotificationReminders({ supabaseUrl: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY })
    .then(generated => console.log(JSON.stringify({ event: 'notification_reminders_complete', generated })))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
