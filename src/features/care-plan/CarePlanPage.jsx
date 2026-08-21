import { useMemo, useState } from 'react'
import { CalendarDays, Check, CheckCircle2, Clock3, Home, MapPin, ShieldCheck, Stethoscope } from 'lucide-react'
import { CARE_LEVELS, CARE_PACKAGES, DURATIONS, calculateCarePlanPrice, formatMmk } from './carePlanPricing.js'

const STEPS = ['Package', 'Care Level', 'Duration', 'Schedule', 'Details', 'Review']

export function CarePlanPage() {
  const [step, setStep] = useState(0)
  const [packageId, setPackageId] = useState('')
  const [careLevelId, setCareLevelId] = useState('')
  const [durationId, setDurationId] = useState('7-days')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const selectedPackage = CARE_PACKAGES.find((item) => item.id === packageId) || null
  const allowedLevels = useMemo(() => {
    if (!selectedPackage) return CARE_LEVELS
    return CARE_LEVELS.filter((level) => selectedPackage.allowedLevels.includes(level.id))
  }, [selectedPackage])

  const selectedLevel = CARE_LEVELS.find((item) => item.id === careLevelId) || null
  const selectedDuration = DURATIONS.find((item) => item.id === durationId) || DURATIONS[2]
  const dailyPrice = selectedLevel?.pricePerDay ?? 0
  const price = calculateCarePlanPrice(dailyPrice, selectedDuration.days)

  function localDateMinimum() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  function update(setter, value) {
    setter(value)
    setSubmitted(false)
  }

  function handleSubmit(event) {
    event.preventDefault()
    setSubmitted(true)
  }

  function canProceed() {
    if (step === 0) return !!packageId
    if (step === 1) return !!careLevelId
    if (step === 2) return !!durationId
    if (step === 3) return !!startDate && !!startTime
    if (step === 4) return !!address
    return true
  }

  function nextStep() {
    if (canProceed() && step < STEPS.length - 1) setStep(step + 1)
  }

  function prevStep() {
    if (step > 0) setStep(step - 1)
  }

  function resetForPackage(newPackageId) {
    setPackageId(newPackageId)
    const pkg = CARE_PACKAGES.find((item) => item.id === newPackageId)
    const defaultLevel = pkg?.defaultLevel || ''
    setCareLevelId(defaultLevel)
    setStep(1)
  }

  return (
    <section className="care-plan-page">
      <header className="care-plan-heading">
        <div>
          <span className="eyebrow">Care at your doorstep</span>
          <h1>Choose the Right Care for Your Loved One</h1>
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
        <form className="care-plan-form card" onSubmit={handleSubmit}>
          {step === 0 && (
            <fieldset>
              <legend><span>1</span> Choose a care package</legend>
              <div className="care-package-grid">
                {CARE_PACKAGES.map((item) => (
                  <label className={`care-package-option${packageId === item.id ? ' selected' : ''}`} key={item.id}>
                    <input className="sr-only" type="radio" name="package" value={item.id} checked={packageId === item.id} onChange={() => resetForPackage(item.id)} />
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                      <ul>
                        {item.includes.slice(0, 4).map((text) => <li key={text}>{text}</li>)}
                        {item.includes.length > 4 && <li>+{item.includes.length - 4} more</li>}
                      </ul>
                      {item.note && <small className="care-package-note">{item.note}</small>}
                    </div>
                  </label>
                ))}
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
                        <strong>{formatMmk(item.pricePerDay)} / day</strong>
                        <small>Estimated prototype rate</small>
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
              <div className="duration-grid">
                {DURATIONS.map((item) => (
                  <label className={`duration-option${durationId === item.id ? ' selected' : ''}`} key={item.id}>
                    <input className="sr-only" type="radio" name="duration" value={item.id} checked={durationId === item.id} onChange={() => update(setDurationId, item.id)} />
                    <strong>{item.label}</strong>
                    {selectedLevel && <small>{formatMmk(calculateCarePlanPrice(selectedLevel.pricePerDay, item.days).total)} total</small>}
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
              <legend><span>5</span> Home visit details</legend>
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

          {step === 5 && (
            <fieldset>
              <legend><span>6</span> Review care request</legend>
              <div className="review-list">
                <div><strong>Package</strong><span>{selectedPackage?.name}</span></div>
                <div><strong>Care level</strong><span>{selectedLevel?.name}</span></div>
                <div><strong>Duration</strong><span>{selectedDuration.label}</span></div>
                <div><strong>Start</strong><span>{startDate || 'Not set'} {startDate && `at ${startTime}`}</span></div>
                <div><strong>Address</strong><span>{address || 'Not set'}</span></div>
                {notes && <div><strong>Care notes</strong><span>{notes}</span></div>}
                <div className="review-price">
                  <strong>Total</strong>
                  <span>{formatMmk(price.total)}</span>
                </div>
                <small className="review-commission">Includes EasyCare platform service fee ({Math.round(100 - (1 - 0.17) * 100)}%).</small>
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
              <button className="button button--primary care-plan-submit" type="submit">Book Care Plan</button>
            )}
          </div>

          {submitted && (
            <div className="success-message care-plan-success" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Your care request is ready for review.</strong>
                This preview has not created or sent a real booking.
              </span>
            </div>
          )}
        </form>

        <aside className="care-plan-summary card" aria-label="Care plan summary">
          <span className="eyebrow">Your Care Plan</span>
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
              <dd>{selectedDuration.label}</dd>
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

          {dailyPrice > 0 && (
            <div className="care-plan-price">
              <div>
                <span>Service total</span>
                <strong>{formatMmk(price.total)}</strong>
              </div>
              <button type="button" className="care-plan-price-details" aria-expanded="false" onClick={(e) => { const next = e.currentTarget.nextElementSibling; const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true'; e.currentTarget.setAttribute('aria-expanded', String(!expanded)); next.hidden = expanded }}>
                Price details
              </button>
              <div className="care-plan-price-breakdown" hidden>
                <div><span>Provider care amount</span><span>{formatMmk(price.providerAmount)}</span></div>
                <div><span>EasyCare platform commission (17%)</span><span>{formatMmk(price.commission)}</span></div>
                <div className="care-plan-price-total"><span>Total</span><span>{formatMmk(price.total)}</span></div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
