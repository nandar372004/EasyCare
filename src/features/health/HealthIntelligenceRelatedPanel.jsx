import { useEffect, useMemo, useRef, useState } from 'react'
import { documentHealthIntelligenceService } from '../../services/documentHealthIntelligenceService.js'
import { documentExtractionReviewService } from '../../services/documentExtractionReviewService.js'
import { medicalDocumentService } from '../../services/medicalDocumentService.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { HealthIntelligenceLanguageMode, HealthIntelligenceValue } from './HealthIntelligenceLanguageMode.jsx'

const CATEGORY_TYPES = Object.freeze({
  all: ['lab_result', 'medication_candidate', 'condition_candidate', 'allergy_candidate', 'vital_candidate', 'procedure_candidate', 'follow_up_candidate', 'other'],
  labs: ['lab_result'], medications: ['medication_candidate'],
  conditions: ['condition_candidate', 'allergy_candidate'], vitals: ['vital_candidate'],
  records: ['procedure_candidate'], follow_up: ['follow_up_candidate'],
  other: ['other'],
})

function displayDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function factValue(item) {
  if (item.value_numeric !== null && item.value_numeric !== undefined) {
    return `${item.value_numeric}${item.unit ? ` ${item.unit}` : ''}`
  }
  return item.value_text || item.strength_text || item.frequency_text || item.instruction_text || 'No value was extracted.'
}

const SUMMARY_HEADINGS = Object.freeze({
  en: ['Overall Health Summary:', 'Understanding Your Results:', 'What Does This Mean for You?', 'Health Recommendations:', 'Final Summary:'],
  my: ['ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်', 'စစ်ဆေးမှုရလဒ်များ', 'လူနာအတွက် နားလည်လွယ်သော ရှင်းလင်းချက်', 'ကျန်းမာရေးအကြံပြုချက်များ', 'နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်'],
})
const PRESCRIPTION_HEADINGS = Object.freeze({
  en: ['Overall Treatment Summary', 'Understanding Your Medications', 'Physiotherapy and Daily Care', 'Follow-Up and Warning Signs', 'Final Summary'],
  my: ['ကျန်းမာရေးနှင့် ကုသမှုအခြေအနေ အကျဉ်းချုပ်', 'ဆေးဝါးများအကြောင်း နားလည်လွယ်သော ရှင်းလင်းချက်', 'နေ့စဉ်လိုက်နာသင့်သော အကြံပြုချက်များ', 'ပြန်လည်စစ်ဆေးရန်နှင့် သတိပြုရန်', 'နောက်ဆုံးကျန်းမာရေးအနှစ်ချုပ်'],
})

