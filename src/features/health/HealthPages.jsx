import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, FileText, HeartPulse, Syringe, X } from 'lucide-react'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { presentationLabResults, presentationPrescriptions } from './healthPresentationData.js'
import { presentationRepository } from '../../services/repositories/index.js'
import { getMyReportedHealthIntake } from '../../services/patientReportedHealthService.js'
import { activePatientMedications, loadPatientMedicationList } from '../../services/patientMedicationListService.js'
import { buildMonitoringWeeklySummaries, patientMonitoringService } from '../../services/patientMonitoringService.js'
import { medicalDocumentService } from '../../services/medicalDocumentService.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { HealthIntelligenceRelatedPanel } from './HealthIntelligenceRelatedPanel.jsx'
import { HealthEmptyState, HealthPageHeader, HealthRecordCard, HealthStatusBadge, HealthTabPanel, HealthTabs, MedicationCard, PrescriptionCard } from './HealthSharedComponents.jsx'

const recordTabs = [{ value: 'All', label: 'All' }, { value: 'Allergy', label: 'Allergies' }, { value: 'Condition', label: 'Conditions' }, { value: 'Vaccination', label: 'Vaccinations' }, { value: 'Document', label: 'Documents' }]
const prescriptionTabs = [{ value: 'active', label: 'Active Prescriptions' }, { value: 'past', label: 'Past Prescriptions' }]
const medicationTabs = [{ value: 'active', label: 'Active Medications' }, { value: 'history', label: 'Medication History' }]
const monitoringDateLabel = value => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : ''

function DetailPanel({ title, onClose, children, presentation = true }) {
  const panel = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.focus()
    const keyboard = event => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) { event.preventDefault(); panel.current.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus?.() }
  }, [onClose])
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={panel} tabIndex="-1" className="health-detail-panel card" role="dialog" aria-modal="true" aria-labelledby="health-detail-title"><button type="button" aria-label="Close details" onClick={onClose}><X aria-hidden="true" /></button>{presentation && <span className="eyebrow">Synthetic details</span>}<h2 id="health-detail-title">{title}</h2>{children}</section></div>
}

