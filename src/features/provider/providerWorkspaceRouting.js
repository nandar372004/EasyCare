export function getProviderWorkspacePath(type) {
  if (type === 'nurse') return '/provider/nurse'
  if (['nurse_aide', 'skilled_nurse_aide', 'special_nurse'].includes(type)) return '/provider/nurse-aide'
  if (type === 'caregiver') return '/provider/caregiver'
  return '/provider'
}
