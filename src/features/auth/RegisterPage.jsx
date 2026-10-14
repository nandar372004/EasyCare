import { useRegisterTranslation } from './useRegisterTranslation.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import './registerLocalization.css'
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
  termsAccepted: false,
  privacyConsent: false,
}

function RegisterLanguageSwitch() {
  const localization = useOptionalLocalization()
  if (!localization) return null
  return <div className="registration-language" role="group" aria-label="Myanmar | English">
    <button type="button" lang="my" aria-label="Myanmar" aria-pressed={localization.language === 'my'} onClick={() => localization.setLanguage('my')}>မြန်မာ</button>
    <span aria-hidden="true">|</span>
    <button type="button" lang="en" aria-pressed={localization.language === 'en'} onClick={() => localization.setLanguage('en')}>English</button>
  </div>
}


function FieldError({ id, message }) {
  const t = useRegisterTranslation()
  return message ? <span className="field-error" id={id} role="alert">{t(message)}</span> : null
}

function FormField({ label, name, error, hint, className = '', children }) {
  const t = useRegisterTranslation()
  return (
    <div className={`form-field ${className}`.trim()}>
      <label htmlFor={name}>{t(label)}</label>
      {children}
      {hint && !error && <span className="field-hint" id={`${name}-hint`}>{t(hint)}</span>}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  )
}

