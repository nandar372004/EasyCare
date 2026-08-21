import { z } from 'npm:zod@4.0.17'
import { deriveInternalEmail, normalizeMyanmarPhone } from './phone-identity.ts'

const genderSchema = z.enum(['Male', 'Female', 'Other', 'Prefer not to say'])
const bloodTypeSchema = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'])

export const edgeRegistrationSchema = z.object({
  password: z.string().min(8).regex(/[A-Za-z]/).regex(/\d/),
  account: z.object({
    phoneNumber: z.string().min(1),
    email: z.email().optional(),
  }),
  profile: z.object({
    fullName: z.string().trim().min(1).max(160),
    dateOfBirth: z.iso.date(),
    gender: genderSchema,
    addressCity: z.string().trim().min(1).max(300),
  }),
  emergencyContact: z.object({
    name: z.string().trim().min(1).max(160),
    relationship: z.string().trim().min(1).max(80),
    phoneNumber: z.string().min(1),
  }),
  medicalProfile: z.object({
    bloodType: bloodTypeSchema,
    allergies: z.string().trim().max(1000),
    noKnownAllergies: z.boolean(),
    existingMedicalConditions: z.string().trim().max(2000),
    currentMedications: z.string().trim().max(2000),
  }),
  consent: z.object({
    termsAccepted: z.literal(true),
    privacyConsent: z.literal(true),
  }),
}).superRefine((data, context) => {
  const birthDate = new Date(`${data.profile.dateOfBirth}T00:00:00Z`)
  if (birthDate >= new Date()) {
    context.addIssue({ code: 'custom', path: ['profile', 'dateOfBirth'], message: 'Invalid date' })
  }
  if (!data.medicalProfile.noKnownAllergies && !data.medicalProfile.allergies) {
    context.addIssue({ code: 'custom', path: ['medicalProfile', 'allergies'], message: 'Allergies required' })
  }
})

export type RegistrationDependencies = {
  phoneExists: (phone: string) => Promise<boolean>
  createUser: (email: string, password: string) => Promise<{ id: string }>
  persistPatient: (input: Record<string, unknown>) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  logStage?: (stage: string, details?: Record<string, unknown>) => void
}

export async function executeRegistration(payload: unknown, dependencies: RegistrationDependencies) {
  const parsed = edgeRegistrationSchema.safeParse(payload)
  if (!parsed.success) {
    dependencies.logStage?.('payload_rejected', { issueCount: parsed.error.issues.length })
    return { status: 400, body: { error: 'Unable to register with these details.' } }
  }
  dependencies.logStage?.('payload_validated')

  let phone: string
  let emergencyPhone: string
  try {
    phone = normalizeMyanmarPhone(parsed.data.account.phoneNumber)
    emergencyPhone = normalizeMyanmarPhone(parsed.data.emergencyContact.phoneNumber)
  } catch {
    dependencies.logStage?.('phone_normalization_failed')
    return { status: 400, body: { error: 'Unable to register with these details.' } }
  }
  dependencies.logStage?.('phone_normalized')

  try {
    if (await dependencies.phoneExists(phone)) {
      dependencies.logStage?.('duplicate_phone')
      return { status: 409, body: { error: 'Unable to register with these details.' } }
    }
  } catch {
    dependencies.logStage?.('phone_lookup_failed')
    return { status: 500, body: { error: 'Registration is temporarily unavailable.' } }
  }

  const email = await deriveInternalEmail(phone)
  let user: { id: string }
  try {
    dependencies.logStage?.('auth_create_started')
    user = await dependencies.createUser(email, parsed.data.password)
  } catch {
    dependencies.logStage?.('auth_create_failed')
    return { status: 409, body: { error: 'Unable to register with these details.' } }
  }
  dependencies.logStage?.('auth_create_succeeded')

  try {
    dependencies.logStage?.('persistence_started')
    await dependencies.persistPatient({
      userId: user.id,
      phone,
      email: parsed.data.account.email?.trim().toLowerCase() ?? null,
      fullName: parsed.data.profile.fullName,
      preferredLanguage: 'en',
      dateOfBirth: parsed.data.profile.dateOfBirth,
      gender: parsed.data.profile.gender,
      addressCity: parsed.data.profile.addressCity,
      emergencyContact: {
        name: parsed.data.emergencyContact.name,
        relationship: parsed.data.emergencyContact.relationship,
        phone_number: emergencyPhone,
      },
      medicalProfile: {
        blood_type: parsed.data.medicalProfile.bloodType,
        allergies: parsed.data.medicalProfile.allergies,
        no_known_allergies: parsed.data.medicalProfile.noKnownAllergies,
        existing_medical_conditions: parsed.data.medicalProfile.existingMedicalConditions,
        current_medications: parsed.data.medicalProfile.currentMedications,
      },
      termsAccepted: true,
      privacyConsent: true,
    })
    dependencies.logStage?.('persistence_succeeded')
  } catch {
    dependencies.logStage?.('persistence_failed')
    try {
      await dependencies.deleteUser(user.id)
      dependencies.logStage?.('auth_rollback_succeeded')
    } catch {
      dependencies.logStage?.('auth_rollback_failed')
    }
    return { status: 500, body: { error: 'Registration is temporarily unavailable.' } }
  }

  dependencies.logStage?.('registration_completed')
  return { status: 201, body: { success: true } }
}
