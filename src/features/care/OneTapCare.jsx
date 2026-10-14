import { createContext, useContext, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'

export const CARE_INTENTS = ['New health concern', 'Follow-up care', 'Medication question', 'Review a health document/result', 'Need a consultation']
export const NOTE_LIMIT = 1000
const CareContext = createContext({ draft: null, setDraft: () => {}, clear: () => {} })
export const useOneTapCare = () => useContext(CareContext)
export function composeBookingReason(draft, reason = '') {
  const parts = []
  if (draft && CARE_INTENTS.includes(draft.intent)) {
    parts.push(`Care request: ${draft.intent}`)
    if (draft.note?.trim()) parts.push(`Patient note:\n${draft.note.trim()}`)
  }
  if (reason.trim()) parts.push(`Additional booking reason:\n${reason.trim()}`)
  const value = draft ? parts.join('\n\n') : reason.trim()
  return { reason: value, length: value.length, valid: value.length <= 2000 }
}
export function bookingReason(draft, reason = '') {
  const result = composeBookingReason(draft, reason)
  if (!result.valid) throw new Error('Your care request and booking reason must total 2,000 characters or fewer. Please shorten your additional reason or care note.')
  return result.reason
}
function AccountDraft({ children }) {
  const [draft, setDraft] = useState(null)
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname !== '/care/start' && !/^\/doctors(?:\/|$)/.test(pathname)) setDraft(null)
  }, [pathname])
  return <CareContext.Provider value={{ draft, setDraft, clear: () => setDraft(null) }}>{children}</CareContext.Provider>
}
export function OneTapCareProvider({ children }) {
  const { user, patient } = useAuth()
  return <AccountDraft key={`${user?.id || 'signed-out'}:${patient?.id || 'no-patient'}`}>{children}</AccountDraft>
}
export function OneTapCarePage() {
  const { patient } = useAuth()
  const { draft, setDraft, clear } = useOneTapCare()
  const navigate = useNavigate()
  const [step, setStep] = useState('emergency')
  const [intent, setIntent] = useState(draft?.intent || '')
  const [note, setNote] = useState(draft?.note || '')
  if (!patient?.id) return <p role="alert">Sign in with your patient account to request care.</p>
  return <section className="card booking-panel" style={{ overflowWrap: 'anywhere', minWidth: 0 }}><h1>I Need Care</h1><p>Care for: <strong>Self</strong> · {patient.full_name}</p>
    {step === 'emergency' ? <><h2>Step 1 of 2: Do you need emergency help right now?</h2><button className="button button--secondary" onClick={() => setStep('intent')}>No, continue</button>{' '}<button className="button button--danger" onClick={() => { clear(); setStep('stop') }}>Yes, I need emergency help</button></> : step === 'stop' ? <><h2>Seek emergency help now</h2><p role="alert">If this may be a medical emergency, contact your local emergency services or go to the nearest emergency department now. Do not wait for a routine appointment.</p><button className="button button--secondary" onClick={() => setStep('emergency')}>Back</button></> : <form className="booking-form" onSubmit={event => { event.preventDefault(); if (!CARE_INTENTS.includes(intent) || note.length > NOTE_LIMIT) return; setDraft({ intent, note: note.trim() }); navigate('/doctors') }}><h2>Step 2 of 2: What do you need help with?</h2><label>Care intent<select className="form-control" required value={intent} onChange={event => setIntent(event.target.value)}><option value="">Choose a care intent</option>{CARE_INTENTS.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Optional patient note<textarea className="form-control" maxLength={NOTE_LIMIT} value={note} onChange={event => setNote(event.target.value)} /></label><p>This is your description, not a diagnosis. Maximum {NOTE_LIMIT} characters.</p><button className="button button--secondary" type="button" onClick={() => setStep('emergency')}>Back</button><button className="button button--primary" type="submit">Choose a doctor</button></form>}
    <p><Link to="/dashboard" onClick={clear}>Exit care request</Link></p>
  </section>
}
