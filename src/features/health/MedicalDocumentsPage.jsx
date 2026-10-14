import { useCallback, useEffect, useRef, useState } from 'react'
import { FileHeart, FileText, ImagePlus, Upload, X } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.jsx'
import { MEDICAL_DOCUMENT_TYPES } from '../../../supabase/functions/_shared/medical-document-contract.js'
import { medicalDocumentService } from '../../services/medicalDocumentService.js'
import { isRealDocumentPipelineAvailable, realDocumentPipelineService } from '../../services/realDocumentPipelineService.js'
import { HealthIntelligenceRelatedPanel } from './HealthIntelligenceRelatedPanel.jsx'
import { HealthPageHeader } from './HealthSharedComponents.jsx'
import { getPreparedDocumentSummary } from '../../services/preparedDocumentSummaries.js'

const DOCUMENT_LABELS = Object.freeze({
  discharge_summary: 'Discharge Summary', lab_report: 'Lab Report', prescription: 'Prescription',
  procedure_report: 'Procedure Report', imaging_report: 'Imaging Report',
  medical_certificate: 'Medical Certificate', other: 'Other Medical Document',
})
const ACCEPTED_FILES = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png'

function localDate(value) {
  if (!value) return 'Not provided'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.valueOf()) ? 'Not provided' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed)
}

function uploadedDate(value) {
  if (!value) return 'Date unavailable'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed)
}