function parsePreparedSummary(text, language, summaryType) {
  const lines = text.split(/\r?\n/)
  const headings = summaryType === 'prescription' ? PRESCRIPTION_HEADINGS[language] : SUMMARY_HEADINGS[language]
  const canonicalHeading = value => value.trim().replace(/:$/, '')
  const firstHeading = lines.findIndex(line => headings.some(heading => canonicalHeading(heading) === canonicalHeading(line)))
  const metadata = lines.slice(2, firstHeading).filter(Boolean).map(line => {
    const separator = line.indexOf(':')
    return separator < 0 ? null : [line.slice(0, separator), line.slice(separator + 1).trim()]
  }).filter(Boolean)
  const sections = headings.map((heading, index) => {
    const start = lines.findIndex(line => canonicalHeading(line) === canonicalHeading(heading)) + 1
    const nextHeading = headings[index + 1]
    const end = nextHeading ? lines.findIndex((line, lineIndex) => lineIndex >= start && canonicalHeading(line) === canonicalHeading(nextHeading)) : lines.length
    const content = lines.slice(start, end < 0 ? lines.length : end).map(line => line.trim()).filter(Boolean)
    return { heading: heading.replace(/:$/, ''), content }
  })
  const findings = []
  sections[1].content.forEach((line, index, content) => {
    if (/^\d+\.\s/.test(line)) findings.push({ examination: line, result: '', meaning: '' })
    else if (findings.length && line.startsWith('ရလဒ်:')) findings[findings.length - 1].result = line.split(':').slice(1).join(':').trim() || content[index + 1] || ''
    else if (findings.length && /^(Result|ရလဒ்):/.test(line)) findings[findings.length - 1].result = line.replace(/^(Result|ရလဒ්):\s*/, '') || content[index + 1] || ''
    else if (findings.length && /^(Meaning|အခြေအနေ):/.test(line)) findings[findings.length - 1].meaning = line.replace(/^(Meaning|အခြေအနေ):\s*/, '') || content[index + 1] || ''
  })
  const medications = []
  if (summaryType === 'prescription') sections[1].content.forEach(line => {
    if (/^\d+\.\s/.test(line)) medications.push({ medication: line.replace(/^\d+\.\s*/, ''), instructions: '', purpose: '' })
    else if (medications.length && line.startsWith('Instructions:')) medications[medications.length - 1].instructions = line.replace(/^Instructions:\s*/, '')
    else if (medications.length && line.startsWith('Purpose:')) medications[medications.length - 1].purpose = line.replace(/^Purpose:\s*/, '')
    else if (medications.length && line.startsWith('Note:')) medications[medications.length - 1].purpose += ` ${line.replace(/^Note:\s*/, '')}`
  })
  return { metadata, sections: sections.map((section, index) => ({
    ...section,
    ...(index === 1 ? summaryType === 'prescription' ? { medications } : { findings } : {}),
    ...(index === (summaryType === 'prescription' ? 2 : 3) ? { recommendations: section.content.reduce((items, line) => {
      if (/^-\s*/.test(line)) items.push(line.replace(/^-\s*/, ''))
      else if (items.length) items[items.length - 1] += ` ${line}`
      return items
    }, []) } : {}),
  })) }
}

