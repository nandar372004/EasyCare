// Presentation-only Family Health appointment sample. No appointment repository,
// API, scheduler, or patient-history source consumes this configuration.
// There is no canonical Shwe Hnin San ID in the checked-in app data, so target
// resolution requires the scoped family membership identity plus exact name and
// relationship. If stable IDs become available, add them here as additional checks.
export const SHWE_HNIN_SAN_FAMILY_APPOINTMENT = Object.freeze({
  target: Object.freeze({ displayName: 'Shwe Hnin San', relationship: 'mother' }),
  appointment: Object.freeze({
    id: 'b60ae0e4-1405-4430-ba33-7603cf87ff0a',
    doctor: Object.freeze({ id: 'presentation-dr-su-myat-noe', displayName: 'Dr. Su Myat Noe', specialty: 'Pediatrics', rating: 4.9 }),
    scheduledAt: '2026-10-20T02:30:00.000Z',
    scheduledEnd: '2026-10-20T03:00:00.000Z',
    appointmentType: 'teleconsultation',
    consultationType: 'video',
    status: 'pending',
    dateLabel: 'Tue, Oct 20, 2026',
    timeLabel: '09:00 AM',
    dateBadge: Object.freeze({ month: 'OCT', day: '20', weekday: 'Tue' }),
    isPresentationSample: true,
    detailsButtonLabel: 'View Appointment',
    hideDetailsButtonLabel: 'Hide Appointment',
  }),
})

export const KYAW_AUNG_MOE_FAMILY_APPOINTMENT = Object.freeze({
  target: Object.freeze({ displayName: 'Kyaw Aung Moe', relationship: 'father' }),
  appointment: Object.freeze({
    id: 'e4195430-d6bb-475b-bd3b-354d7439a995',
    doctor: Object.freeze({ id: 'presentation-dr-ei-mon-hlaing', displayName: 'Dr. Ei Mon Hlaing', specialty: 'Dermatology', rating: 4.7 }),
    scheduledAt: '2026-10-20T04:30:00.000Z',
    scheduledEnd: '2026-10-20T05:00:00.000Z',
    appointmentType: 'teleconsultation',
    consultationType: 'video',
    status: 'pending',
    dateLabel: 'Tue, Oct 20, 2026',
    timeLabel: '11:00 AM',
    feeMmk: 0,
    bookingCode: 'MBA-3667FFB290',
    detailsButtonLabel: 'View Details',
    hideDetailsButtonLabel: 'Hide Details',
    isPresentationSample: true,
  }),
})

export const FAMILY_HEALTH_APPOINTMENT_SAMPLES = Object.freeze([
  SHWE_HNIN_SAN_FAMILY_APPOINTMENT,
  KYAW_AUNG_MOE_FAMILY_APPOINTMENT,
])

function isPresentationFamilyMember(member, sample) {
  return Boolean(member?.member_id && member?.patient_id && !member.is_self
    && typeof member.display_name === 'string'
    && member.display_name.trim().toLocaleLowerCase() === sample.target.displayName.toLocaleLowerCase()
    && member.relationship?.trim().toLocaleLowerCase() === sample.target.relationship)
}

export function getFamilyPresentationAppointmentForMember(member) {
  return FAMILY_HEALTH_APPOINTMENT_SAMPLES.find(sample => isPresentationFamilyMember(member, sample)) || null
}

export function getFamilyPresentationAppointmentById(id) {
  return FAMILY_HEALTH_APPOINTMENT_SAMPLES.find(sample => sample.appointment.id === id)?.appointment || null
}

export function isShweHninSanFamilyMember(member) {
  return isPresentationFamilyMember(member, SHWE_HNIN_SAN_FAMILY_APPOINTMENT)
}
