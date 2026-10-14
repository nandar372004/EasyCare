import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bot, Building2, Check, ChevronRight, CreditCard, MessageSquare, Navigation, Phone, Search, Send } from 'lucide-react'
import { facilities, googleMapsDirectionsUrl, googleMapsEmbedUrl, invoices, mapMarkerPosition, nearbyMandalayFacilities, PRESENTATION_ONLY } from './secondaryFixtures.js'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { GUARDIAN_MAX_INPUT_LENGTH } from '../guardian/guardianSafety.js'
import { requestGuardianGuidance } from '../../services/guardianGatewayService.js'
import { PatientSettingsPage } from './PatientSettingsPage.jsx'
import { supportMessagingService } from '../../services/supportMessagingService.js'
import { useChatScroll } from '../messaging/useChatScroll.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { HealthGuardianGuidedChat } from './HealthGuardianGuidedChat.jsx'
import './messagesPage.css'

function DemoBanner({ children = PRESENTATION_ONLY, danger = false }) {
  return <div className={`secondary-demo-banner${danger ? ' danger' : ''}`} role="note"><AlertTriangle aria-hidden="true" /> <strong>{children}</strong></div>
}

function PageTitle({ icon: Icon, title, subtitle, className = '' }) {
  return <header className={`page-heading secondary-heading ${className}`}><div className="secondary-title-icon"><Icon /></div><div><h1>{title}</h1><p>{subtitle}</p></div></header>
}

export function HealthGuardianPage() {
  const { t, language } = useLocalization()
  const [message, setMessage] = useState('')
  const [scenario, setScenario] = useState(null)
  const [checking, setChecking] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!message.trim() || checking) return
    setChecking(true)
    setScenario(await requestGuardianGuidance({ message, language }))
    setChecking(false)
  }
  const titles = { routine: t('guardian.routineTitle'), soon: t('guardianGuided.clinicianReview'), urgent: t('guardian.urgentTitle'), emergency: t('guardian.emergencyTitle') }
  return <section className="secondary-page guardian-page">
    <PageTitle icon={Bot} title={t('guardian.title')} subtitle={t('guardian.subtitle')} className="ai-health-guardian-header" />
    <DemoBanner>{t('guardian.limitation')}</DemoBanner>
    <div className="guardian-layout"><div className="card guardian-chat">
      <HealthGuardianGuidedChat language={language} />
      <div className="guardian-welcome"><Bot /><div><strong>{t('guardianGuided.existingIntro')}</strong><p>{t('guardianGuided.existingExamples')}</p></div></div>
      {scenario && <article className={`guardian-response ${scenario.riskLevel}`} aria-live="polite"><span>{titles[scenario.riskLevel]}</span><p>{scenario.summary}</p><ul>{scenario.guidance.map(item => <li key={item}>{item}</li>)}</ul></article>}
      <form onSubmit={submit} className="guardian-input"><label htmlFor="guardian-message" className="sr-only">{t('guardianGuided.describeSymptoms')}</label><input id="guardian-message" maxLength={GUARDIAN_MAX_INPUT_LENGTH} value={message} onChange={e => setMessage(e.target.value)} placeholder={t('guardianGuided.scenarioPlaceholder')} /><button className="primary-button" disabled={!message.trim() || checking}><Send /> {checking ? t('guardianGuided.checkingSafely') : t('guardianGuided.checkScenario')}</button></form>
    </div><aside className="guardian-actions card"><h2>{t('guardianGuided.nextActions')}</h2>{scenario?.riskLevel === 'emergency' ? <><p>{t('guardian.override')}</p><a className="danger-button" href="tel:192"><Phone /> {t('action.callEmergency')}</a></> : <><p>{t('guardianGuided.clinicianAssessment')}</p><Link className="primary-button" to="/doctors">{t('action.bookAppointment')}</Link><a className="outline-button danger-text" href="tel:192"><Phone /> {t('action.callEmergency')}</a></>}</aside></div>
  </section>
}

export function PaymentsPage() {
  return <section className="secondary-page"><PageTitle icon={CreditCard} title="Payment Overview" subtitle="View your current plan and payment history." />
    <p className="payment-processing-note">Payment processing is not enabled in this version.</p>
    <div className="payment-summary"><article className="card"><span className="eyebrow">Subscription</span><h2>Current Plan</h2><strong className="large-amount">0 MMK due</strong></article><article className="card fake-card"><span className="eyebrow">Payment method</span><h2>Card ending 4242</h2></article></div>
    <section className="card invoice-card"><h2>Payment History</h2><div className="invoice-table"><div className="invoice-head"><span>Invoice</span><span>Date</span><span>Description</span><span>Status</span><span>Amount</span></div>{invoices.map(row => <article key={row.id}><strong>{row.id}</strong><span>{row.date}</span><span>{row.description}</span><span className="status-badge">{row.status}</span><span>{row.amount}</span></article>)}</div></section>
  </section>
}