export function HealthRecordsPage() {
  const { patient, user, status: authStatus } = useAuth()
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const [healthRecords, setHealthRecords] = useState([])
  const [documents, setDocuments] = useState([])
  const [healthLoading, setHealthLoading] = useState(true)
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [healthError, setHealthError] = useState('')
  const [documentsError, setDocumentsError] = useState('')
  const [monitoringSummaries, setMonitoringSummaries] = useState([])
  const [monitoringError, setMonitoringError] = useState('')
  const [monitoringLoading, setMonitoringLoading] = useState(true)
  const load = useCallback(async () => {
    if (!patient?.id || !user?.id) { if (authStatus !== 'loading') { setHealthError('Unable to load health records. Please try again.'); setDocumentsError('Unable to load documents. Please try again.'); setMonitoringError('Monitoring history is temporarily unavailable.') }; setHealthLoading(false); setDocumentsLoading(false); setMonitoringLoading(false); return }
    setHealthLoading(true); setDocumentsLoading(true); setMonitoringLoading(true); setHealthError(''); setDocumentsError(''); setMonitoringError('')
    const healthTask = getMyReportedHealthIntake().then(reported => {
      setHealthRecords([
        ...(reported.items || []).filter(item => item.source === 'patient_reported' && item.entryKind === 'item' && ['allergy', 'condition'].includes(item.itemType)).map(item => ({
          id: `reported:${item.id}`, title: item.name, type: item.itemType === 'allergy' ? 'Allergy' : 'Condition', date: item.updatedAt || item.createdAt || null,
          detailFields: item.itemType === 'allergy'
            ? [['Reaction', item.details?.reaction], ['Severity / type', item.details?.severity || item.details?.allergenType]]
            : [['Patient note', item.details?.context]],
        })),
        ...(reported.items || []).filter(item => item.itemType === 'vaccination' && item.entryKind === 'item' && item.source === 'patient_reported').map(item => ({
          id: `reported-vaccination:${item.id}`, title: item.name, type: 'Vaccination', date: item.details?.dateGiven || null,
          detailFields: [['Dose', item.details?.doseNumber], ['Date given', item.details?.dateGiven], ['Clinic / location', item.details?.location], ['Notes', item.details?.notes]],
        })),
      ])
    }).catch(() => setHealthError('Unable to load health records. Please try again.')).finally(() => setHealthLoading(false))
    const documentsTask = medicalDocumentService.listMine(user.id).then(rows => {
      setDocuments(rows.map(row => ({ id: `document:${row.id}`, title: row.title || row.original_filename || 'Medical document', type: 'Document', date: row.document_date || row.created_at, detailFields: [['Document type', row.document_type]] })))
    }).catch(() => setDocumentsError('Unable to load documents. Please try again.')).finally(() => setDocumentsLoading(false))
    const monitoringTask = Promise.all([patientMonitoringService.listMyPlans(), patientMonitoringService.listMyCheckIns()]).then(([plans, checkIns]) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
      const part = type => parts.find(item => item.type === type)?.value
      const asOfDate = `${part('year')}-${part('month')}-${part('day')}`
      setMonitoringSummaries(buildMonitoringWeeklySummaries({ plans, checkIns, asOfDate }))
    }).catch(() => setMonitoringError('Monitoring history is temporarily unavailable.')).finally(() => setMonitoringLoading(false))
    await Promise.allSettled([healthTask, documentsTask, monitoringTask])
  }, [authStatus, patient?.id, user?.id])
  useEffect(() => { void load() }, [load])
  const records = [...healthRecords, ...documents]
  const filtered = filter === 'All' ? records : records.filter((item) => item.type === filter)
  const counts = Object.fromEntries(recordTabs.slice(1).map(tab => [tab.value, records.filter(item => item.type === tab.value).length]))
  if (authStatus === 'loading') return <section><h1>Health Records</h1><p role="status">Loading health records…</p></section>
  return <section className="health-feature-page"><HealthPageHeader eyebrow="Your health records" title="Health Records" description="Browse your allergies, conditions, vaccinations, and uploaded documents." presentation={false} />
    <section className="card health-monitoring-history" aria-labelledby="health-monitoring-title"><header><HeartPulse aria-hidden="true" /><div><h2 id="health-monitoring-title">Monitoring</h2><p>Recent readings recorded in My Care Plan</p></div></header>
      {monitoringLoading && <p role="status">Loading monitoring history…</p>}{monitoringError && <p role="status">{monitoringError}</p>}
      {!monitoringLoading && !monitoringError && !monitoringSummaries.length && <p>No monitoring readings recorded in the last 7 days.</p>}
      {!monitoringLoading && monitoringSummaries.map(item => <article key={`${item.planId}:${item.weekStart}`} className="health-monitoring-summary"><div><h3>{item.title}</h3><p>{monitoringDateLabel(item.weekStart)} – {monitoringDateLabel(item.weekEnd)}</p><p>{item.readingCount} {item.readingCount === 1 ? 'reading' : 'readings'} · {item.completedOccurrences} / {item.scheduledOccurrences} scheduled occurrences completed</p></div>
        {item.measurementType === 'blood_pressure' ? <p><strong>Average:</strong> {item.average7Days.systolic ?? '—'} / {item.average7Days.diastolic ?? '—'} {item.measurementUnit}</p> : <p><strong>Average:</strong> {item.average7Days.value ?? '—'} {item.measurementUnit}</p>}
        {item.latest && <p><strong>Latest:</strong> {item.latest.systolicValue != null ? `${item.latest.systolicValue} / ${item.latest.diastolicValue} ${item.measurementUnit}` : `${item.latest.value} ${item.measurementUnit}`} · {monitoringDateLabel(item.latest.localDate)}</p>}
        <details><summary>View History</summary><ul>{item.readings.slice().sort((a,b) => b.localDate.localeCompare(a.localDate)).map(row => <li key={row.id}>{monitoringDateLabel(row.localDate)} · {row.systolicValue != null ? `${row.systolicValue} / ${row.diastolicValue}` : row.measurementValue} {row.measurementUnit || item.measurementUnit} · Done</li>)}</ul></details>
      </article>)}
    </section>
    <div className="health-overview-grid"><OverviewCard label="Allergies" value={counts.Allergy} icon={AlertCircle} /><OverviewCard label="Conditions" value={counts.Condition} icon={HeartPulse} /><OverviewCard label="Vaccinations" value={counts.Vaccination} icon={Syringe} /><OverviewCard label="Documents" value={counts.Document} icon={FileText} /></div>
    <HealthTabs id="health-records" tabs={recordTabs} value={filter} onChange={setFilter} label="Filter health records" />
    {(healthLoading || documentsLoading) && <p role="status">{healthLoading ? 'Loading health information…' : 'Loading documents…'}</p>}
    {healthError && <p role="alert">{healthError} <button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button></p>}
    {documentsError && <p role="alert">{documentsError} <button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button></p>}
    <HealthTabPanel id="health-records" value={filter} className="health-record-list card">
      {filtered.length ? filtered.map(record => <HealthRecordCard key={record.id} record={record} date={record.date ? formatPresentationDateTime(record.date) : null} onDetails={() => setSelected(record)} />) : <HealthEmptyState title="No records in this category" description="Health records will appear here when available." />}
    </HealthTabPanel>
    {selected && <DetailPanel title={selected.title} presentation={false} onClose={() => setSelected(null)}><dl>{(selected.detailFields || []).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{label === 'Date given' ? formatPresentationDateTime(value) : value}</dd></div>)}{selected.date && selected.type !== 'Vaccination' && <div><dt>Date</dt><dd>{formatPresentationDateTime(selected.date)}</dd></div>}</dl></DetailPanel>}
  </section>
}

