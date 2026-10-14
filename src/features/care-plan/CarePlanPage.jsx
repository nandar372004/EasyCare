import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, Clock3, MapPin, ShieldCheck, Stethoscope } from 'lucide-react'
import { CARE_LEVELS, CARE_PACKAGES, calculateCarePlanPrice, formatMmk } from './carePlanPricing.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { familyHealthService } from '../../services/familyHealthService.js'
import { carePlanCatalogService } from '../../services/carePlanCatalogService.js'
import { carePlanBookingService } from '../../services/carePlanBookingService.js'

const STEPS = ['Package', 'Care Level', 'Duration', 'Schedule', 'For Who?', 'Details', 'Review']
const FAMILY_PERMISSION_MESSAGE = 'You no longer have permission to book care for this family member.'

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16))
  if (!bytes) throw new Error('Secure booking retry protection is unavailable. Please refresh and try again.')
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function loadAuthorizedFamilyRecipients() {
  const groups = await familyHealthService.getGroups()
  const members = (await Promise.all((groups || []).map(group => familyHealthService.getMembers(group.id)))).flat()
  return [...new Map(members.filter(member => !member.is_self && canBookForMember(member)).map(member => [member.patient_id, member])).values()]
}

function canBookForMember(member, now = Date.now()) {
  const grant = member?.authorization
  return Boolean(member?.patient_id && grant?.status === 'active'
    && (!grant.expires_at || Date.parse(grant.expires_at) > now)
    && grant.appointments === true && grant.payments === true)
}