export function RegisterPage() {
  const t = useRegisterTranslation()
  const language = useOptionalLocalization()?.language || 'en'
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const navigate = useNavigate()
  const auth = useAuth()

  function updateValue(event) {
    const { name, type, checked, value } = event.target
    const nextValue = type === 'checkbox' ? checked : value

    setValues((current) => ({
      ...current,
      [name]: nextValue,
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
      navigate('/onboarding', { replace: true, state: { openMorningVoiceAssistant: true } })
    } catch {
      setErrorMessage('Your account was created, but automatic sign-in failed. Please sign in with your phone number and password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function signOutAndStartRegistration() {
    setErrorMessage('')
    setIsSigningOut(true)
    try {
      const cleared = await auth.signOut()
      if (!cleared) throw new Error('Session was not cleared')
      navigate('/register', { replace: true, state: null })
    } catch {
      setErrorMessage('We could not safely sign you out. Your current account is still active; please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  const describedBy = (name, includeHint = false) => {
    const ids = []
    if (includeHint) ids.push(`${name}-hint`)
    if (errors[name]) ids.push(`${name}-error`)
    return ids.length ? ids.join(' ') : undefined
  }

  if (auth.isAuthenticated) {
    const displayName = auth.patient?.full_name || auth.provider?.displayName || t('your EasyCare account')
    const continuePath = auth.provider && !auth.patient ? '/provider' : '/dashboard'
    return (
      <section className="registration-card registration-session-choice card" aria-labelledby="registration-session-title" lang={language}>
        <RegisterLanguageSwitch />
        <header className="registration-header">
          <span className="eyebrow">{t("Patient registration")}</span>
          <h2 id="registration-session-title">{t("You’re currently signed in")}</h2>
          <p>{t("You are currently signed in as")} <strong>{displayName}</strong>.</p>
          <p>{t("To create a new patient account, sign out of this account first. Your current account and its data will remain intact.")}</p>
        </header>
        {errorMessage && <div className="error-message" role="alert">{t(errorMessage)}</div>}
        <div className="registration-session-actions">
          <button className="button button--primary" type="button" onClick={() => navigate(continuePath, { replace: true })}>
            {t("Continue to Dashboard")}
          </button>
          <button className="outline-button" type="button" onClick={signOutAndStartRegistration} disabled={isSigningOut}>
            {t(isSigningOut ? 'Signing Out…' : 'Sign Out and Create New Account')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="registration-content" lang={language}>
      <RegisterLanguageSwitch />
      <header className="registration-page-header">
        <h1>{t("Create Your EasyCare Account")}</h1>
        <p>{t("Enter your details to get started with EasyCare.")}</p>
      </header>

      <div className="registration-card card">

      {errorMessage && <div className="error-message" role="alert">{t(errorMessage)}</div>}

      <form className="registration-form" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend><span>1</span>{t("Account Information")}</legend>
          <div className="form-grid">
            <FormField label="Phone Number" name="phoneNumber" error={errors.phoneNumber} hint="Myanmar formats such as 09 123 456 789 or +95 9 123 456 789">
              <input className="form-control" id="phoneNumber" name="phoneNumber" placeholder={language === 'my' ? t('Enter your phone number') : undefined} type="tel" inputMode="tel" autoComplete="tel" value={values.phoneNumber} onChange={updateValue} aria-invalid={Boolean(errors.phoneNumber)} aria-describedby={describedBy('phoneNumber', true)} />
            </FormField>
            <div className="form-field-spacer" aria-hidden="true" />
            <FormField label="Password" name="password" error={errors.password} hint="At least 8 characters with a letter and a number">
              <div className="password-control">
                <input className="form-control" id="password" name="password" placeholder={language === 'my' ? t('Enter your password') : undefined} type={t(showPassword ? 'text' : 'password')} autoComplete="new-password" value={values.password} onChange={updateValue} aria-invalid={Boolean(errors.password)} aria-describedby={describedBy('password', true)} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={t(showPassword ? 'Hide password' : 'Show password')}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
            </FormField>
            <FormField label="Confirm Password" name="confirmPassword" error={errors.confirmPassword}>
              <div className="password-control">
                <input className="form-control" id="confirmPassword" name="confirmPassword" placeholder={language === 'my' ? t('Confirm your password') : undefined} type={t(showConfirmPassword ? 'text' : 'password')} autoComplete="new-password" value={values.confirmPassword} onChange={updateValue} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={describedBy('confirmPassword')} />
                <button type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={t(showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password')}>{showConfirmPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
              </div>
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>2</span>{t("Personal Information")}</legend>
          <div className="form-grid">
            <FormField label="Full Name" name="fullName" error={errors.fullName}>
              <input className="form-control" id="fullName" name="fullName" placeholder={language === 'my' ? t('Enter your full name') : undefined} type="text" autoComplete="name" maxLength="160" value={values.fullName} onChange={updateValue} aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy('fullName')} />
            </FormField>
            <FormField label="Date of Birth" name="dateOfBirth" error={errors.dateOfBirth}>
              <input className="form-control" id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={values.dateOfBirth} onChange={updateValue} aria-invalid={Boolean(errors.dateOfBirth)} aria-describedby={describedBy('dateOfBirth')} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>3</span>{t("Consent")}</legend>
          <div className="consent-list">
            <div className="checkbox-field">
              <label htmlFor="termsAccepted"><input id="termsAccepted" name="termsAccepted" type="checkbox" required checked={values.termsAccepted} onChange={updateValue} aria-invalid={Boolean(errors.termsAccepted)} aria-describedby={describedBy('termsAccepted')} />{t("I agree to the Terms of Service")}</label>
              <FieldError id="termsAccepted-error" message={errors.termsAccepted} />
            </div>
            <div className="checkbox-field">
              <label htmlFor="privacyConsent"><input id="privacyConsent" name="privacyConsent" type="checkbox" required checked={values.privacyConsent} onChange={updateValue} aria-invalid={Boolean(errors.privacyConsent)} aria-describedby={describedBy('privacyConsent')} />{t("I acknowledge the Privacy Policy and information handling")}</label>
              <FieldError id="privacyConsent-error" message={errors.privacyConsent} />
            </div>
          </div>
        </fieldset>

        <button className="button button--primary registration-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? t('Creating Account…') : t('Create Account', 'submit')}</button>
      </form>
      <p className="auth-switch">{t("Already have an account?")} <Link to="/login">{t("Sign in")}</Link></p>
      </div>
    </div>
  )
}

