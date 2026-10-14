// Presentation copy only. Prices and selectable duration rules come from the
// authoritative Home Care catalog and quote RPC.
export const CARE_PACKAGES = [
  {
    id: 'basic-elderly',
    name: 'Basic Elderly Care',
    description: 'For elderly people who mainly need assistance with everyday activities.',
    includes: [
      'Feeding assistance',
      'Personal hygiene',
      'Mobility assistance',
      'Basic BP/glucose measurement',
      'Medication reminders',
      'Companionship',
    ],
    note: null,
    defaultLevel: 'nurse-aide',
    allowedLevels: ['nurse-aide', 'skilled-nurse-aide'],
  },
  {
    id: 'skilled-elderly',
    name: 'Skilled Elderly Care',
    description: 'For elderly patients requiring more active healthcare support.',
    includes: [
      'Skilled Nurse Aide',
      'BP/glucose monitoring',
      'Medication assistance',
      'Feeding assistance',
      'Mobility support',
      'Catheter-care assistance where appropriate',
      'Follow-up coordination',
    ],
    note: null,
    defaultLevel: 'skilled-nurse-aide',
    allowedLevels: ['skilled-nurse-aide', 'special-nurse'],
  },
  {
    id: 'medical-care',
    name: 'Medical Care',
    description: 'For patients requiring more specialized care.',
    includes: [
      'Stroke care',
      'Tube feeding',
      'Catheter care',
      'Oxygen support',
      'Nebulization support',
      'Suction support',
      'Bedridden care',
      'Vital monitoring',
    ],
    note: 'May require care-needs review before confirmation.',
    defaultLevel: 'special-nurse',
    allowedLevels: ['special-nurse'],
  },
  {
    id: 'post-hospital',
    name: 'Post-Hospital Care',
    description: 'For patients transitioning from hospital to home.',
    includes: [
      'Recovery support',
      'Home care coordination',
      'Medication support',
      'Follow-up coordination',
      'Family updates',
      'Appropriate nursing support',
    ],
    note: null,
    defaultLevel: 'skilled-nurse-aide',
    allowedLevels: ['skilled-nurse-aide', 'special-nurse'],
  },
  {
    id: 'remote-family',
    name: 'Remote Family Care',
    description: 'For families managing a parent\'s care from another city or country.',
    includes: [
      'Care coordination',
      'Appointment coordination',
      'Medication reminders',
      'Health updates',
      'Family Health Dashboard',
      'Doctor coordination',
      'Nurse booking support',
      'Follow-up support',
      'Digital medical records',
    ],
    note: 'Coming Soon / Pricing to be confirmed',
    defaultLevel: null,
    allowedLevels: [],
  },
]

export const CARE_LEVELS = [
  {
    id: 'nurse-aide',
    name: 'Nurse Aide',
    description: 'Trained support for everyday elderly care.',
    includes: ['Feeding', 'Hygiene', 'Mobility', 'Medication reminders', 'Companionship'],
  },
  {
    id: 'skilled-nurse-aide',
    name: 'Skilled Nurse Aide',
    description: 'Experienced support for patients requiring additional healthcare assistance.',
    includes: ['Health monitoring', 'Medication assistance', 'Recovery support', 'Complex daily care'],
    popular: true,
  },
  {
    id: 'special-nurse',
    name: 'Special Nurse',
    description: 'Advanced nursing support for higher-care needs.',
    includes: ['Tube/catheter care', 'Oxygen/nebulization', 'Bedridden care', 'Advanced monitoring'],
  },
]

export function calculateCarePlanPrice(quote) {
  const total = Number(quote?.subtotal || 0)
  return {
    total,
    providerAmount: Number(quote?.provider_amount || 0),
    commission: Number(quote?.commission_amount || 0),
  }
}

export function formatMmk(amount) {
  return `${amount.toLocaleString('en-US')} MMK`
}
