export const HEALTH_PRESENTATION_NOTICE = 'Synthetic presentation information — not real medical data.'

export const healthOverview = {
  bloodType: 'Unknown', allergies: ['No known allergies (synthetic)'], conditions: ['No presentation conditions recorded'], lastCheckup: '2026-07-15T03:30:00.000Z',
}

export const healthRecords = [
  { id: 'record-1', type: 'Allergy', title: 'Synthetic pollen sensitivity', date: '2026-07-15T03:30:00.000Z', source: 'Presentation Clinic', detail: 'Demonstration-only allergy entry. This is not a diagnosis.' },
  { id: 'record-2', type: 'Condition', title: 'No active presentation condition', date: '2026-06-20T04:00:00.000Z', source: 'Presentation Clinic', detail: 'No synthetic active condition was recorded for this demonstration.' },
  { id: 'record-3', type: 'Vaccination', title: 'Example immunization record', date: '2026-05-10T02:00:00.000Z', source: 'EasyCare Demo Center', detail: 'Example timeline entry only; it is not an immunization certificate.' },
  { id: 'record-4', type: 'Document', title: 'Synthetic wellness note', date: '2026-04-28T05:00:00.000Z', source: 'Presentation Archive', detail: 'Read-only demonstration note. Uploads are not supported.' },
]

export const presentationMedications = [
  { id: 'med-1', name: 'Demo Medication Alpha', dosage: '1 tablet', schedule: 'Morning · 8:00 AM', instructions: 'Presentation-only example; not medical advice.', status: 'active', stock: 'Demo stock' },
  { id: 'med-2', name: 'Demo Vitamin Beta', dosage: '1 capsule', schedule: 'Noon · 1:00 PM', instructions: 'Synthetic schedule for interface demonstration.', status: 'active', stock: 'Demo stock' },
  { id: 'med-3', name: 'Demo Medication Gamma', dosage: '1 tablet', schedule: 'Evening · 8:00 PM', instructions: 'Do not use this example as treatment guidance.', status: 'active', stock: 'Demo low stock' },
  { id: 'med-4', name: 'Archived Demo Medicine', dosage: 'Example only', schedule: 'No current schedule', instructions: 'Synthetic historical entry.', status: 'completed', stock: 'Not applicable' },
]

export const presentationPrescriptions = [
  { id: 'rx-1', medicine: 'Demo Medication Alpha 500mg', doctor: 'Dr. Demo Aster', issuedAt: '2026-07-12T04:30:00.000Z', dosage: '1 tablet', frequency: 'Twice daily', duration: '7 days', status: 'active', instructions: 'Synthetic instructions; not for consumption.' },
  { id: 'rx-2', medicine: 'Demo Antihistamine 10mg', doctor: 'Dr. Demo Lotus', issuedAt: '2026-06-10T03:00:00.000Z', dosage: '1 tablet', frequency: 'Once daily', duration: '14 days', status: 'past', instructions: 'Presentation example only; not a clinical order.' },
  { id: 'rx-3', medicine: 'Demo Paediatric Formula', doctor: 'Dr. Demo Cedar', issuedAt: '2026-05-02T03:00:00.000Z', dosage: 'Example dose', frequency: 'Example schedule', duration: '5 days', status: 'past', instructions: 'Synthetic historical prescription entry.' },
]

export const presentationLabResults = [
  { id: 'lab-1', test: 'Synthetic Wellness Panel', date: '2026-07-13T03:00:00.000Z', lab: 'EasyCare Demo Lab', status: 'Presentation normal', summary: 'Values are fabricated for UI presentation and have no clinical meaning.' },
  { id: 'lab-2', test: 'Example Lipid Profile', date: '2026-06-15T03:00:00.000Z', lab: 'Presentation Lab', status: 'Demo flag', summary: 'Synthetic result requiring clinician interpretation in any real clinical context.' },
  { id: 'lab-3', test: 'Example Blood Glucose', date: '2026-05-20T03:00:00.000Z', lab: 'EasyCare Demo Lab', status: 'Presentation normal', summary: 'No real specimen was collected or analyzed.' },
]
