import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bot, Building2, Check, ChevronRight, CreditCard, MessageSquare, Navigation, Phone, Search, Send, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.jsx'
import { conversations, facilities, invoices, PRESENTATION_ONLY } from './secondaryFixtures.js'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { GUARDIAN_MAX_INPUT_LENGTH } from '../guardian/guardianSafety.js'
import { requestGuardianGuidance } from '../../services/guardianGatewayService.js'

function DemoBanner({ children = PRESENTATION_ONLY, danger = false }) {
  return <div className={`secondary-demo-banner${danger ? ' danger' : ''}`} role="note"><AlertTriangle aria-hidden="true" /> <strong>{children}</strong></div>
}

function PageTitle({ icon: Icon, title, subtitle }) {
  return <header className="page-heading secondary-heading"><div className="secondary-title-icon"><Icon /></div><div><h1>{title}</h1><p>{subtitle}</p></div></header>
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
  const titles = { routine: t('guardian.routineTitle'), soon: 'Clinician review suggested', urgent: t('guardian.urgentTitle'), emergency: t('guardian.emergencyTitle') }
  return <section className="secondary-page guardian-page">
    <PageTitle icon={Bot} title={t('guardian.title')} subtitle={t('guardian.subtitle')} />
    <DemoBanner>{t('guardian.limitation')}</DemoBanner>
    <div className="guardian-layout"><div className="card guardian-chat">
      <div className="guardian-welcome"><Bot /><div><strong>How can this presentation guide you?</strong><p>Try a routine concern, “high fever,” or “chest pain.”</p></div></div>
      {scenario && <article className={`guardian-response ${scenario.riskLevel}`} aria-live="polite"><span>{titles[scenario.riskLevel]}</span><p>{scenario.summary}</p><ul>{scenario.guidance.map(item => <li key={item}>{item}</li>)}</ul></article>}
      <form onSubmit={submit} className="guardian-input"><label htmlFor="guardian-message" className="sr-only">Describe symptoms</label><input id="guardian-message" maxLength={GUARDIAN_MAX_INPUT_LENGTH} value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe a presentation scenario…" /><button className="primary-button" disabled={!message.trim() || checking}><Send /> {checking ? 'Checking safely…' : 'Check scenario'}</button></form>
    </div><aside className="guardian-actions card"><h2>Next actions</h2>{scenario?.riskLevel === 'emergency' ? <><p>{t('guardian.override')}</p><a className="danger-button" href="tel:192"><Phone /> {t('action.callEmergency')}</a></> : <><p>A clinician can provide assessment that this demo cannot.</p><Link className="primary-button" to="/doctors">{t('action.bookAppointment')}</Link><a className="outline-button danger-text" href="tel:192"><Phone /> {t('action.callEmergency')}</a></>}</aside></div>
  </section>
}

export function PaymentsPage() {
  const { t } = useLocalization()
  return <section className="secondary-page"><PageTitle icon={CreditCard} title={t('nav.payments')} subtitle="Synthetic plan and invoice presentation." /><DemoBanner>{t('simulation.payment')}</DemoBanner>
    <div className="payment-summary"><article className="card"><span className="eyebrow">Presentation plan</span><h2>Demo access plan</h2><strong className="large-amount">0 MMK due</strong><p>No subscription, charge, or transaction is created.</p></article><article className="card fake-card"><span className="eyebrow">Simulated payment method</span><h2>Card ending 4242</h2><p>Display only. No card entry or payment SDK is connected.</p></article></div>
    <section className="card invoice-card"><h2>Synthetic invoices</h2><div className="invoice-table"><div className="invoice-head"><span>Invoice</span><span>Date</span><span>Description</span><span>Status</span><span>Amount</span></div>{invoices.map(row => <article key={row.id}><strong>{row.id}</strong><span>{row.date}</span><span>{row.description}</span><span className="status-badge">{row.status}</span><span>{row.amount}</span></article>)}</div></section>
  </section>
}

export function MessagesPage() {
  const { t } = useLocalization()
  const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState(conversations[0].id); const [draft, setDraft] = useState(''); const [local, setLocal] = useState({})
  const visible = conversations.filter(c => `${c.name} ${c.specialty}`.toLowerCase().includes(query.toLowerCase())); const selected = conversations.find(c => c.id === selectedId) || visible[0]
  const send = e => { e.preventDefault(); if (!draft.trim() || !selected) return; setLocal(v => ({ ...v, [selected.id]: [...(v[selected.id] || []), draft.trim()] })); setDraft('') }
  return <section className="secondary-page"><PageTitle icon={MessageSquare} title={t('nav.messages')} subtitle="Synthetic conversations with local-only sending." /><DemoBanner>{t('simulation.messages')}</DemoBanner>
    <div className="messages-layout card"><aside className="conversation-list"><label className="conversation-search"><Search /><input aria-label="Search conversations" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations…" /></label>{visible.map(c => <button className={c.id === selected?.id ? 'active' : ''} key={c.id} onClick={() => setSelectedId(c.id)}><strong>{c.name}</strong><span>{c.specialty}</span><small>{c.preview}</small></button>)}</aside><section className="message-thread">{selected ? <><header><strong>{selected.name}</strong><span>{selected.specialty} · Synthetic conversation</span></header><div className="message-stream">{selected.messages.map((m,i) => <p className="received" key={i}>{m}</p>)}{(local[selected.id] || []).map((m,i) => <p className="sent" key={i}>{m}<small>Local presentation message — not delivered</small></p>)}</div><form onSubmit={send}><input aria-label="Presentation message" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Type a local presentation message…" /><button className="primary-button" disabled={!draft.trim()}><Send /> Send locally</button></form></> : <p>No matching conversations.</p>}</section></div>
  </section>
}

