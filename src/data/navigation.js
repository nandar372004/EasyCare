export const primaryNavigation = [
  { to: '/dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: 'LayoutDashboard', group: 'dashboard' },
  { to: '/doctors', label: 'Book Care', labelKey: 'nav.doctors', icon: 'Stethoscope', group: 'care' },
  { to: '/appointments', label: 'Appointments', labelKey: 'nav.appointments', icon: 'CalendarDays', group: 'care' },
  { to: '/care-plan', label: 'Care Plan', labelKey: 'nav.carePlan', icon: 'ClipboardList', group: 'care' },
  { to: '/health-guardian', label: 'AI Health Guardian', labelKey: 'nav.guardian', icon: 'Bot', group: 'care' },
  { to: '/health-records', label: 'Health Records', labelKey: 'nav.healthRecords', icon: 'HeartPulse', group: 'health' },
  { to: '/prescriptions', label: 'Prescriptions', labelKey: 'nav.prescriptions', icon: 'ClipboardList', group: 'health' },
  { to: '/medications', label: 'Medications', labelKey: 'nav.medications', icon: 'Pill', group: 'health' },
  { to: '/messages', label: 'Messages', labelKey: 'nav.messages', icon: 'MessageSquare', group: 'support' },
  { to: '/location', label: 'Location & SOS', labelKey: 'nav.location', icon: 'MapPin', group: 'support' },
  { to: '/payments', label: 'Online Payment', labelKey: 'nav.payments', icon: 'CreditCard', group: 'support' },
  { to: '/subscription', label: 'Subscription', labelKey: 'nav.subscription', icon: 'CreditCard', group: 'support' },
  { to: '/settings', label: 'Settings', labelKey: 'nav.settings', icon: 'Settings', group: 'support' },
]

const keys = { '/dashboard':'nav.dashboard','/health-guardian':'nav.guardian','/doctors':'nav.doctors','/appointments':'nav.appointments','/care-plan':'nav.carePlan','/health-records':'nav.healthRecords','/prescriptions':'nav.prescriptions','/lab-results':'nav.labResults','/medications':'nav.medications','/subscription':'nav.subscription','/payments':'nav.payments','/messages':'nav.messages','/location':'nav.location','/settings':'nav.settings' }
primaryNavigation.forEach((item) => { item.labelKey ||= keys[item.to] })