export function MedicalDocumentsPage({ service = medicalDocumentService }) {
  const { patient, user } = useAuth()
  const photoInput = useRef(null)
  const fileInput = useRef(null)
  const operationLock = useRef(false)
  const preparedTimer = useRef(null)
  const [documents, setDocuments] = useState([])
  const [documentType, setDocumentType] = useState('other')
  const [documentDate, setDocumentDate] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removeTarget, setRemoveTarget] = useState(null)
  const [openingDocumentId, setOpeningDocumentId] = useState(null)
  const [processingDocumentId, setProcessingDocumentId] = useState(null)
  const [relatedPanelRevision, setRelatedPanelRevision] = useState(0)
  const [preparedSummary, setPreparedSummary] = useState(null)

  const load = useCallback(async () => {
    if (!patient?.id || !user?.id) { setDocuments([]); setError('We could not confirm your patient account. Sign in again and try once more.'); setLoading(false); return false }
    setLoading(true); setError('')
    try { setDocuments(await service.listMine(user.id)); return true }
    catch { setError('We could not load your medical documents. Please try again.'); return false }
    finally { setLoading(false) }
  }, [patient?.id, service, user?.id])

  useEffect(() => { void load() }, [load])

  useEffect(() => () => {
    if (preparedTimer.current) clearTimeout(preparedTimer.current)
  }, [])

  useEffect(() => {
    if (loading || !window.location.hash) return
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
    if (!target) return
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    target.focus?.({ preventScroll: true })
  }, [documents, loading])

  function selectFile(event) {
    setFile(event.target.files?.[0] ?? null)
    setError(''); setNotice('')
    event.target.value = ''
  }

  async function upload(event) {
    event.preventDefault()
    if (!file || busy || operationLock.current || !patient?.id || !user?.id) return
    operationLock.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await service.upload({ file, documentType, title, documentDate })
      setFile(null); setTitle(''); setDocumentDate('')
      const refreshed = await load()
      if (refreshed) setNotice('Medical document uploaded. It remains source evidence and has not been interpreted.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We could not upload this document. Please try again.')
    } finally { operationLock.current = false; setBusy(false) }
  }

  async function openDocument(document, download = false) {
    if (openingDocumentId) return
    setOpeningDocumentId(document.id)
    setError(''); setNotice('')
    let documentWindow
    try {
      documentWindow = window.open('', '_blank')
      if (!documentWindow) throw new Error('Allow pop-ups to open this document, then try again.')
      documentWindow.opener = null
      const url = await service.createSignedUrl(document, undefined, { download })
      documentWindow.location.replace(url)
    } catch (failure) {
      documentWindow?.close()
      setError(failure instanceof Error ? failure.message : 'We could not open this document. Please try again.')
    }
    finally { setOpeningDocumentId(null) }
  }

  async function removeDocument() {
    if (!removeTarget || busy || operationLock.current || removeTarget.uploaded_by_profile_id !== user?.id) return
    operationLock.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await service.remove(removeTarget.id)
      setRemoveTarget(null)
      const refreshed = await load()
      setRelatedPanelRevision(value => value + 1)
      if (refreshed) setNotice('Document removed from your record.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'We could not safely remove this document. Please try again.')
    } finally { operationLock.current = false; setBusy(false) }
  }

  async function processDocumentWithModel(document) {
    if (processingDocumentId || document.source !== 'patient_upload' || document.status !== 'active') return
    const summary = getPreparedDocumentSummary(document.title) || getPreparedDocumentSummary(document.original_filename)
    if (summary) {
      if (preparedTimer.current) return
      setError(''); setNotice(''); setProcessingDocumentId(document.id)
      preparedTimer.current = setTimeout(() => {
        preparedTimer.current = null
        setPreparedSummary({ documentId: document.id, summary })
        setProcessingDocumentId(null)
      }, 3000)
      return
    }
    setPreparedSummary(null)
    if (!isRealDocumentPipelineAvailable) return
    setProcessingDocumentId(document.id); setError(''); setNotice('')
    try {
      const result = await realDocumentPipelineService.processDocument(document.id)
      setRelatedPanelRevision(value => value + 1)
      setNotice(`Ready for review. ${result.candidate_count} candidate fact${result.candidate_count === 1 ? ' needs' : 's need'} your review. No medical record was updated.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Document processing failed. Please try again.')
    } finally { setProcessingDocumentId(null) }
  }

  return <section className="medical-documents-page" aria-labelledby="medical-documents-title">
    <HealthPageHeader eyebrow="Private source documents" title="Medical Documents" titleId="medical-documents-title" description="Keep your reports and medical files together. Extracted information stays linked to its source and requires your review." />
    <HealthIntelligenceRelatedPanel key={relatedPanelRevision} category="all" title="Extracted Health Intelligence" preparedSummary={preparedSummary?.summary ?? null} />

    <form className="card medical-document-upload" onSubmit={upload}>
      <div><span className="medical-document-upload-icon"><Upload aria-hidden="true" /></span><div><h2>Upload Medical Document</h2><p>PDF, JPG, JPEG, or PNG · up to 10 MB</p></div></div>
      <div className="medical-document-source-actions" aria-label="Choose a document file">
        <button type="button" className="button button--secondary" onClick={() => photoInput.current?.click()} disabled={busy}><ImagePlus aria-hidden="true" /> Choose Photo</button>
        <button type="button" className="button button--secondary" onClick={() => fileInput.current?.click()} disabled={busy}><FileText aria-hidden="true" /> Choose File</button>
        <input ref={photoInput} className="medical-document-hidden-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={selectFile} aria-label="Choose an existing medical document photo" />
        <input ref={fileInput} className="medical-document-hidden-input" type="file" accept={ACCEPTED_FILES} onChange={selectFile} aria-label="Choose a medical document file" />
      </div>
      {file && <p className="medical-document-selected" role="status">Selected: <strong>{file.name}</strong> ({Math.max(1, Math.ceil(file.size / 1024))} KB)</p>}
      <div className="medical-document-fields">
        <label>Document Type<select value={documentType} onChange={event => setDocumentType(event.target.value)} disabled={busy}>{MEDICAL_DOCUMENT_TYPES.map(type => <option key={type} value={type}>{DOCUMENT_LABELS[type]}</option>)}</select></label>
        <label>Document Date <span>(optional)</span><input type="date" value={documentDate} onChange={event => setDocumentDate(event.target.value)} disabled={busy} /></label>
        <label className="medical-document-title-field">Title <span>(optional)</span><input type="text" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Add a short title" disabled={busy} /></label>
      </div>
      <button className="button button--primary" type="submit" disabled={!file || busy || !patient?.id || !user?.id}>{busy ? 'Uploading…' : 'Upload'}</button>
      <p className="medical-document-privacy">Files are stored privately. Only you and people whose existing clinical record access permits viewing can open them.</p>
    </form>

    {error && <div className="error-message" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
    {notice && <p className="profile-success" role="status">{notice}</p>}

    <section className="medical-document-list" aria-labelledby="medical-document-list-title">
      <header><h2 id="medical-document-list-title">Your Documents</h2><p>Original files are preserved with their upload date and source.</p></header>
      {loading ? <p role="status">Loading your documents…</p> : documents.length === 0 ? <div className="card medical-document-empty"><FileHeart aria-hidden="true" /><h3>No medical documents yet</h3><p>Use Upload Medical Document to add a discharge summary, lab report, prescription, or another file.</p></div> : <ul className="medical-document-list-items">{documents.map(document => {
        const label = DOCUMENT_LABELS[document.document_type] ?? 'Medical Document'
        const originalFilename = document.original_filename || document.title
        const canRemove = document.source === 'patient_upload' && document.uploaded_by_profile_id === user?.id && document.status === 'active'
        const prepared = getPreparedDocumentSummary(document.title) || getPreparedDocumentSummary(originalFilename)
        return <li id={`medical-document-${document.id}`} tabIndex={-1} className="card medical-document-card" key={document.id}>
          <span className="medical-document-file-icon"><FileText aria-hidden="true" /></span>
          <div className="medical-document-card-main"><span className="eyebrow">{label}</span><h3>{document.title || originalFilename}</h3><p>{originalFilename}</p><small>{document.document_date ? `Document date ${localDate(document.document_date)}` : 'Document date not provided'} · Uploaded {uploadedDate(document.created_at)} · Uploaded by you</small></div>
          <div className="medical-document-card-actions"><button type="button" className="button button--secondary" disabled={busy || openingDocumentId === document.id} onClick={() => void openDocument(document)}>{openingDocumentId === document.id ? 'Opening…' : 'View'}</button><button type="button" className="button button--secondary" disabled={busy || openingDocumentId === document.id} onClick={() => void openDocument(document, true)}>Download</button>{(isRealDocumentPipelineAvailable || prepared) && canRemove && <button type="button" className="button button--secondary" disabled={busy || Boolean(processingDocumentId)} onClick={() => void processDocumentWithModel(document)}>{processingDocumentId === document.id ? (prepared ? 'Processing document...' : 'Processing document…') : 'Extract for Review'}</button>}{canRemove && <button type="button" className="medical-document-remove" disabled={busy || openingDocumentId === document.id} onClick={() => setRemoveTarget(document)}>Remove</button>}</div>
        </li>
      })}</ul>}
    </section>

    {removeTarget && <div className="medical-document-dialog-backdrop"><section className="card medical-document-dialog" role="alertdialog" aria-modal="true" aria-labelledby="medical-document-remove-title" aria-describedby="medical-document-remove-description">
      <button className="medical-document-dialog-close" type="button" aria-label="Cancel removal" disabled={busy} onClick={() => setRemoveTarget(null)}><X aria-hidden="true" /></button>
      <h2 id="medical-document-remove-title">Remove this document?</h2><p id="medical-document-remove-description">The private file will be removed and this document will no longer appear in your record.</p>
      <div><button type="button" className="button button--secondary" disabled={busy} onClick={() => setRemoveTarget(null)}>Keep Document</button><button type="button" className="button button--primary" disabled={busy} onClick={() => void removeDocument()}>{busy ? 'Removing…' : 'Remove Document'}</button></div>
    </section></div>}
  </section>
}
