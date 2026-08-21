import { normalizeMyanmarPhone, registrationFormSchema } from '../features/auth/registrationSchema.js'
import { supabase } from '../lib/supabase.js'

export const REGISTRATION_SUCCESS_MESSAGE = 'Registration details validated successfully.'
export const REGISTRATION_COMPLETE_MESSAGE = 'Registration completed securely.'
const REGISTRATION_UNAVAILABLE_MESSAGE = 'Registration is temporarily unavailable. Please try again later.'

async function mapBackendError(error, data) {
  let status = error?.context?.status
  let backendMessage = data?.error

  if (!backendMessage && error?.context?.clone) {
    try {
      const body = await error.context.clone().json()
      backendMessage = body?.error
    } catch {
      // Non-JSON and malformed backend responses remain generic.
    }
  }

  if (status === 400) return 'Please check your registration details, phone number, and password and try again.'
  if (status === 409) return 'An account with this phone number may already exist.'
  if (status === 429 || backendMessage === 'Too many attempts. Please try again later.') {
    return 'Too many registration attempts. Please wait and try again.'
  }
  if (status === 503) return 'Registration service is not configured correctly. Please contact support.'
  if (!status) return 'We could not connect to EasyCare. Check your connection and try again.'
  return REGISTRATION_UNAVAILABLE_MESSAGE
}

function mapValidationErrors(error) {
  return error.issues.reduce((errors, issue) => {
    const field = issue.path[0]
    if (field && !errors[field]) errors[field] = issue.message
    return errors
  }, {})
}

export function submitRegistration(formValues) {
  const parsed = registrationFormSchema.safeParse(formValues)

  if (!parsed.success) {
    const errors = mapValidationErrors(parsed.error)
    return { success: false, errors, firstInvalidField: Object.keys(errors)[0] }
  }

  const data = parsed.data
  const registrationData = {
    account: {
      phoneNumber: normalizeMyanmarPhone(data.phoneNumber),
    },
    profile: {
      fullName: data.fullName,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      addressCity: data.addressCity,
    },
    emergencyContact: {
      name: data.emergencyName,
      relationship: data.emergencyRelationship,
      phoneNumber: normalizeMyanmarPhone(data.emergencyPhoneNumber),
    },
    medicalProfile: {
      bloodType: data.bloodType,
      allergies: data.allergies,
      noKnownAllergies: data.noKnownAllergies,
      existingMedicalConditions: data.existingMedicalConditions,
      currentMedications: data.currentMedications,
    },
    consent: {
      termsAccepted: data.termsAccepted,
      privacyConsent: data.privacyConsent,
    },
  }

  return { success: true, registrationData, message: REGISTRATION_SUCCESS_MESSAGE }
}

export async function registerPatient(formValues, client = supabase) {
  const validation = submitRegistration(formValues)
  if (!validation.success || !client) return validation

  const requestBody = {
    password: formValues.password,
    ...validation.registrationData,
  }

  let response
  try {
    response = await client.functions.invoke('patient-register', {
      body: requestBody,
    })
  } catch {
    return {
      success: false,
      errors: {},
      message: REGISTRATION_UNAVAILABLE_MESSAGE,
    }
  }

  const { data, error } = response

  if (error || !data?.success) {
    return {
      success: false,
      errors: {},
      message: await mapBackendError(error, data),
    }
  }

  return { success: true, message: REGISTRATION_COMPLETE_MESSAGE }
}
