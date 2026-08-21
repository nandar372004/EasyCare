import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Beaker, CheckCircle2, Download, FileHeart, FileText, HeartPulse, Pill, ShieldCheck, Syringe, X } from 'lucide-react'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { HEALTH_PRESENTATION_NOTICE, healthOverview, healthRecords, presentationLabResults, presentationMedications, presentationPrescriptions } from './healthPresentationData.js'

function HealthHeader({ eyebrow, title, description, children }) {
  return <><section className="demo-banner" role="note"><ShieldCheck aria-hidden="true" /><span><strong>{HEALTH_PRESENTATION_NOTICE}</strong> Read-only and non-production.</span></section><header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</header></>
}

function DetailPanel({ title, onClose, children }) {
  const panel = useRef(null)
  useEffect(() => { const previous = document.activeElement; panel.current?.focus(); const escape = (event) => { if (event.key === 'Escape') onClose() }; document.addEventListener('keydown', escape); return () => { document.removeEventListener('keydown', escape); previous?.focus?.() } }, [onClose])
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={panel} tabIndex="-1" className="health-detail-panel card" role="dialog" aria-modal="true" aria-labelledby="health-detail-title"><button type="button" aria-label="Close details" onClick={onClose}><X aria-hidden="true" /></button><span className="eyebrow">Synthetic details</span><h2 id="health-detail-title">{title}</h2>{children}</section></div>
}

