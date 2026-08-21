import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { registerPatient, submitRegistration } from '../../services/registrationService.js'

const initialValues = {
  phoneNumber: '',
  password: '',
  confirmPassword: '',
  fullName: '',
  dateOfBirth: '',
  gender: '',
  addressCity: '',
  emergencyName: '',
  emergencyRelationship: '',
  emergencyPhoneNumber: '',
  bloodType: '',
  allergies: '',
  noKnownAllergies: false,
  existingMedicalConditions: '',
  currentMedications: '',
  termsAccepted: false,
  privacyConsent: false,
}

const genderOptions = ['Male', 'Female', 'Other', 'Prefer not to say']
const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']

function FieldError({ id, message }) {
  return message ? <span className="field-error" id={id} role="alert">{message}</span> : null
}

function FormField({ label, name, error, hint, className = '', children }) {
  return (
    <div className={`form-field ${className}`.trim()}>
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && !error && <span className="field-hint" id={`${name}-hint`}>{hint}</span>}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  )
}

export function RegisterPage() {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const auth = useAuth()

  function updateValue(event) {
    const { name, type, checked, value } = event.target
    const nextValue = type === 'checkbox' ? checked : value

    setValues((current) => ({
      ...current,
      [name]: nextValue,
      ...(name === 'noKnownAllergies' && checked ? { allergies: '' } : {}),
    }))
    setErrors((current) => ({ ...current, [name]: undefined }))
    setErrorMessage('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setErrorMessage('')
    setIsSubmitting(true)

    const result = auth.isPrototypeMode
      ? submitRegistration(values)
      : await registerPatient(values)
    if (!result.success) {
      const nextErrors = result.errors ?? {}
      setErrors(nextErrors)
      setErrorMessage(result.message ?? '')
      setIsSubmitting(false)

      if (result.firstInvalidField) {
        requestAnimationFrame(() => {
          document.querySelector(`[name="${result.firstInvalidField}"]`)?.focus()
        })
      }
      return
    }

    try {
      if (auth.isPrototypeMode) auth.registerPrototype(values.fullName)
      else await auth.signIn({ phoneNumber: values.phoneNumber, password: values.password })
      setValues((current) => ({ ...current, password: '', confirmPassword: '' }))
      navigate('/dashboard', { replace: true })
    } catch {
      setErrorMessage('Your account was created, but automatic sign-in failed. Please sign in with your phone number and password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const describedBy = (name, includeHint = false) => {
    const ids = []
    if (includeHint) ids.push(`${name}-hint`)
    if (errors[name]) ids.push(`${name}-error`)
    return ids.length ? ids.join(' ') : undefined
  }

  return (
    <div className="registration-card card">
      <header className="registration-header">
        <span className="eyebrow">Patient registration</span>
        <h2>Create your patient profile</h2>
        <p>Enter your details, then continue to your EasyCare dashboard.</p>
      </header>

      {errorMessage && <div className="error-message" role="alert">{errorMessage}</div>}

      <form className="registration-form" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend><span>1</span>Account Information</legend>
          <div className="form-grid">
            <FormField label="Phone Number" name="phoneNumber" error={errors.phoneNumber} hint="Myanmar formats such as 09 123 456 789 or +95 9 123 456 789">
              <input className="form-control" id="phoneNumber" name="phoneNumber" type="tel" inputMode="tel" autoComplete="tel" value={values.phoneNumber} onChange={updateValue} aria-invalid={Boolean(errors.phoneNumber)} aria-describedby={describedBy('phoneNumber', true)} />
            </FormField>
            <div className="form-field-spacer" aria-hidden="true" />
            <FormField label="Password" name="password" error={errors.password} hint="At least 8 characters with a letter and a number">
              <div className="password-control">
                <input className="form-control" id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={values.password} onChange={updateValue} aria-invalid={Boolean(errors.password)} aria-describedby={describedBy('password', true)} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
            </FormField>
            <FormField label="Confirm Password" name="confirmPassword" error={errors.confirmPassword}>
              <div className="password-control">
                <input className="form-control" id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={values.confirmPassword} onChange={updateValue} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={describedBy('confirmPassword')} />
                <button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}>{showConfirmPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>2</span>Personal Information</legend>
          <div className="form-grid">
            <FormField label="Full Name" name="fullName" error={errors.fullName}>
              <input className="form-control" id="fullName" name="fullName" type="text" autoComplete="name" maxLength="160" value={values.fullName} onChange={updateValue} aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy('fullName')} />
            </FormField>
            <FormField label="Date of Birth" name="dateOfBirth" error={errors.dateOfBirth}>
              <input className="form-control" id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={values.dateOfBirth} onChange={updateValue} aria-invalid={Boolean(errors.dateOfBirth)} aria-describedby={describedBy('dateOfBirth')} />
            </FormField>
            <FormField label="Gender" name="gender" error={errors.gender}>
              <select className="form-control" id="gender" name="gender" value={values.gender} onChange={updateValue} aria-invalid={Boolean(errors.gender)} aria-describedby={describedBy('gender')}>
                <option value="">Select gender</option>
                {genderOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <FormField label="Address / City" name="addressCity" error={errors.addressCity}>
              <input className="form-control" id="addressCity" name="addressCity" type="text" autoComplete="address-level2" maxLength="300" value={values.addressCity} onChange={updateValue} aria-invalid={Boolean(errors.addressCity)} aria-describedby={describedBy('addressCity')} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>3</span>Emergency Contact</legend>
          <div className="form-grid">
            <FormField label="Contact Person Name" name="emergencyName" error={errors.emergencyName}>
              <input className="form-control" id="emergencyName" name="emergencyName" type="text" autoComplete="off" maxLength="160" value={values.emergencyName} onChange={updateValue} aria-invalid={Boolean(errors.emergencyName)} aria-describedby={describedBy('emergencyName')} />
            </FormField>
            <FormField label="Relationship" name="emergencyRelationship" error={errors.emergencyRelationship}>
              <input className="form-control" id="emergencyRelationship" name="emergencyRelationship" type="text" autoComplete="off" maxLength="80" value={values.emergencyRelationship} onChange={updateValue} aria-invalid={Boolean(errors.emergencyRelationship)} aria-describedby={describedBy('emergencyRelationship')} />
            </FormField>
            <FormField label="Emergency Phone Number" name="emergencyPhoneNumber" error={errors.emergencyPhoneNumber}>
              <input className="form-control" id="emergencyPhoneNumber" name="emergencyPhoneNumber" type="tel" inputMode="tel" autoComplete="off" value={values.emergencyPhoneNumber} onChange={updateValue} aria-invalid={Boolean(errors.emergencyPhoneNumber)} aria-describedby={describedBy('emergencyPhoneNumber')} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>4</span>Medical Profile</legend>
          <div className="form-grid">
            <FormField label="Blood Type" name="bloodType" error={errors.bloodType}>
              <select className="form-control" id="bloodType" name="bloodType" value={values.bloodType} onChange={updateValue} aria-invalid={Boolean(errors.bloodType)} aria-describedby={describedBy('bloodType')}>
                <option value="">Select blood type</option>
                {bloodTypes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </FormField>
            <div className="form-field checkbox-field allergy-checkbox">
              <label><input name="noKnownAllergies" type="checkbox" checked={values.noKnownAllergies} onChange={updateValue} />No known allergies</label>
            </div>
            <FormField label="Allergies" name="allergies" error={errors.allergies} className="form-field--wide">
              <textarea className="form-control" id="allergies" name="allergies" rows="3" maxLength="1000" disabled={values.noKnownAllergies} value={values.allergies} onChange={updateValue} aria-invalid={Boolean(errors.allergies)} aria-describedby={describedBy('allergies')} />
            </FormField>
            <FormField label="Existing Medical Conditions (optional)" name="existingMedicalConditions" error={errors.existingMedicalConditions}>
              <textarea className="form-control" id="existingMedicalConditions" name="existingMedicalConditions" rows="3" maxLength="2000" value={values.existingMedicalConditions} onChange={updateValue} />
            </FormField>
            <FormField label="Current Medications (optional)" name="currentMedications" error={errors.currentMedications}>
              <textarea className="form-control" id="currentMedications" name="currentMedications" rows="3" maxLength="2000" value={values.currentMedications} onChange={updateValue} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>5</span>Consent</legend>
          <div className="consent-list">
            <div className="checkbox-field">
              <label><input name="termsAccepted" type="checkbox" checked={values.termsAccepted} onChange={updateValue} aria-invalid={Boolean(errors.termsAccepted)} aria-describedby={describedBy('termsAccepted')} />I accept the Terms and Conditions.</label>
              <FieldError id="termsAccepted-error" message={errors.termsAccepted} />
            </div>
            <div className="checkbox-field">
              <label><input name="privacyConsent" type="checkbox" checked={values.privacyConsent} onChange={updateValue} aria-invalid={Boolean(errors.privacyConsent)} aria-describedby={describedBy('privacyConsent')} />I accept the Privacy Policy and consent to information handling.</label>
              <FieldError id="privacyConsent-error" message={errors.privacyConsent} />
            </div>
          </div>
        </fieldset>

        <button className="button button--primary registration-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Creating Account…' : 'Create Patient Account'}</button>
      </form>
      <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  )
}
