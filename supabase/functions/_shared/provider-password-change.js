import { ADMIN_PROVIDER_TYPES, validateInitialPassword } from './admin-provider-management.js'

export async function changeProviderInitialPassword({ userClient, admin, userId, newPassword }) {
  if (!validateInitialPassword(newPassword)) return { status: 400, body: { error: 'INVALID_PASSWORD' } }
  const { data, error } = await userClient.rpc('get_my_provider_setup_identity')
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null
  if (error || row?.profile_role !== 'provider' || row?.provider_id == null
    || !ADMIN_PROVIDER_TYPES.includes(row.provider_type)
    || !['invited', 'active'].includes(row.account_status) || row.setup_state !== 'setup_required') {
    return { status: 403, body: { error: 'PROVIDER_SETUP_REQUIRED' } }
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (passwordError) return { status: 400, body: { error: 'PASSWORD_UPDATE_FAILED' } }

  const { data: setupState, error: stateError } = await admin.rpc('complete_provider_initial_password_change', { p_profile_id: userId })
  if (stateError || setupState !== 'profile_incomplete') return { status: 500, body: { error: 'PROVIDER_SETUP_UNAVAILABLE' } }
  return { status: 200, body: { setup_state: setupState } }
}