export function HealthRecordsPage() {
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const filtered = filter === 'All' ? healthRecords : healthRecords.filter((item) => item.type === filter)
  return <section><HealthHeader eyebrow="Read-only presentation" title="Health Records" description="Browse synthetic health information. This is not a full electronic health record." />
    <div className="health-overview-grid"><OverviewCard label="Allergies" value={healthOverview.allergies.length} icon={AlertCircle} /><OverviewCard label="Conditions" value={healthOverview.conditions.length} icon={HeartPulse} /><OverviewCard label="Vaccinations" value={1} icon={Syringe} /><OverviewCard label="Documents" value={1} icon={FileText} /></div>
    <div className="filter-row">{['All', 'Allergy', 'Condition', 'Vaccination', 'Document'].map((item) => <button className={`filter-chip${filter === item ? ' active' : ''}`} type="button" key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="health-record-list card">{filtered.map((record) => <article key={record.id}><span className="health-record-icon"><FileHeart aria-hidden="true" /></span><div><strong>{record.title}</strong><small>{record.type} · {record.source} · {formatPresentationDateTime(record.date)}</small></div><button className="button button--secondary" type="button" onClick={() => setSelected(record)}>View Details</button></article>)}</div>
    {selected && <DetailPanel title={selected.title} onClose={() => setSelected(null)}><p>{selected.detail}</p><dl><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Source</dt><dd>{selected.source}</dd></div><div><dt>Date</dt><dd>{formatPresentationDateTime(selected.date)}</dd></div></dl></DetailPanel>}
  </section>
}

function OverviewCard({ label, value, icon: Icon }) { return <article className="card health-overview-card"><div><span>{label}</span><strong>{value}</strong></div><Icon aria-hidden="true" /></article> }

export function PrescriptionsPage() {
  const [tab, setTab] = useState('active')
  const [selected, setSelected] = useState(null)
  const [downloadNotice, setDownloadNotice] = useState(false)
  return <section><HealthHeader eyebrow="Read-only presentation" title="Prescriptions" description="Synthetic prescription history for interface demonstration only." />
    <div className="filter-row">{['active', 'past'].map((item) => <button className={`filter-chip${tab === item ? ' active' : ''}`} key={item} onClick={() => setTab(item)}>{item === 'active' ? 'Active Prescriptions' : 'Past Prescriptions'}</button>)}</div>
    {downloadNotice && <div className="lifecycle-feedback success" role="status"><CheckCircle2 aria-hidden="true" /><span>No document was generated. A false prescription cannot be downloaded from this presentation.</span><button onClick={() => setDownloadNotice(false)}>×</button></div>}
    <div className="prescription-list">{presentationPrescriptions.filter((item) => item.status === tab).map((item) => <article className="card prescription-card" key={item.id}><span className="health-record-icon"><FileText aria-hidden="true" /></span><div><h2>{item.medicine}</h2><p>{item.doctor} · Issued {formatPresentationDateTime(item.issuedAt)}</p><div className="rx-facts"><span>Dosage <strong>{item.dosage}</strong></span><span>Frequency <strong>{item.frequency}</strong></span><span>Duration <strong>{item.duration}</strong></span></div></div><div className="health-actions"><button className="button button--secondary" onClick={() => setSelected(item)}>View Details</button><button className="button button--secondary" onClick={() => setDownloadNotice(true)}><Download aria-hidden="true" /> Download unavailable</button></div></article>)}</div>
    {selected && <DetailPanel title={selected.medicine} onClose={() => setSelected(null)}><p>{selected.instructions}</p><p><strong>This is not a valid prescription or medical document.</strong></p></DetailPanel>}
  </section>
}

export function LabResultsPage() {
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const filtered = filter === 'All' ? presentationLabResults : presentationLabResults.filter((item) => item.status === filter)
  return <section><HealthHeader eyebrow="Requires interpretation" title="Lab Results" description="Synthetic laboratory results for layout demonstration." />
    <div className="interpretation-warning"><AlertCircle aria-hidden="true" /><strong>Lab results require interpretation by a qualified clinician. No clinician review is connected here.</strong></div>
    <div className="filter-row">{['All', 'Presentation normal', 'Demo flag'].map((item) => <button className={`filter-chip${filter === item ? ' active' : ''}`} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="lab-table card"><div className="lab-table-head"><span>Test</span><span>Date</span><span>Lab</span><span>Status</span><span>Action</span></div>{filtered.map((item) => <article key={item.id}><strong>{item.test}</strong><span>{formatPresentationDateTime(item.date)}</span><span>{item.lab}</span><span className="status-badge">{item.status}</span><button className="text-link" onClick={() => setSelected(item)}>View Details</button></article>)}</div>
    {selected && <DetailPanel title={selected.test} onClose={() => setSelected(null)}><p>{selected.summary}</p><p><strong>This synthetic result cannot be used for medical decisions and requires clinician interpretation in real care.</strong></p></DetailPanel>}
  </section>
}

export function MedicationsPage() {
  const [tab, setTab] = useState('active')
  const [taken, setTaken] = useState({})
  const [selected, setSelected] = useState(null)
  return <section><HealthHeader eyebrow="Local presentation state" title="Medications" description="Synthetic schedules. Taken/pending choices remain only in this browser view." />
    <div className="filter-row">{['active', 'completed'].map((item) => <button className={`filter-chip${tab === item ? ' active' : ''}`} key={item} onClick={() => setTab(item)}>{item === 'active' ? "Today's Schedule" : 'Completed'}</button>)}</div>
    <div className="medication-list">{presentationMedications.filter((item) => item.status === tab).map((item) => <article className="card medication-card" key={item.id}><span className="health-record-icon"><Pill aria-hidden="true" /></span><div><h2>{item.name}</h2><p>{item.dosage} · {item.schedule}</p></div><span className="med-stock">{item.stock}</span>{tab === 'active' && <button className={`med-toggle${taken[item.id] ? ' taken' : ''}`} type="button" aria-pressed={!!taken[item.id]} onClick={() => setTaken((current) => ({ ...current, [item.id]: !current[item.id] }))}>{taken[item.id] ? <><CheckCircle2 aria-hidden="true" /> Taken</> : 'Pending'}</button>}<button className="button button--secondary" onClick={() => setSelected(item)}>Details</button></article>)}</div>
    {selected && <DetailPanel title={selected.name} onClose={() => setSelected(null)}><p>{selected.instructions}</p><p>The taken/pending control is a temporary presentation interaction and is not saved as a medical record.</p></DetailPanel>}
  </section>
}
