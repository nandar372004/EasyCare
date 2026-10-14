// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runNotificationReminders, STAGING_SUPABASE_URL } from '../../supabase/scripts/run-notification-reminders.mjs'

it('calls only the trusted reminder RPC without injecting browser time or patient identity', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => 5 })
  expect(await runNotificationReminders({ supabaseUrl: STAGING_SUPABASE_URL, serviceRoleKey: 'test-key', fetchImpl })).toBe(5)
  expect(fetchImpl).toHaveBeenCalledWith(`${STAGING_SUPABASE_URL}/rest/v1/rpc/generate_patient_notification_reminders`, expect.objectContaining({
    method: 'POST', body: '{}', headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
  }))
})

it('fails visibly on scheduler configuration or RPC errors', async () => {
  await expect(runNotificationReminders({})).rejects.toThrow('REMINDER_CONFIGURATION_MISSING')
  await expect(runNotificationReminders({ supabaseUrl: STAGING_SUPABASE_URL, serviceRoleKey: 'key', fetchImpl: async () => ({ ok: false, status: 403 }) })).rejects.toThrow('REMINDER_RPC_HTTP_403')
})

it('rejects other projects and URL credentials before sending any secret', async () => {
  const fetchImpl = vi.fn()
  for (const supabaseUrl of ['https://production.supabase.co', 'http://xyprybspwrtthvhnumdp.supabase.co', `${STAGING_SUPABASE_URL}/extra`, `${STAGING_SUPABASE_URL}?target=production`, 'https://user:password@xyprybspwrtthvhnumdp.supabase.co']) {
    await expect(runNotificationReminders({ supabaseUrl, serviceRoleKey: 'never-send', fetchImpl })).rejects.toThrow('REMINDER_STAGING_TARGET_REQUIRED')
  }
  expect(fetchImpl).not.toHaveBeenCalled()
})
