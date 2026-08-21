export const PRESENTATION_ONLY = 'Synthetic presentation information — no real service is connected.'

export const invoices = [
  { id: 'DEMO-INV-2045', date: 'Aug 20, 2026', description: 'Video consultation', status: 'Paid (Demo)', amount: '25,000 MMK' },
  { id: 'DEMO-INV-2019', date: 'Jul 28, 2026', description: 'Voice consultation', status: 'Paid (Demo)', amount: '20,000 MMK' },
  { id: 'DEMO-INV-1988', date: 'Jun 18, 2026', description: 'Chat consultation', status: 'Refunded (Demo)', amount: '15,000 MMK' },
]

export const conversations = [
  { id: 'thiri', name: 'Dr. Thiri Nyein', specialty: 'General Medicine', preview: 'Thank you for the update.', messages: ['Hello. This is a synthetic conversation for presentation.', 'Thank you for the update. No real doctor received this message.'] },
  { id: 'aung', name: 'Dr. Aung Min', specialty: 'Cardiology', preview: 'Your presentation appointment is listed.', messages: ['Your presentation appointment is listed in the app.'] },
  { id: 'support', name: 'EasyCare Demo Support', specialty: 'Presentation support', preview: 'How can the demo help?', messages: ['This channel is synthetic and is not monitored.'] },
]

export const facilities = [
  { id: 1, name: 'City Care Hospital', type: 'Hospital', distance: '1.2 km', hours: 'Open 24/7' },
  { id: 2, name: 'Shin Health Clinic', type: 'Clinic', distance: '1.8 km', hours: 'Demo hours: 8 AM–8 PM' },
  { id: 3, name: 'HealthPlus Pharmacy', type: 'Pharmacy', distance: '2.4 km', hours: 'Demo hours: 9 AM–9 PM' },
  { id: 4, name: 'Presentation Lab Centre', type: 'Lab', distance: '3.1 km', hours: 'Demo hours: 8 AM–5 PM' },
]
