import { useRef } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { HEALTH_PRESENTATION_NOTICE } from './healthPresentationData.js'

export function HealthPageHeader({ eyebrow, title, titleId, description, presentation = false, children }) {
  return <>
    {presentation && <HealthInfoBanner>{HEALTH_PRESENTATION_NOTICE} Read-only and non-production.</HealthInfoBanner>}
    <header className="page-heading health-page-heading"><div><span className="eyebrow">{eyebrow}</span><h1 id={titleId}>{title}</h1><p>{description}</p></div>{children}</header>
  </>
}

export function HealthInfoBanner({ children }) {
  return <aside className="demo-banner health-info-banner" role="note"><ShieldCheck aria-hidden="true" /><span>{children}</span></aside>
}

export function HealthTabs({ id, tabs, value, onChange, label }) {
  const refs = useRef([])
  function onKeyDown(event, index) {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onChange(tabs[next].value)
    refs.current[next]?.focus()
  }
  return <div className="filter-row health-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button ref={node => { refs.current[index] = node }} id={`${id}-tab-${tab.value}`} type="button" role="tab" aria-selected={value === tab.value} aria-controls={`${id}-panel`} tabIndex={value === tab.value ? 0 : -1} className={`filter-chip${value === tab.value ? ' active' : ''}`} key={tab.value} onClick={() => onChange(tab.value)} onKeyDown={event => onKeyDown(event, index)}>{tab.label}</button>)}
  </div>
}

export function HealthTabPanel({ id, value, children, className = '' }) {
  return <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${value}`} tabIndex="0" className={className}>{children}</div>
}

export function HealthStatusBadge({ status }) {
  const label = String(status || 'Status not recorded').replaceAll('_', ' ')
  return <span className={`status-badge health-status-badge status-${String(status || 'unknown').replaceAll('_', '-')}`}>{label}</span>
}

export function HealthEmptyState({ title, description }) {
  return <div className="card empty-state health-empty-state"><h2>{title}</h2>{description && <p>{description}</p>}</div>
}

export function HealthRecordCard({ record, date, onDetails }) {
  return <article className="health-record-card"><div className="health-record-card-main"><strong>{record.title}</strong><span>{record.type}</span>{date && <small>{date}</small>}</div><button className="button button--secondary" type="button" onClick={onDetails}>View Details</button></article>
}

export function MedicationCard({ medication, onDetails }) {
  return <article className="card medication-card health-medication-card">
    <div className="health-card-main"><h2>{medication.name}</h2><p>{medication.dosage || 'Dose not recorded'} · {medication.frequency || 'Frequency not recorded'}</p>{medication.instructions && <small>{medication.instructions}</small>}{medication.source && <span className="health-source-badge">{medication.source}</span>}{medication.startDate && <small>Started {formatPresentationDateTime(medication.startDate)}</small>}{medication.isPatientReported && <Link className="text-link health-profile-link" to="/settings">Edit in Profile Settings</Link>}</div>
    <HealthStatusBadge status={medication.status} />
    <button className="button button--secondary" type="button" onClick={onDetails}>Details</button>
  </article>
}

export function PrescriptionCard({ prescription, date, onDetails }) {
  return <article className="card prescription-card health-prescription-card">
    <div className="health-card-main"><h2>{prescription.medicine}</h2><p>{prescription.doctor || 'Prescriber not recorded'} · {date}</p>
      <div className="rx-facts"><span>Dosage <strong>{prescription.dosage || 'Not recorded'}</strong></span><span>Frequency <strong>{prescription.frequency || 'Not recorded'}</strong></span><span>Duration <strong>{prescription.duration || 'Not recorded'}</strong></span></div>
      {prescription.instructions && <small>{prescription.instructions}</small>}
    </div>
    <HealthStatusBadge status={prescription.status} />
    <button className="button button--secondary" type="button" onClick={onDetails}>View Details</button>
  </article>
}