export function CarePlanPage() {
  const auth = useAuth()
  const [step, setStep] = useState(0)
  const [packageId, setPackageId] = useState('')
  const [careLevelId, setCareLevelId] = useState('')
  const [durationDays, setDurationDays] = useState(7)
  const [catalogPackages, setCatalogPackages] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [quotes, setQuotes] = useState([])
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingResult, setBookingResult] = useState(null)
  const idempotencyKeyRef = useRef(null)
  const [recipientId, setRecipientId] = useState('')
  const [familyRecipients, setFamilyRecipients] = useState([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState('')
  const [recipientError, setRecipientError] = useState('')

  useEffect(() => {
    let active = true
    carePlanCatalogService.listPackages()
      .then(rows => { if (active) { setCatalogPackages(rows); setCatalogError('') } })
      .catch(() => { if (active) setCatalogError('Home Care prices are temporarily unavailable. Please try again later.') })
      .finally(() => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const selectedPackage = catalogPackages.find(item => item.code === packageId)
    const selectedLevel = selectedPackage?.levels.find(item => item.code === careLevelId)
    if (!selectedPackage || !selectedLevel) {
      setQuotes([])
      setQuoteError('')
      setQuoteLoading(false)
      return undefined
    }
    setQuoteLoading(true)
    setQuoteError('')
    Promise.all(selectedPackage.allowedDurationDays.map(days => carePlanCatalogService.quote(selectedPackage.id, selectedLevel.id, days)))
      .then(rows => { if (active) setQuotes(rows.filter(Boolean)) })
      .catch(() => { if (active) { setQuotes([]); setQuoteError('We could not calculate this Home Care quote. Please try again.') } })
      .finally(() => { if (active) setQuoteLoading(false) })
    return () => { active = false }
  }, [catalogPackages, packageId, careLevelId])

  useEffect(() => {
    const chosenPackage = catalogPackages.find(item => item.code === packageId)
    if (chosenPackage && !chosenPackage.allowedDurationDays.includes(durationDays)) {
      setDurationDays(chosenPackage.allowedDurationDays[0] || 0)
    }
  }, [catalogPackages, packageId, durationDays])

  useEffect(() => {
    let active = true
    async function loadRecipients() {
      setRecipientsLoading(true)
      try {
        const eligible = await loadAuthorizedFamilyRecipients()
        if (active) setFamilyRecipients(eligible)
      } catch {
        if (active) setRecipientsError('Authorized family members could not be loaded. You can still choose yourself.')
      } finally {
        if (active) setRecipientsLoading(false)
      }
    }
    if (auth.patient?.id) loadRecipients()
    return () => { active = false }
  }, [auth.patient?.id, auth.user?.id])

  const selectedPackage = CARE_PACKAGES.find((item) => item.id === packageId) || null
  const selectedCatalogPackage = catalogPackages.find(item => item.code === packageId) || null
  const allowedLevels = useMemo(() => {
    if (!selectedCatalogPackage) return []
    return selectedCatalogPackage.levels.map(serverLevel => CARE_LEVELS.find(level => level.id === serverLevel.code)).filter(Boolean)
  }, [selectedCatalogPackage])

  const selectedLevel = CARE_LEVELS.find((item) => item.id === careLevelId) || null
  const selectedCatalogLevel = selectedCatalogPackage?.levels.find(item => item.code === careLevelId) || null
  const availableDurations = (selectedCatalogPackage?.allowedDurationDays || []).map(days => ({
    days, id: String(days) + '-days', label: String(days) + (days === 1 ? ' Day' : ' Days'),
  }))
  const selectedDuration = availableDurations.find(item => item.days === durationDays) || null
  const selectedQuote = quotes.find(item => Number(item.duration_days) === durationDays) || null
  const price = calculateCarePlanPrice(selectedQuote)
  const dailyPrice = Number(selectedCatalogLevel?.unitPrice || 0)
  const selectedMember = familyRecipients.find(item => item.patient_id === recipientId)
  const selectedRecipient = recipientId === auth.patient?.id
    ? { name: auth.patient?.full_name || 'You', relationship: 'Myself' }
    : selectedMember ? { name: selectedMember.display_name, relationship: selectedMember.relationshipLabel || 'Family member' } : null

  function localDateMinimum() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  function update(setter, value) {
    setter(value)
    idempotencyKeyRef.current = null
    setBookingResult(null)
    setBookingError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (bookingLoading || bookingResult) return
    setBookingError('')
    if (!selectedQuote || quoteLoading || !selectedCatalogPackage || !selectedCatalogLevel) {
      setBookingError('A current server quote is required before you can send this request.')
      return
    }
    const validRecipient = await validateRecipientBeforeReview()
    if (!validRecipient) return
    setBookingLoading(true)
    try {
      if (!idempotencyKeyRef.current) idempotencyKeyRef.current = createIdempotencyKey()
      const result = await carePlanBookingService.createBooking({
        recipientPatientId: recipientId,
        packageId: selectedCatalogPackage.id,
        serviceId: selectedCatalogLevel.id,
        durationDays,
        preferredDate: startDate,
        preferredTime: startTime,
        address,
        reasonSymptoms: notes,
        idempotencyKey: idempotencyKeyRef.current,
      })
      if (!result?.care_request_id) throw new Error('We could not confirm your Home Care request. Please try again.')
      setBookingResult(result)
      setBookingError('')
      idempotencyKeyRef.current = null
    } catch (error) {
      if (recipientId !== auth.patient?.id && error?.code === '42501'
        && /permission to book care for this family member/i.test(error.message || '')) {
        setRecipientId('')
        setStep(4)
        setRecipientError(FAMILY_PERMISSION_MESSAGE)
        try { setFamilyRecipients(await loadAuthorizedFamilyRecipients()) } catch { setFamilyRecipients([]) }
        return
      }
      setBookingError(error?.message || 'We could not send your Home Care request. Please try again.')
    } finally {
      setBookingLoading(false)
    }
  }

  async function validateRecipientBeforeReview() {
    setRecipientError('')
    if (!recipientId) {
      setRecipientError('Please select who this Home Care service is for.')
      setStep(4)
      return false
    }
    if (recipientId === auth.patient?.id) return true
    try {
      const members = await loadAuthorizedFamilyRecipients()
      const current = members.find(member => member.patient_id === recipientId && !member.is_self)
      if (canBookForMember(current)) return true
      setFamilyRecipients(members)
      setRecipientId('')
      setRecipientError(FAMILY_PERMISSION_MESSAGE)
      setStep(4)
      return false
    } catch {
      setRecipientError('We could not recheck family authorization. Please try again before continuing.')
      setStep(4)
      return false
    }
  }

  function canProceed() {
    if (step === 0) return catalogPackages.some(item => item.code === packageId && item.levels.length > 0)
    if (step === 1) return Boolean(careLevelId && selectedCatalogLevel)
    if (step === 2) return Boolean(durationDays && selectedQuote)
    if (step === 3) return !!startDate && !!startTime
    if (step === 4) return !!recipientId
    if (step === 5) return !!address
    return true
  }

  function nextStep() {
    if (!canProceed()) {
      if (step === 4 && !recipientId) setRecipientError('Please select who this Home Care service is for.')
      return
    }
    if (step === 5) {
      validateRecipientBeforeReview().then(valid => { if (valid) setStep(6) })
      return
    }
    if (step < STEPS.length - 1) setStep(step + 1)
  }

  function prevStep() {
    if (step > 0) setStep(step - 1)
  }

  function resetForPackage(newPackageId) {
    idempotencyKeyRef.current = null
    setBookingResult(null)
    setBookingError('')
    setPackageId(newPackageId)
    const pkg = catalogPackages.find(item => item.code === newPackageId)
    const presentation = CARE_PACKAGES.find((item) => item.id === newPackageId)
    const preferred = pkg?.levels.find(item => item.code === presentation?.defaultLevel)?.code
    setCareLevelId(preferred || pkg?.levels[0]?.code || '')
    setDurationDays(pkg?.allowedDurationDays.includes(durationDays) ? durationDays : pkg?.allowedDurationDays[0] || 0)
    setStep(1)
  }

  return (
    <section className="care-plan-page">
      <header className="care-plan-heading">
        <div>
          <span className="eyebrow">Care at your doorstep</span>
          <h1>Request Professional Home Care</h1>
          <p>Professional home healthcare tailored to your family's needs.</p>
        </div>
        <div className="care-plan-assurance">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>Flexible home care</strong>
            <small>Review your choices before requesting</small>
          </span>
        </div>
      </header>

      <div className="care-plan-steps" role="navigation" aria-label="Care plan steps">
        {STEPS.map((label, idx) => {
          const state = idx === step ? 'active' : idx < step ? 'done' : 'upcoming'
          return (
            <div key={label} className={`care-plan-step-wrapper ${state}`}>
              <button type="button" className="care-plan-step" aria-current={idx === step ? 'step' : undefined} onClick={() => idx <= step && setStep(idx)}>
                <span className="care-plan-step-circle">
                  {idx < step ? <Check aria-hidden="true" /> : idx + 1}
                </span>
                <span className="care-plan-step-label">{label}</span>
              </button>
              {idx < STEPS.length - 1 && <span className="care-plan-step-connector" aria-hidden="true" />}
            </div>
          )
        })}
      </div>

      <div className="care-plan-layout">
        <form className="care-plan-form card" onSubmit={handleSubmit} aria-busy={bookingLoading}>
          {step === 0 && (
            <fieldset>
              <legend><span>1</span> Choose a care package</legend>
              {catalogLoading && <p role="status">Loading Home Care packages and prices…</p>}
              {catalogError && <p className="care-recipient-error" role="alert">{catalogError}</p>}
              <div className="care-package-grid">
                {CARE_PACKAGES.map((item) => {
                  const available = catalogPackages.some(row => row.code === item.id && row.levels.length)
                  return (
                  <label className={'care-package-option' + (packageId === item.id ? ' selected' : '') + (available ? '' : ' unavailable')} key={item.id}>
                    <input className="sr-only" type="radio" name="package" value={item.id} checked={packageId === item.id} disabled={!available || catalogLoading} onChange={() => resetForPackage(item.id)} />
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                      <ul>
                        {item.includes.slice(0, 4).map((text) => <li key={text}>{text}</li>)}
                        {item.includes.length > 4 && <li>+{item.includes.length - 4} more</li>}
                      </ul>
                      {item.note && <small className="care-package-note">{item.note}</small>}
                      {!available && <small className="care-package-note">{item.id === 'remote-family' ? 'Coming Soon / Pricing to be confirmed' : 'Temporarily unavailable'}</small>}
                    </div>
                  </label>
                  )
                })}
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend><span>2</span> Choose your care level</legend>
              <div className="care-level-grid">
                {allowedLevels.map((item) => (
                  <label className={`care-level-option${careLevelId === item.id ? ' selected' : ''}`} key={item.id}>
                    <input className="sr-only" type="radio" name="careLevel" value={item.id} checked={careLevelId === item.id} onChange={() => update(setCareLevelId, item.id)} />
                    <div>
                      <div className="care-level-header">
                        <strong>{item.name}</strong>
                        {item.popular && <span className="care-level-popular">Most Popular</span>}
                      </div>
                      <p>{item.description}</p>
                      <ul>
                        {item.includes.map((text) => <li key={text}>{text}</li>)}
                      </ul>
                      <div className="care-level-price">
                        <strong>{formatMmk(selectedCatalogPackage?.levels.find(level => level.code === item.id)?.unitPrice || 0)} / day</strong>
                        <small>Server-quoted rate</small>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend><span>3</span> Choose duration</legend>
              {quoteLoading && <p role="status">Calculating server quotes…</p>}
              {quoteError && <p className="care-recipient-error" role="alert">{quoteError}</p>}
              <div className="duration-grid">
                {availableDurations.map((item) => (
                  <label className={'duration-option' + (durationDays === item.days ? ' selected' : '')} key={item.id}>
                    <input className="sr-only" type="radio" name="duration" value={item.days} checked={durationDays === item.days} onChange={() => update(setDurationDays, item.days)} />
                    <strong>{item.label}</strong>
                    {quotes.find(quote => Number(quote.duration_days) === item.days) && <small>{formatMmk(Number(quotes.find(quote => Number(quote.duration_days) === item.days).subtotal))} total</small>}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend><span>4</span> Preferred schedule</legend>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="care-start-date">Preferred start date</label>
                  <input className="form-control" id="care-start-date" type="date" min={localDateMinimum()} value={startDate} onChange={(event) => update(setStartDate, event.target.value)} required />
                </div>
                <div className="form-field">
                  <label htmlFor="care-start-time">Preferred start time</label>
                  <input className="form-control" id="care-start-time" type="time" value={startTime} onChange={(event) => update(setStartTime, event.target.value)} required />
                </div>
              </div>
            </fieldset>
          )}

          {step === 4 && (
            <fieldset>
              <legend><span>5</span> For Who? <span className="care-recipient-required">*</span></legend>
              <p className="care-recipient-helper">Select who needs this home care service.</p>
              <div className="care-recipient-list" role="radiogroup" aria-label="For Who?">
                {auth.patient?.id && <button type="button" role="radio" aria-checked={recipientId === auth.patient.id} className={'care-recipient-option' + (recipientId === auth.patient.id ? ' selected' : '')} onClick={() => { setRecipientId(auth.patient.id); setRecipientError(''); setBookingError(''); idempotencyKeyRef.current = null; setBookingResult(null) }}>
                  <span className="care-recipient-avatar" aria-hidden="true">{(auth.patient.full_name || 'Y').trim().charAt(0).toUpperCase()}</span>
                  <span className="care-recipient-copy"><strong>{auth.patient.full_name || 'You'}</strong><small>Myself</small></span>
                  <span className="care-recipient-indicator" aria-hidden="true">{recipientId === auth.patient.id && <Check aria-hidden="true" />}</span>
                </button>}
                {familyRecipients.map(member => <button type="button" role="radio" aria-checked={recipientId === member.patient_id} className={'care-recipient-option' + (recipientId === member.patient_id ? ' selected' : '')} key={member.patient_id} onClick={() => { setRecipientId(member.patient_id); setRecipientError(''); setBookingError(''); idempotencyKeyRef.current = null; setBookingResult(null) }}>
                  <span className="care-recipient-avatar" aria-hidden="true">{(member.display_name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="care-recipient-copy"><strong>{member.display_name}</strong><small>{member.relationshipLabel || 'Family member'}</small></span>
                  <span className="care-recipient-indicator" aria-hidden="true">{recipientId === member.patient_id && <Check aria-hidden="true" />}</span>
                </button>)}
              </div>
              {recipientsLoading && <p className="care-recipient-status" role="status">Loading authorized family members…</p>}
              {recipientsError && <p className="care-recipient-status" role="status">{recipientsError}</p>}
              {(recipientError || (!recipientId && !recipientsLoading)) && <p className="care-recipient-error" role="alert">{recipientError || 'Please select who this Home Care service is for.'}</p>}
            </fieldset>
          )}

          {step === 5 && (
            <fieldset>
              <legend><span>6</span> Home visit details</legend>
              <div className="form-field">
                <label htmlFor="care-address">Home address</label>
                <div className="care-input-icon">
                  <MapPin aria-hidden="true" />
                  <input className="form-control" id="care-address" value={address} onChange={(event) => update(setAddress, event.target.value)} placeholder="Enter the address for the home visit" required />
                </div>
              </div>
              <div className="form-field">
                <label htmlFor="care-notes">Care notes <span className="muted">(optional)</span></label>
                <textarea className="form-control" id="care-notes" value={notes} onChange={(event) => update(setNotes, event.target.value)} placeholder={selectedPackage?.id === 'medical-care' || selectedPackage?.id === 'post-hospital' ? 'Please describe the patient\'s current care needs so EasyCare can confirm an appropriate provider.' : 'Tell us about mobility needs, medical equipment, access instructions, or other care requirements.'} />
              </div>
            </fieldset>
          )}

          {step === 6 && (
            <fieldset>
              <legend><span>7</span> Review care request</legend>
              <div className="review-list">
                <div><strong>For</strong><span>{selectedRecipient ? selectedRecipient.name + ' — ' + selectedRecipient.relationship : 'Not selected'}</span></div>
                <div><strong>Requested by</strong><span>{auth.patient?.full_name || 'Signed-in patient'}</span></div>
                <div><strong>Package</strong><span>{selectedPackage?.name}</span></div>
                <div><strong>Care level</strong><span>{selectedLevel?.name}</span></div>
                <div><strong>Duration</strong><span>{selectedDuration?.label || 'Not quoted'}</span></div>
                <div><strong>Start</strong><span>{startDate || 'Not set'} {startDate && `at ${startTime}`}</span></div>
                <div><strong>Address</strong><span>{address || 'Not set'}</span></div>
                {notes && <div><strong>Care notes</strong><span>{notes}</span></div>}
                <div className="review-price">
                  <strong>Total</strong>
                  <span>{selectedQuote ? formatMmk(price.total) : quoteLoading ? 'Calculating…' : 'Quote unavailable'}</span>
                </div>
              </div>
            </fieldset>
          )}

          <div className="care-plan-actions">
            {step > 0 && <button type="button" className="button button--secondary" onClick={prevStep}>Back</button>}
            {step < STEPS.length - 1 && (
              <button type="button" className="button button--primary" onClick={nextStep} disabled={!canProceed()}>
                Continue
              </button>
            )}
            {step === STEPS.length - 1 && (
              <button className="button button--primary care-plan-submit" type="submit" disabled={bookingLoading || bookingResult != null || quoteLoading || !selectedQuote || !recipientId || !address.trim() || !startDate || !startTime}>
                {bookingLoading ? 'Sending request…' : bookingResult ? 'Request sent' : 'Request Home Care'}
              </button>
            )}
          </div>

          {bookingError && <p className="care-recipient-error" role="alert">{bookingError}</p>}
          {bookingResult && (
            <div className="success-message care-plan-success" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Your Home Care request has been sent.</strong>
                {bookingResult.care_request_id ? ` Request reference: ${bookingResult.care_request_id}.` : ' EasyCare will review your request.'}
                {bookingResult.subtotal != null && ` Server-confirmed total: ${formatMmk(Number(bookingResult.subtotal))}.`}
              </span>
            </div>
          )}
        </form>

        <aside className="care-plan-summary card" aria-label="Care plan summary">
          <span className="eyebrow">Your Home Care Request</span>
          <h2>{selectedPackage?.name || 'Select a package'}</h2>
          <p>{selectedPackage?.description || 'Choose a care package to get started.'}</p>

          {selectedPackage?.note && <p className="care-plan-package-note">{selectedPackage.note}</p>}

          <dl>
            <div>
              <dt><Stethoscope aria-hidden="true" /> Care Level</dt>
              <dd>{selectedLevel?.name || 'Not selected'}</dd>
            </div>
            <div>
              <dt><Clock3 aria-hidden="true" /> Duration</dt>
              <dd>{selectedDuration?.label || 'Choose a duration'}</dd>
            </div>
            <div>
              <dt><CalendarDays aria-hidden="true" /> Start</dt>
              <dd>{startDate || 'Choose a date'}{startDate && ` at ${startTime}`}</dd>
            </div>
            <div>
              <dt><MapPin aria-hidden="true" /> Location</dt>
              <dd>{address || 'Add your home address'}</dd>
            </div>
          </dl>

          {selectedQuote && dailyPrice > 0 && (
            <div className="care-plan-price">
              <div>
                <span>Service total</span>
                <strong>{formatMmk(price.total)}</strong>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
