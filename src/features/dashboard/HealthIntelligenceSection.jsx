import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { documentHealthIntelligenceService } from '../../services/documentHealthIntelligenceService.js'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { HealthIntelligenceLanguageMode, HealthIntelligenceValue } from '../health/HealthIntelligenceLanguageMode.jsx'

function displayDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function HealthIntelligenceCards({ section, person = 'your health records', onOpenSource, onRetry }) {
  const mode = useOptionalLocalization()?.healthIntelligenceMode ?? 'en'
  const [openingId, setOpeningId] = useState('')
  const [sourceError, setSourceError] = useState('')
  const rows = section?.items || []

  async function openSource(item) {
    if (!onOpenSource || openingId) return
    setOpeningId(item.source_document_id); setSourceError('')
    try { await onOpenSource(item) }
    catch { setSourceError('We could not open this source document. Confirm that records access is still active and try again.') }
    finally { setOpeningId('') }
  }

  return <article className="card health-intelligence-section" aria-label="Health Intelligence">
    <div className="section-title"><div><h2>Health Intelligence</h2><p>Important updates from {person}, kept linked to their source.</p></div><HealthIntelligenceLanguageMode /></div>
    {!section || section.status === 'loading' ? <p role="status">Loading health intelligence…</p>
      : section.status === 'not_authorized' ? <p className="dashboard-empty">Health information has not been shared with you.</p>
        : section.status === 'expired' || section.status === 'revoked' ? <p className="dashboard-empty">Health intelligence is hidden because records access is no longer active.</p>
            : section.status === 'error' ? <><p className="dashboard-compact-state" role="alert">Temporarily unavailable.</p>{onRetry && <button className="button button--secondary" type="button" onClick={onRetry}>Retry</button>}</>
            : section.status === 'unavailable' ? <p className="dashboard-empty">A source document is unavailable, so its insight is hidden.</p>
              : rows.length === 0 ? section.extraction_failed
                ? <p className="dashboard-empty">We couldn't prepare health intelligence from one or more documents. Your original documents remain available.</p>
                : section.extraction_pending
                ? <p role="status">Health information is still being prepared. Candidate facts will appear here when available for review.</p>
                : <p className="dashboard-empty">No health intelligence is available yet.</p>
                : <>
                  <ul className="health-intelligence-list">{rows.map(item => <li className="health-intelligence-item" key={item.fact_id}>
                    <div className="health-intelligence-item-heading"><h3><HealthIntelligenceValue item={item} field="simple_title" mode={mode} as="span" /></h3>
                      <span className={`health-intelligence-badge ${item.review_status === 'needs_review' ? 'is-review-needed' : 'is-reviewed'}`}>
                        {item.review_status === 'needs_review' ? 'AI extracted — review needed' : 'Patient reviewed'}
                      </span>
                    </div>
                    <p><HealthIntelligenceValue item={item} field="short_summary" mode={mode} /></p>
                    {item.review_message && <small className="health-intelligence-review-message"><HealthIntelligenceValue item={item} field="review_message" mode={mode} /></small>}
                    {item.why_it_may_matter && <p className="health-intelligence-context"><HealthIntelligenceValue item={item} field="why_it_may_matter" mode={mode} /></p>}
                    {item.attention_level === 'source_flagged' && <span className="health-intelligence-badge">Source marks this result abnormal</span>}
                    <small>Confidence: {item.confidence_band} · Source: {item.source_document_title}{item.source_page ? ` · Page ${item.source_page}` : ''}</small>
                    <small>Source date: {displayDate(item.source_date)}</small>
                    <p className="health-intelligence-uncertainty"><HealthIntelligenceValue item={item} field="uncertainty_note" mode={mode} /></p>
                    {onOpenSource
                      ? <button type="button" className="button button--secondary" disabled={Boolean(openingId)} onClick={() => void openSource(item)}>{openingId === item.source_document_id ? 'Opening source…' : 'Open source document'}</button>
                      : <Link className="button button--secondary" to={item.related_tab_destination}>View related details</Link>}
                  </li>)}</ul>
                  {section.total_count > rows.length && <p><Link to="/medical-documents">View all source documents</Link></p>}
                  {section.extraction_pending && <p role="status">Some extracted information is still being prepared for review.</p>}
                  {section.source_unavailable && <p className="dashboard-empty">An unavailable source was hidden.</p>}
                </>}
    {sourceError && <p role="alert">{sourceError}</p>}
  </article>
}

export function PatientHealthIntelligenceSection({ patientId, service = documentHealthIntelligenceService }) {
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setResult(null)
    if (!patientId) return undefined
    service.getForPatient(patientId, { limit: 3 }).then(data => { if (active) setResult({ patientId, ...data }) })
      .catch(() => { if (active) setResult({ patientId, status: 'error', items: [] }) })
    return () => { active = false }
  }, [patientId, service, attempt])
  const current = result?.patientId === patientId ? result : null
  return <HealthIntelligenceCards section={current || { status: patientId ? 'loading' : 'error', items: [] }} onRetry={() => setAttempt(value => value + 1)} />
}

export function FamilyHealthIntelligenceSection({ section, person, onOpenSource, onRetry }) {
  const data = section?.status === 'ready' ? section.data : null
  const displaySection = section?.status === 'ready' ? (data || { status: 'ready', items: [] }) : section
  return <HealthIntelligenceCards section={displaySection} person={person} onOpenSource={onOpenSource} onRetry={onRetry} />
}