const FACILITY_FILTERS = ['All', 'Hospital', 'Clinic', 'Pharmacy', 'Lab']
const FACILITY_FILTER_LABELS = { All: 'All', Hospital: 'Hospitals', Clinic: 'Clinics', Pharmacy: 'Pharmacies', Lab: 'Labs' }

function formatConsentUpdatedAt(value, locale) {
  if (!value) return 'Not updated yet'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function googleMapsEmbedUrl(filter, searchQuery) {
  const topic = searchQuery.trim() || (filter === 'All' ? 'hospitals and clinics near Yangon Myanmar' : `${filter} near Yangon Myanmar`)
  return `https://maps.google.com/maps?q=${encodeURIComponent(topic)}&z=13&output=embed`
}

function googleMapsDirectionsUrl(facility) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facility.name} Yangon Myanmar`)}`
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
  const visible = useMemo(() => {
    const activeFilter = filter !== 'All' ? filter : (typeFilter !== 'All' ? typeFilter : 'All')
    const query = searchQuery.trim().toLowerCase()
    return facilities.filter((facility) => {
      const matchesFilter = activeFilter === 'All' || facility.type === activeFilter
      const matchesSearch = !query || `${facility.name} ${facility.type}`.toLowerCase().includes(query)
      return matchesFilter && matchesSearch
    })
  }, [filter, typeFilter, searchQuery])
  const mapSrc = googleMapsEmbedUrl(filter !== 'All' ? filter : typeFilter, searchQuery)
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
          <p>Allow EasyCare to access your location to find nearby hospitals and clinics.</p>
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
          <h2>Find Nearby Care</h2>
          <div className="location-nearby-tools">
            <label className="location-search"><Search aria-hidden="true" /><span className="sr-only">Search hospitals and clinics</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search hospitals, clinics…" /></label>
            <label className="location-type-select">All Types<select aria-label="Filter by facility type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setFilter('All') }}><option value="All">All Types</option>{FACILITY_FILTERS.filter((item) => item !== 'All').map((item) => <option key={item} value={item}>{FACILITY_FILTER_LABELS[item]}</option>)}</select></label>
          </div>
          <div className="filter-row location-type-filters" aria-label="Facility type filters">{FACILITY_FILTERS.map((item) => <button type="button" key={item} aria-label={item} className={`filter-chip${filter === item ? ' active' : ''}`} onClick={() => { setFilter(item); setTypeFilter(item) }}>{FACILITY_FILTER_LABELS[item]}</button>)}</div>
          <div className="location-map google-map-frame"><iframe title="Google map showing nearby care around Yangon" src={mapSrc} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>
          <h3 className="location-facilities-heading">Nearby Hospitals &amp; Clinics</h3>
          <div className="facility-list location-facility-list">{visible.map((facility) => <article key={facility.id} className="location-facility-card"><span className="location-facility-thumb" aria-hidden="true"><Building2 /></span><div className="location-facility-copy"><strong>{facility.name}</strong><span>{facility.type}</span></div><span className="location-distance">{facility.distance}</span><small className="location-facility-hours">{facility.hours ?? 'Hours unavailable'}</small><div className="location-facility-actions"><a href="tel:192" className="outline-button"><Phone aria-hidden="true" /> Call</a><a className="outline-button" href={googleMapsDirectionsUrl(facility)} target="_blank" rel="noreferrer" aria-label={`Directions to ${facility.name}`}><Navigation aria-hidden="true" /> Directions</a></div></article>)}{!visible.length && <p className="location-empty">No facilities match your search.</p>}</div>
        </section>
      </div>
    </div>
  </section>
}

export function SettingsPage() {
  const { t, language, setLanguage } = useLocalization()
  const { patient, user, signOut } = useAuth(); const navigate = useNavigate(); const [editing, setEditing] = useState(false); const [saved, setSaved] = useState(false)
  const initialName = patient?.full_name || 'EasyCare Patient'; const [name, setName] = useState(initialName); const [appearance, setAppearance] = useState('Light'); const [notifications, setNotifications] = useState(true)
  const save = e => { e.preventDefault(); setEditing(false); setSaved(true) }; const logout = async () => { await signOut(); navigate('/login', { replace: true }) }
  return <section className="secondary-page"><PageTitle icon={SettingsIcon} title={t('settings.title')} subtitle={t('settings.subtitle')} /><DemoBanner>{t('simulation.settings')}</DemoBanner>
    <div className="settings-grid"><form className="card settings-profile" onSubmit={save}><h2>{t('settings.profile')}</h2><label>{t('settings.displayName')}<input value={name} onChange={e => setName(e.target.value)} disabled={!editing} maxLength={80} /></label><label>{t('settings.email')}<input value={user?.email || 'patient.demo@example.com'} disabled /></label><p>{t('settings.noMedical')}</p>{editing ? <button className="primary-button">{t('settings.saveProfile')}</button> : <button type="button" className="outline-button" onClick={() => {setEditing(true); setSaved(false)}}>{t('settings.editProfile')}</button>}{saved && <span role="status">{t('settings.saved')}</span>}</form>
      <div className="card preference-list"><h2>{t('settings.preferences')}</h2><label>{t('settings.language')}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="my">မြန်မာ</option></select></label><label>{t('settings.appearance')}<select value={appearance} onChange={e => setAppearance(e.target.value)}><option value="Light">{t('settings.light')}</option><option value="System">{t('settings.system')}</option></select></label><label className="toggle-row"><span>{t('settings.notifications')}</span><input type="checkbox" checked={notifications} onChange={e => setNotifications(e.target.checked)} /></label><button className="outline-button danger-text" onClick={logout}>{t('action.logout')}</button></div></div>
  </section>
}
