export const PROVIDER_TYPE_LABELS = Object.freeze({
  doctor: 'Doctor',
  nurse: 'Nurse',
  nurse_aide: 'Nurse Aide',
  skilled_nurse_aide: 'Skilled Nurse Aide',
  special_nurse: 'Special Nurse',
  caregiver: 'Caregiver',
})

export function getProviderTypeLabel(providerType) {
  return PROVIDER_TYPE_LABELS[providerType] || 'Healthcare Provider'
}
