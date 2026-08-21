import { z } from 'zod'

export const genderOptions = ['Male', 'Female', 'Other', 'Prefer not to say']
export const bloodTypeOptions = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

export function normalizeMyanmarPhone(value) {
  const compact = value.trim().replace(/[\s-]/g, '')
  if (!isValidMyanmarPhone(compact)) throw new Error('Invalid Myanmar phone number')
  if (compact.startsWith('+959')) return compact
  if (compact.startsWith('00959')) return `+${compact.slice(2)}`
  if (compact.startsWith('959')) return `+${compact}`
  return `+95${compact.slice(1)}`
}

function isValidMyanmarPhone(value) {
  return /^(?:\+?95|0095|0)9\d{7,9}$/.test(value.trim().replace(/[\s-]/g, ''))
}

function isValidPastDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

const requiredText = (message) => z.string().trim().min(1, message)
const phone = z.string().trim().min(1, 'Phone number is required').refine(isValidMyanmarPhone, 'Enter a valid Myanmar phone number')
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must include at least one letter')
  .regex(/\d/, 'Password must include at least one number')

export const registrationFormSchema = z.object({
  phoneNumber: phone,
  password: passwordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  fullName: requiredText('Full name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required').refine(isValidPastDate, 'Enter a valid past date'),
  gender: z.enum(genderOptions, { message: 'Gender is required' }),
  addressCity: requiredText('Address or city is required'),
  emergencyName: requiredText('Emergency contact name is required'),
  emergencyRelationship: requiredText('Relationship is required'),
  emergencyPhoneNumber: phone,
  bloodType: z.enum(bloodTypeOptions, { message: 'Blood type is required' }),
  allergies: z.string().trim(),
  noKnownAllergies: z.boolean(),
  existingMedicalConditions: z.string().trim(),
  currentMedications: z.string().trim(),
  termsAccepted: z.boolean().refine(Boolean, 'You must accept the Terms and Conditions'),
  privacyConsent: z.boolean().refine(Boolean, 'You must accept the Privacy Policy and information handling'),
}).superRefine((data, context) => {
  if (data.password !== data.confirmPassword) {
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords must match' })
  }
  if (!data.noKnownAllergies && !data.allergies) {
    context.addIssue({ code: 'custom', path: ['allergies'], message: 'List allergies or select “No known allergies”' })
  }
})
