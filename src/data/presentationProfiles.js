// Existing presentation patient mapping from seed-staging-nandar-cervical-care.sql.
// This is a patient record ID, never an authentication UUID. Names alone do not
// enable presentation behavior. Ownership follows loadAuthorizedPatient's
// auth_user_id mapping, rather than matching a display label or build URL.
export function hasCervicalPresentationProfile(patient, user) {
  return patient?.id === '2d329d5b-9093-45ca-a980-97466d2a71eb'
    && Boolean(user?.id) && patient.auth_user_id === user.id
}