function OverviewCard({ label, value, icon: Icon }) { return <article className="card health-overview-card"><div><span>{label}</span><strong>{value}</strong></div><Icon aria-hidden="true" /></article> }

export function PrescriptionsPage() {
  const { patient, status: authStatus } = useAuth()
  const [tab, setTab] = useState('active')
  const [prescriptions, setPrescriptions] = useState(presentationRepository.metadata.isSynthetic ? presentationPrescriptions : [])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(!presentationRepository.metadata.isSynthetic)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (presentationRepository.metadata.isSynthetic) { setPrescriptions(presentationPrescriptions); setLoading(false); return }
    if (!patient?.id) { if (authStatus !== 'loading') setError('Unable to load prescriptions. Please try again.'); setLoading(false); return }
    setLoading(true); setError('')
    try { setPrescriptions(await presentationRepository.listPrescriptions(patient.id)) }
    catch { setError('Unable to load prescriptions. Please try again.') }
    finally { setLoading(false) }
  }, [authStatus, patient?.id])
  useEffect(() => { void load() }, [load])
  const visible = prescriptions.filter(item => (item.status === 'active' ? 'active' : 'past') === tab)
  if (loading || authStatus === 'loading') return <section><h1>Prescriptions</h1><p role="status">Loading prescriptions…</p></section>
  if (error) return <section className="card empty-state"><h1>Prescriptions</h1><p role="alert">{error}</p><button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button></section>
  return <section className="health-feature-page"><HealthPageHeader eyebrow="Prescription records" title="Prescriptions" description="What a clinician prescribed, including the recorded directions." presentation={presentationRepository.metadata.isSynthetic} />
    <HealthTabs id="prescriptions" tabs={prescriptionTabs} value={tab} onChange={setTab} label="Prescription history" />
    <HealthTabPanel id="prescriptions" value={tab} className="prescription-list">{visible.length ? visible.map(item => <PrescriptionCard key={`${item.id}:${item.itemId || 'item'}`} prescription={item} date={formatPresentationDateTime(item.issuedAt)} onDetails={() => setSelected(item)} />) : <HealthEmptyState title="No prescriptions in this section" />}</HealthTabPanel>
    {selected && <DetailPanel title={selected.medicine} presentation={presentationRepository.metadata.isSynthetic} onClose={() => setSelected(null)}><h3>Prescription Information</h3><dl><div><dt>Medicine</dt><dd>{selected.medicine}</dd></div><div><dt>Strength</dt><dd>{selected.strength || 'Not recorded'}</dd></div><div><dt>Dosage</dt><dd>{selected.dosage || 'Not recorded'}</dd></div><div><dt>Frequency</dt><dd>{selected.frequency || 'Not recorded'}</dd></div><div><dt>Duration</dt><dd>{selected.duration || 'Not recorded'}</dd></div><div><dt>Instructions</dt><dd>{selected.instructions || 'Not recorded'}</dd></div><div><dt>Prescribed by</dt><dd>{selected.doctor || 'Prescriber not recorded'}</dd></div><div><dt>Prescription date</dt><dd>{formatPresentationDateTime(selected.issuedAt)}</dd></div><div><dt>Status</dt><dd><HealthStatusBadge status={selected.status} /></dd></div></dl><section className="medicine-guidance"><h3>About This Medicine</h3>{selected.instructions && <p><strong>Recorded usage instructions:</strong> {selected.instructions}</p>}<p>No additional medicine guidance has been recorded.</p></section>{presentationRepository.metadata.isSynthetic && <p className="health-synthetic-detail">This is synthetic presentation information, not a valid prescription or medical document.</p>}</DetailPanel>}
  </section>
}

