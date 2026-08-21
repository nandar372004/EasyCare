export const PRESENTATION_ONLY = 'Synthetic presentation information — no real service is connected.'

export const invoices = [
  { id: 'DEMO-INV-2045', date: 'Aug 20, 2026', description: 'Video consultation', status: 'Paid (Demo)', amount: '25,000 MMK' },
  { id: 'DEMO-INV-2019', date: 'Jul 28, 2026', description: 'Voice consultation', status: 'Paid (Demo)', amount: '20,000 MMK' },
  { id: 'DEMO-INV-1988', date: 'Jun 18, 2026', description: 'Chat consultation', status: 'Refunded (Demo)', amount: '15,000 MMK' },
]

export const conversations = [
  { id: 'care-coordinator', name: 'EasyCare Care Coordinator', specialty: 'Patient Care Coordination', preview: 'How can I help coordinate your care?', messages: ['Hello, I am your EasyCare care coordinator.', 'I can help with appointments, home visits, and general care coordination.'] },
]

export const facilities = [
  { id: 1, name: 'City Care Hospital', type: 'Hospital', distance: '1.2 km', hours: 'Open 24/7' },
  { id: 2, name: 'Shin Health Clinic', type: 'Clinic', distance: '1.8 km', hours: 'Demo hours: 8 AM–8 PM' },
  { id: 3, name: 'HealthPlus Pharmacy', type: 'Pharmacy', distance: '2.4 km', hours: 'Demo hours: 9 AM–9 PM' },
  { id: 4, name: 'Presentation Lab Centre', type: 'Lab', distance: '3.1 km', hours: 'Demo hours: 8 AM–5 PM' },
]