function PreparedSummaryLanguage({ text, language, summaryType }) {
  const data = parsePreparedSummary(text, language, summaryType)
  const findingsHeaders = language === 'en' ? ['Examination', 'Result', 'Meaning'] : ['စစ်ဆေးမှု', 'ရလဒ်', 'အခြေအနေ']
  const medicationHeaders = language === 'en' ? ['Medication', 'Instructions', 'Purpose'] : ['ဆေးဝါး', 'သောက်သုံးရန် / အသုံးပြုပုံ', 'ရည်ရွယ်ချက်']
  return <div className={`prepared-summary-language lang-${language}`} lang={language === 'en' ? 'en' : 'my'}>
    <dl className="prepared-summary-patient-info">{data.metadata.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {data.sections.map((section, index) => <section className={`prepared-summary-section${summaryType === 'prescription' && index === 3 ? ' prepared-summary-warning' : ''}`} key={section.heading}>
      <h4>{section.heading}</h4>
      {index === 1 && summaryType === 'prescription' ? <div className="prepared-summary-findings-wrap"><table className="prepared-summary-findings prepared-summary-medications"><thead><tr>{medicationHeaders.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{section.medications.map(medication => <tr key={medication.medication}><th scope="row">{medication.medication}</th><td data-label={medicationHeaders[1]}>{medication.instructions}</td><td data-label={medicationHeaders[2]}>{medication.purpose}</td></tr>)}</tbody></table></div>
        : index === 1 ? <div className="prepared-summary-findings-wrap"><table className="prepared-summary-findings"><thead><tr>{findingsHeaders.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{section.findings.map(finding => <tr key={finding.examination}><th scope="row">{finding.examination}</th><td data-label={findingsHeaders[1]}>{finding.result}</td><td data-label={findingsHeaders[2]}>{finding.meaning}</td></tr>)}</tbody></table></div>
        : index === (summaryType === 'prescription' ? 2 : 3) ? <ul className="prepared-summary-recommendations">{(section.recommendations || section.content).map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ul>
          : section.content.map((paragraph, itemIndex) => <p key={`${itemIndex}-${paragraph}`}>{paragraph}</p>)}
    </section>)}
  </div>
}

export function HealthIntelligenceRelatedPanel({ category, title, preparedSummary = null, service = documentHealthIntelligenceService, reviewService = documentExtractionReviewService, documentService = medicalDocumentService }) {
  const mode = useOptionalLocalization()?.healthIntelligenceMode ?? 'en'
  const { patient } = useAuth()
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')
  const headingRef = useRef(null)
  const patientId = patient?.id
  const allowedTypes = CATEGORY_TYPES[category] || CATEGORY_TYPES.other

  useEffect(() => {
    let active = true
    setResult(null)
    if (!patientId) return undefined
    service.getForPatient(patientId, { limit: 50, factTypes: allowedTypes })
      .then(data => { if (active) setResult({ patientId, ...data }) })
      .catch(() => { if (active) setResult({ patientId, status: 'error', items: [] }) })
    return () => { active = false }
  }, [patientId, service, attempt, allowedTypes])

  const current = result?.patientId === patientId ? result : null
  const rows = useMemo(() => (current?.items || []).filter(item => allowedTypes.includes(item.fact_type)), [current, allowedTypes])
  const focusedId = new URLSearchParams(window.location.search).get('factId')
  useEffect(() => {
    if (!focusedId) return
    const element = document.getElementById(`health-intelligence-fact-${focusedId}`)
    if (!element) return
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    element.focus?.({ preventScroll: true })
  }, [focusedId, rows])

  useEffect(() => {
    if (!preparedSummary) return
    headingRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    headingRef.current?.focus?.({ preventScroll: true })
  }, [preparedSummary])

  async function review(item, decision) {
    if (busyId) return
    setBusyId(item.fact_id); setActionError('')
    try {
      await reviewService.reviewMyFact({ factId: item.fact_id, decision })
      setAttempt(value => value + 1)
    } catch {
      setActionError('We could not save your review. Refresh and try again.')
    } finally { setBusyId('') }
  }

  async function openSource(item) {
    const popup = window.open('', '_blank')
    if (!popup) { setActionError('Allow pop-ups to open the source document.'); return }
    popup.opener = null
    setBusyId(item.fact_id); setActionError('')
    try {
      const url = await documentService.createSignedUrl({ id: item.source_document_id }, patientId)
      popup.location.replace(url)
    } catch {
      popup.close()
      setActionError('We could not open the source document. Confirm it is still available and try again.')
    } finally { setBusyId('') }
  }

  return <section className="card health-intelligence-section health-intelligence-related" aria-label={`${title} extracted health intelligence`}>
    <div className="section-title"><div><h2 ref={headingRef} tabIndex={-1}>{title}</h2><p>Source-linked candidate information. These entries do not update your medical record.</p></div><HealthIntelligenceLanguageMode /></div>
    {!patientId ? <p role="status">Sign in with a patient account to view extracted information.</p>
      : !current ? <p role="status">Loading extracted information…</p>
      : current.status === 'error' ? <><p role="alert">We could not load extracted information.</p><button className="button button--secondary" type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></>
        : current.status === 'unavailable' ? <p className="dashboard-empty">The source document is unavailable, so its extracted information is hidden.</p>
        : preparedSummary ? <article className="health-intelligence-item" aria-label="Prepared document summary for review">
          <div className="health-intelligence-item-heading"><h3 className="prepared-summary-title">{mode === 'my' ? preparedSummary.titleMyanmar || `${preparedSummary.title} Report Summary` : preparedSummary.titleEnglish || `${preparedSummary.summaryTitle || preparedSummary.title} Report Summary`}</h3></div>
          {mode !== 'my' && <PreparedSummaryLanguage text={preparedSummary.english} language="en" summaryType={preparedSummary.summaryType} />}
          {mode !== 'en' && <PreparedSummaryLanguage text={preparedSummary.myanmar} language="my" summaryType={preparedSummary.summaryType} />}
          <p className="health-intelligence-uncertainty">Prepared document summary for patient review. It is not clinician-confirmed and does not update your medical record.</p>
        </article>
        : rows.length === 0 ? current.extraction_failed
          ? <p className="dashboard-empty">We couldn't prepare extracted information from one or more documents. Your original documents remain available.</p>
          : current.extraction_pending
          ? <p role="status">Extraction is still being prepared. Candidate information will appear here when available.</p>
          : <p className="dashboard-empty">No matching extracted information is available.</p>
          : <ul className="health-intelligence-list">{rows.map(item => <li id={`health-intelligence-fact-${item.fact_id}`} tabIndex={-1} className={`health-intelligence-item${focusedId === item.fact_id ? ' is-focused' : ''}`} key={item.fact_id}>
            <div className="health-intelligence-item-heading"><h3><HealthIntelligenceValue item={item} field="simple_title" mode={mode} as="span" /></h3><span className={`health-intelligence-badge ${item.review_status === 'needs_review' ? 'is-review-needed' : 'is-reviewed'}`}>{item.review_status === 'needs_review' ? 'AI extracted — review needed' : 'Patient reviewed'}</span></div>
            <p><strong>{item.name}:</strong> {factValue(item)}</p>
            {item.reference_range_text && <p><strong>Source reference range:</strong> {item.reference_range_text}</p>}
            {item.short_summary && <p><HealthIntelligenceValue item={item} field="short_summary" mode={mode} /></p>}
            {item.plain_language_explanation && <p><HealthIntelligenceValue item={item} field="plain_language_explanation" mode={mode} /></p>}
            {item.why_it_may_matter && <p className="health-intelligence-context">Why it may matter: <HealthIntelligenceValue item={item} field="why_it_may_matter" mode={mode} /></p>}
            {item.source_context && <p>Source context: {item.source_context}</p>}
            {(item.form_text || item.strength_text || item.frequency_text || item.instruction_text) && <dl className="health-intelligence-fact-details">
              {item.strength_text && <div><dt>Strength or dose mentioned</dt><dd>{item.strength_text}</dd></div>}
              {item.form_text && <div><dt>Form mentioned</dt><dd>{item.form_text}</dd></div>}
              {item.frequency_text && <div><dt>Frequency mentioned</dt><dd>{item.frequency_text}</dd></div>}
              {item.instruction_text && <div><dt>Instruction mentioned</dt><dd>{item.instruction_text}</dd></div>}
            </dl>}
            <p className="health-intelligence-uncertainty">Confidence: {item.confidence_band}. <HealthIntelligenceValue item={item} field="uncertainty_note" mode={mode} /> This is a document-derived candidate, not a diagnosis, prescription, or clinician confirmation.</p>
            <small>Source date: {displayDate(item.source_date)} · {item.source_document_title}{item.source_page ? ` · Page ${item.source_page}` : ''}{item.source_section ? ` · ${item.source_section}` : ''}</small>
            {item.source_excerpt && <small>Source text: {item.source_excerpt}</small>}
            <div className="health-intelligence-related-actions"><button type="button" className="button button--secondary" disabled={Boolean(busyId)} onClick={() => void openSource(item)}>{busyId === item.fact_id ? 'Opening…' : 'View source'}</button>
              {item.review_status === 'needs_review' && <><button type="button" className="button button--secondary" disabled={Boolean(busyId)} onClick={() => void review(item, 'confirmed')}>Mark reviewed</button><button type="button" className="button button--secondary" disabled={Boolean(busyId)} onClick={() => void review(item, 'rejected')}>Not accurate</button></>}
            </div>
          </li>)}</ul>}
    {current?.extraction_pending && rows.length > 0 && <p role="status">Some extracted information is still being prepared.</p>}
    {current?.source_unavailable && rows.length > 0 && <p className="dashboard-empty">An unavailable source was hidden.</p>}
    {actionError && <p role="alert">{actionError}</p>}
  </section>
}
