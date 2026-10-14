import { getProviderWorkspacePath } from './providerWorkspaceRouting.js'
import { PROVIDER_SETUP_TYPES } from '../../services/providerSetupService.js'

export function getProviderSetupRedirect(providerType) {
  return PROVIDER_SETUP_TYPES.includes(providerType) ? getProviderWorkspacePath(providerType) : null
}

export function validateProviderPassword(password, confirmation) {
  const errors = {}
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) errors.password = 'Use 12 to 128 characters.'
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) errors.password = 'Include at least one letter and one number.'
  if (password !== confirmation) errors.confirmation = 'Passwords do not match.'
  return errors
}