export function LabResultsPage() {
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const filtered = filter === 'All' ? presentationLabResults : presentationLabResults.filter((item) => item.status === filter)
  return <section><HealthPageHeader eyebrow="Requires interpretation" title="Lab Results" description="Synthetic laboratory results for layout demonstration." presentation />
    <div className="interpretation-warning"><AlertCircle aria-hidden="true" /><strong>Lab results require interpretation by a qualified clinician. No clinician review is connected here.</strong></div>
    <HealthIntelligenceRelatedPanel category="labs" title="Extracted Lab Results" />
    <div className="filter-row">{['All', 'Presentation normal', 'Demo flag'].map((item) => <button className={`filter-chip${filter === item ? ' active' : ''}`} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="lab-table card"><div className="lab-table-head"><span>Test</span><span>Date</span><span>Lab</span><span>Status</span><span>Action</span></div>{filtered.map((item) => <article key={item.id}><strong>{item.test}</strong><span>{formatPresentationDateTime(item.date)}</span><span>{item.lab}</span><span className="status-badge">{item.status}</span><button className="text-link" onClick={() => setSelected(item)}>View Details</button></article>)}</div>
    {selected && <DetailPanel title={selected.test} onClose={() => setSelected(null)}><p>{selected.summary}</p><p><strong>This synthetic result cannot be used for medical decisions and requires clinician interpretation in real care.</strong></p></DetailPanel>}
  </section>
}

export function MedicationsPage() {
  const { patient, status: authStatus } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('active')
  const [medications, setMedications] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    if (!patient?.id) { if (authStatus !== 'loading') setError('Unable to load medications. Please try again.'); setLoading(false); return }
    try {
      setMedications(await loadPatientMedicationList(patient.id))
    }
    catch { setError('Unable to load medications. Please try again.') }
    finally { setLoading(false) }
  }, [authStatus, patient?.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const requestedId = location.state?.medicationId
    if (!requestedId || loading) return
    const match = medications.find(item => item.id === requestedId)
    if (match) setSelected(match)
    navigate('/medications', { replace: true, state: null })
  }, [location.state, loading, medications, navigate])
  if (loading || authStatus === 'loading') return <section><h1>Medications</h1><p role="status">Loading medications…</p></section>
  if (error) return <section className="card empty-state"><h1>Medications</h1><p role="alert">{error}</p><button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button></section>
  const visible = tab === 'active' ? activePatientMedications(medications) : medications.filter(item => item.status !== 'active')
  return <section className="health-feature-page"><HealthPageHeader presentation={false} eyebrow="Medication records" title="Medications" description="What you are currently taking or have taken, based on your recorded medication history." />
    <HealthTabs id="medications" tabs={medicationTabs} value={tab} onChange={setTab} label="Medication history" />
    <HealthTabPanel id="medications" value={tab} className="medication-list">{visible.length ? visible.map(item => <MedicationCard key={item.id} medication={item} onDetails={() => setSelected(item)} />) : <HealthEmptyState title="No medications found" description="Medication records will appear here when available." />}</HealthTabPanel>
    {selected && <DetailPanel title={selected.name} presentation={presentationRepository.metadata.isSynthetic} onClose={() => setSelected(null)}><h3>Medication Information</h3><dl><div><dt>Medicine</dt><dd>{selected.name}</dd></div><div><dt>Strength / dose</dt><dd>{selected.dosage || 'Not recorded'}</dd></div><div><dt>Frequency</dt><dd>{selected.frequency || 'Not recorded'}</dd></div><div><dt>Instructions</dt><dd>{selected.instructions || 'Not recorded'}</dd></div><div><dt>Status</dt><dd><HealthStatusBadge status={selected.status} /></dd></div><div><dt>Start date</dt><dd>{selected.startDate ? formatPresentationDateTime(selected.startDate) : 'Not recorded'}</dd></div>{selected.source && <div><dt>Source</dt><dd>{selected.source}</dd></div>}{selected.relatedPrescription && <div><dt>Related prescription</dt><dd>{selected.relatedPrescription}</dd></div>}</dl>{selected.reasonForMedication && <section className="medicine-guidance"><h3>About This Medicine</h3><p><strong>Recorded purpose:</strong> {selected.reasonForMedication}</p></section>}</DetailPanel>}
  </section>
}