export function MessagesPage() {
  const { t } = useLocalization()
  const { user } = useAuth()
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const messageRequest = useRef(0)
  const { scrollRef, onScroll } = useChatScroll(messages)
  const refreshMessages = useCallback(async conversationId => {
    const request = ++messageRequest.current
    try {
      const rows = await supportMessagingService.listPatientMessages(conversationId)
      if (request === messageRequest.current) setMessages(Array.isArray(rows) ? rows : [])
    } catch {
      if (request === messageRequest.current) setError('Unable to refresh messages. Reopen the conversation to try again.')
    }
  }, [])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await supportMessagingService.getOrCreatePatientConversation()
      const current = Array.isArray(rows) ? rows[0] : rows
      if (!current?.conversation_id) throw new Error('Conversation unavailable')
      setConversation(current)
      await refreshMessages(current.conversation_id)
    } catch { setError('Messages are temporarily unavailable. Please try again.') }
    finally { setLoading(false) }
  }, [refreshMessages])
  useEffect(() => {
    if (!user?.id) { setConversation(null); setMessages([]); return }
    void load()
  }, [load, user?.id])
  useEffect(() => {
    if (!conversation?.conversation_id) return undefined
    const conversationId = conversation.conversation_id
    const unsubscribe = supportMessagingService.subscribePatientConversation(
      conversationId,
      () => { void refreshMessages(conversationId) },
      status => { if (status === 'SUBSCRIBED') void refreshMessages(conversationId) },
    )
    return () => { messageRequest.current += 1; unsubscribe() }
  }, [conversation?.conversation_id, refreshMessages])
  const send = async event => {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !conversation?.conversation_id || sending) return
    setSending(true); setError('')
    try {
      await supportMessagingService.sendPatientMessage(conversation.conversation_id, body)
      setDraft('')
      await refreshMessages(conversation.conversation_id)
    } catch { setError('Your message could not be sent. Please try again.') }
    finally { setSending(false) }
  }
  return <section className="secondary-page messages-page"><PageTitle className="messages-page-header" icon={MessageSquare} title={t('nav.messages')} subtitle="EasyCare Care Support" />
    <div className="messages-layout card support-messages-layout"><section className="message-thread support-message-thread"><header><strong>Care Coordinator</strong><span>EasyCare Care Support</span></header>
      <div ref={scrollRef} onScroll={onScroll} className="message-stream" aria-live="polite">{loading ? <p role="status">Loading messages…</p> : messages.length ? messages.map(message => <p className={message.sender_is_patient ? 'sent' : 'received'} key={message.message_id}>{message.body}<small>{new Date(message.created_at).toLocaleString()}</small></p>) : <div className="support-empty"><strong>Chat with your Care Coordinator</strong><p>Ask about appointments, care services, or using EasyCare.</p></div>}</div>
      {error && <p role="alert" className="error-message">{error} <button type="button" className="text-link" onClick={() => void load()}>Try again</button></p>}
      <form onSubmit={send}><input aria-label="Message your Care Coordinator" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message…" maxLength={4000} /><button className="primary-button" disabled={!draft.trim() || sending || loading}><Send /> {sending ? 'Sending…' : 'Send'}</button></form>
    </section></div>
  </section>
}

const FACILITY_FILTERS = ['All', 'Hospital', 'Clinic', 'Pharmacy', 'Lab']
const FACILITY_FILTER_LABELS = { All: 'All', Hospital: 'Hospitals', Clinic: 'Clinics', Pharmacy: 'Pharmacies', Lab: 'Labs' }

