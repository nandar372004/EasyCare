export const PRESENTATION_TIME_ZONE = 'Asia/Yangon'
export const PRESENTATION_DATA_NOTICE = 'Synthetic presentation data — not real patient, clinical, payment, or location information.'

const baseline = {
  patient: {
    id: 'patient-demo-001',
    profileId: 'profile-demo-patient-001',
    memberCode: 'ECP-DEMO-001',
    displayName: 'EasyCare Demo Patient',
    preferredLanguage: 'my',
    isSynthetic: true,
  },
  hospitals: [
    { id: 'hospital-demo-001', name: 'EasyCare Demonstration Hospital', cityLabel: 'Synthetic Central District', isSynthetic: true },
    { id: 'hospital-demo-002', name: 'Blue Sky Presentation Clinic', cityLabel: 'Synthetic East District', isSynthetic: true },
  ],
  doctors: [
    { id: 'doctor-demo-001', profileId: 'profile-demo-doctor-001', hospitalId: 'hospital-demo-001', displayName: 'Dr. Demo Aster', specialty: 'General Medicine', qualification: 'Synthetic MBBS, Presentation MMed', experienceYears: 10, rating: 4.8, consultationFeeMmk: 25000, languages: ['my', 'en'], consultationTypes: ['video', 'voice', 'chat', 'home_visit'], isSynthetic: true },
    { id: 'doctor-demo-002', profileId: 'profile-demo-doctor-002', hospitalId: 'hospital-demo-001', displayName: 'Dr. Demo Cedar', specialty: 'Paediatrics', qualification: 'Synthetic MBBS, Presentation DCH', experienceYears: 12, rating: 4.7, consultationFeeMmk: 30000, languages: ['my'], consultationTypes: ['video', 'voice', 'home_visit'], isSynthetic: true },
    { id: 'doctor-demo-003', profileId: 'profile-demo-doctor-003', hospitalId: 'hospital-demo-002', displayName: 'Dr. Demo Lotus', specialty: 'Dermatology', qualification: 'Synthetic MBBS, Presentation MSc', experienceYears: 8, rating: 4.9, consultationFeeMmk: 35000, languages: ['my', 'en'], consultationTypes: ['video', 'chat'], isSynthetic: true },
    { id: 'doctor-demo-004', profileId: 'profile-demo-doctor-004', hospitalId: 'hospital-demo-002', displayName: 'Dr. Demo Maple', specialty: 'Cardiology', qualification: 'Synthetic MBBS, Presentation MRCP', experienceYears: 15, rating: 4.6, consultationFeeMmk: 45000, languages: ['en'], consultationTypes: ['video', 'voice'], isSynthetic: true },
  ],
  availabilitySlots: [
    { id: 'slot-demo-001', doctorId: 'doctor-demo-001', startsAt: '2026-08-20T02:30:00.000Z', endsAt: '2026-08-20T03:00:00.000Z', consultationType: 'video', status: 'available' },
    { id: 'slot-demo-002', doctorId: 'doctor-demo-002', startsAt: '2026-08-21T05:00:00.000Z', endsAt: '2026-08-21T05:30:00.000Z', consultationType: 'voice', status: 'available' },
    { id: 'slot-demo-003', doctorId: 'doctor-demo-003', startsAt: '2026-08-22T08:00:00.000Z', endsAt: '2026-08-22T08:30:00.000Z', consultationType: 'chat', status: 'available' },
    { id: 'slot-demo-004', doctorId: 'doctor-demo-001', startsAt: '2026-08-18T03:30:00.000Z', endsAt: '2026-08-18T04:00:00.000Z', consultationType: 'video', status: 'booked' },
    { id: 'slot-demo-005', doctorId: 'doctor-demo-001', startsAt: '2026-08-20T04:00:00.000Z', endsAt: '2026-08-20T04:30:00.000Z', consultationType: 'voice', status: 'available' },
    { id: 'slot-demo-006', doctorId: 'doctor-demo-001', startsAt: '2026-08-20T05:00:00.000Z', endsAt: '2026-08-20T05:30:00.000Z', consultationType: 'chat', status: 'available' },
    { id: 'slot-demo-007', doctorId: 'doctor-demo-001', startsAt: '2026-08-23T02:30:00.000Z', endsAt: '2026-08-23T03:30:00.000Z', consultationType: 'home_visit', status: 'available' },
    { id: 'slot-demo-008', doctorId: 'doctor-demo-002', startsAt: '2026-08-24T03:00:00.000Z', endsAt: '2026-08-24T04:00:00.000Z', consultationType: 'home_visit', status: 'available' },
    { id: 'slot-demo-009', doctorId: 'doctor-demo-003', startsAt: '2026-08-25T02:00:00.000Z', endsAt: '2026-08-25T02:30:00.000Z', consultationType: 'video', status: 'available' },
    { id: 'slot-demo-010', doctorId: 'doctor-demo-004', startsAt: '2026-08-26T04:30:00.000Z', endsAt: '2026-08-26T05:00:00.000Z', consultationType: 'video', status: 'available' },
  ],
  appointments: [
    { id: 'appointment-demo-upcoming-001', bookingCode: 'ECA-DEMO-UP01', patientId: 'patient-demo-001', doctorId: 'doctor-demo-001', slotId: 'slot-demo-004', scheduledAt: '2026-08-18T03:30:00.000Z', consultationType: 'video', status: 'confirmed', feeMmk: 25000, isSynthetic: true },
    { id: 'appointment-demo-completed-001', bookingCode: 'ECA-DEMO-CO01', patientId: 'patient-demo-001', doctorId: 'doctor-demo-003', slotId: null, scheduledAt: '2026-07-12T04:00:00.000Z', consultationType: 'chat', status: 'completed', feeMmk: 35000, isSynthetic: true },
    { id: 'appointment-demo-cancelled-001', bookingCode: 'ECA-DEMO-CA01', patientId: 'patient-demo-001', doctorId: 'doctor-demo-002', slotId: null, scheduledAt: '2026-07-28T06:00:00.000Z', consultationType: 'voice', status: 'cancelled', feeMmk: 30000, isSynthetic: true },
  ],
  appointmentEvents: [
    { id: 'event-demo-001', appointmentId: 'appointment-demo-upcoming-001', eventType: 'appointment_created', fromStatus: null, toStatus: 'confirmed', createdAt: '2026-08-10T02:00:00.000Z' },
    { id: 'event-demo-002', appointmentId: 'appointment-demo-completed-001', eventType: 'appointment_created', fromStatus: null, toStatus: 'confirmed', createdAt: '2026-07-10T02:00:00.000Z' },
    { id: 'event-demo-003', appointmentId: 'appointment-demo-completed-001', eventType: 'status_changed', fromStatus: 'confirmed', toStatus: 'completed', createdAt: '2026-07-12T04:30:00.000Z' },
    { id: 'event-demo-004', appointmentId: 'appointment-demo-cancelled-001', eventType: 'appointment_cancelled', fromStatus: 'confirmed', toStatus: 'cancelled', createdAt: '2026-07-27T06:00:00.000Z' },
  ],
  healthSummary: {
    id: 'health-summary-demo-001', patientId: 'patient-demo-001', bloodType: 'Unknown', allergies: ['No known allergies — synthetic'], conditions: ['No presentation conditions recorded'], lastUpdatedAt: '2026-08-01T02:00:00.000Z', readOnly: true, isSynthetic: true,
  },
  medications: [
    { id: 'medication-demo-001', patientId: 'patient-demo-001', name: 'Demo Medication Alpha', instructions: 'Presentation-only example; not medical advice.', status: 'active', readOnly: true, isSynthetic: true },
    { id: 'medication-demo-002', patientId: 'patient-demo-001', name: 'Demo Medication Beta', instructions: 'Presentation-only example; not for consumption.', status: 'completed', readOnly: true, isSynthetic: true },
  ],
  prescriptions: [
    { id: 'prescription-demo-001', patientId: 'patient-demo-001', doctorId: 'doctor-demo-003', appointmentId: 'appointment-demo-completed-001', medicationIds: ['medication-demo-002'], issuedAt: '2026-07-12T04:30:00.000Z', readOnly: true, isSynthetic: true },
  ],
  labResults: [
    { id: 'lab-demo-001', patientId: 'patient-demo-001', appointmentId: 'appointment-demo-completed-001', testName: 'Synthetic Wellness Panel', resultSummary: 'Presentation result within synthetic reference range.', observedAt: '2026-07-13T03:00:00.000Z', readOnly: true, isSynthetic: true },
  ],
  messages: [
    { id: 'message-demo-001', patientId: 'patient-demo-001', doctorId: 'doctor-demo-001', appointmentId: 'appointment-demo-upcoming-001', senderType: 'provider', body: 'Synthetic appointment reminder for the presentation.', sentAt: '2026-08-16T02:00:00.000Z', isSynthetic: true },
    { id: 'message-demo-002', patientId: 'patient-demo-001', doctorId: 'doctor-demo-003', appointmentId: 'appointment-demo-completed-001', senderType: 'patient', body: 'Synthetic follow-up acknowledgement.', sentAt: '2026-07-12T05:00:00.000Z', isSynthetic: true },
  ],
  invoices: [
    { id: 'invoice-demo-001', patientId: 'patient-demo-001', appointmentId: 'appointment-demo-completed-001', amountMmk: 35000, status: 'paid_simulation', paymentReference: 'DEMO-NO-TRANSACTION', issuedAt: '2026-07-12T04:35:00.000Z', isSynthetic: true },
    { id: 'invoice-demo-002', patientId: 'patient-demo-001', appointmentId: 'appointment-demo-upcoming-001', amountMmk: 25000, status: 'not_due_demo', paymentReference: null, issuedAt: '2026-08-10T02:00:00.000Z', isSynthetic: true },
  ],
  nearbyFacilities: [
    { id: 'facility-demo-001', name: 'EasyCare Synthetic Urgent Point', facilityType: 'clinic', relativeArea: 'Demo Zone A', distanceKm: 1.2, isSynthetic: true },
    { id: 'facility-demo-002', name: 'Presentation Community Pharmacy', facilityType: 'pharmacy', relativeArea: 'Demo Zone B', distanceKm: 2.4, isSynthetic: true },
    { id: 'facility-demo-003', name: 'Blue Marker Demo Hospital', facilityType: 'hospital', relativeArea: 'Demo Zone C', distanceKm: 4.1, isSynthetic: true },
  ],
}

export function createPresentationFixtures() {
  return structuredClone(baseline)
}