function formatConsentUpdatedAt(value, locale) {
  if (!value) return 'Not updated yet'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

export function LocationSosPage() {
  const { t, locale } = useLocalization()
  const [consent, setConsent] = useState(false)
  const [consentUpdatedAt, setConsentUpdatedAt] = useState(null)
  const [filter, setFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [active, setActive] = useState(false)
  const activeFilter = filter !== 'All' ? filter : (typeFilter !== 'All' ? typeFilter : 'All')
  const visible = useMemo(
    () => nearbyMandalayFacilities(facilities, { type: activeFilter, query: searchQuery }),
    [activeFilter, searchQuery],
  )
  const mapSrc = googleMapsEmbedUrl(visible, activeFilter)
  const toggleConsent = () => {
    setConsent((value) => !value)
    setConsentUpdatedAt(new Date())
  }
  return <section className="secondary-page location-sos-page location-redesign-page">
    <header className="location-page-heading"><h1>{t('nav.location')}</h1><p>Find nearby care and get help in emergencies.</p></header>
    <div className="location-layout">
      <aside className="location-side">
        <article className="card location-consent-card">
          <h2>Location Consent</h2>
          <p>Allow EasyCare to access your location to find nearby care in Mandalay.</p>
          <div className="location-access-row">
            <span className="location-access-icon" aria-hidden="true"><ChevronRight /></span>
            <div><strong>Location Access</strong><span className={`location-access-badge${consent ? ' location-access-badge--allowed' : ''}`}>{consent ? 'Allowed' : 'Not allowed'}</span></div>
          </div>
          <p className="location-consent-updated">Last updated: {formatConsentUpdatedAt(consentUpdatedAt, locale)}</p>
          <button className="outline-button location-manage-button" type="button" aria-pressed={consent} onClick={toggleConsent}>{consent ? <><Check aria-hidden="true" /> Manage Permission</> : 'Manage Permission'}</button>
        </article>
        <article className="card sos-card">
          <h2>Emergency SOS (Simulation)</h2>
          <p className="sos-instruction">Press the button only in real emergencies.</p>
          {!active && !confirming && <>
            <button className="sos-emblem" type="button" aria-label="Start SOS simulation" onClick={() => setConfirming(true)}><span>SOS</span></button>
            <button className="danger-button sos-call-button" type="button" onClick={() => setConfirming(true)}>Call Emergency SOS</button>
          </>}
          {confirming && !active && <div role="alert" className="sos-alert"><strong>Start the simulated SOS?</strong><p>This will not dispatch help.</p><button className="danger-button" type="button" onClick={() => { setActive(true); setConfirming(false) }}>Confirm simulation</button><button className="text-link" type="button" onClick={() => setConfirming(false)}>Cancel</button></div>}
          {active && <div role="status" className="sos-active-panel"><strong>Simulated SOS active</strong><p>No dispatch or location sharing occurred.</p><a className="danger-button" href="tel:192"><Phone aria-hidden="true" /> Call Emergency</a><button className="outline-button" type="button" onClick={() => setActive(false)}>End simulated SOS</button></div>}
          <p className="sos-disclaimer">{t('simulation.location')}</p>
        </article>
      </aside>
      <div className="location-main">
        <section className="card location-nearby-panel">
          <h2>Nearby Care in Mandalay</h2>
          <div className="location-nearby-tools">
            <label className="location-search"><Search aria-hidden="true" /><span className="sr-only">Search nearby care in Mandalay</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search hospitals, clinics, labs, pharmacies…" /></label>
            <label className="location-type-select">All Types<select aria-label="Filter by facility type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setFilter('All') }}><option value="All">All Types</option>{FACILITY_FILTERS.filter((item) => item !== 'All').map((item) => <option key={item} value={item}>{FACILITY_FILTER_LABELS[item]}</option>)}</select></label>
          </div>
          <div className="filter-row location-type-filters" aria-label="Facility type filters">{FACILITY_FILTERS.map((item) => <button type="button" key={item} className={`filter-chip${filter === item ? ' active' : ''}`} onClick={() => { setFilter(item); setTypeFilter(item) }}>{FACILITY_FILTER_LABELS[item]}</button>)}</div>
          <div className="location-map google-map-frame">
            <iframe title="Google map showing nearby care around Mandalay" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <ul className="location-map-markers">{visible.map((facility) => {
              const position = mapMarkerPosition(facility)
              return <li key={facility.id} className="location-map-marker" style={position} aria-label={`Map marker for ${facility.name}`} />
            })}</ul>
          </div>
          <div className="facility-list location-facility-list">{visible.map((facility) => <article key={facility.id} className="location-facility-card"><span className="location-facility-thumb" aria-hidden="true"><Building2 /></span><div className="location-facility-copy"><strong>{facility.name}</strong><span>{facility.type} · Mandalay</span></div><span className="location-distance">{facility.distance}</span><small className="location-facility-hours">{facility.hours ?? 'Hours unavailable'}</small><div className="location-facility-actions"><a href="tel:192" className="outline-button"><Phone aria-hidden="true" /> Call</a><a className="outline-button" href={googleMapsDirectionsUrl(facility)} target="_blank" rel="noreferrer" aria-label={`Directions to ${facility.name}`}><Navigation aria-hidden="true" /> Directions</a></div></article>)}{!visible.length && <p className="location-empty">No nearby care of this type in Mandalay.</p>}</div>
        </section>
      </div>
    </div>
  </section>
}

export function SettingsPage() {
  return <PatientSettingsPage />
}
