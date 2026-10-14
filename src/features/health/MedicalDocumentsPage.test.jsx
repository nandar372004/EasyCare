import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAuth } from '../auth/AuthContext.jsx'
import { MedicalDocumentsPage } from './MedicalDocumentsPage.jsx'
import { documentHealthIntelligenceService } from '../../services/documentHealthIntelligenceService.js'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: vi.fn(() => ({ patient: { id: 'patient-1' }, user: { id: 'profile-1' } })),
}))
vi.mock('../../services/documentHealthIntelligenceService.js', () => ({
  documentHealthIntelligenceService: { getForPatient: vi.fn().mockResolvedValue({ status: 'ready', items: [], total_count: 0 }) },
}))
const { processRealDocument } = vi.hoisted(() => ({ processRealDocument: vi.fn() }))
vi.mock('../../services/realDocumentPipelineService.js', () => ({
  isRealDocumentPipelineAvailable: true,
  realDocumentPipelineService: { processDocument: processRealDocument },
}))

const sample = {
  id: 'doc-1', patient_id: 'patient-1', document_type: 'discharge_summary', title: 'Hospital discharge',
  original_filename: 'discharge.pdf', storage_bucket: 'medical-documents', storage_path: 'private/path',
  mime_type: 'application/pdf', file_size: 100, document_date: '2026-08-12',
  uploaded_by_profile_id: 'profile-1', source: 'patient_upload', status: 'active', created_at: '2026-08-15T12:00:00Z',
}

describe('MedicalDocumentsPage', () => {
  let service
  beforeEach(() => {
    window.location.hash = ''
    useAuth.mockReturnValue({ patient: { id: 'patient-1' }, user: { id: 'profile-1' } })
    service = {
      list: vi.fn().mockResolvedValue([sample]),
      listMine: vi.fn().mockResolvedValue([sample]),
      upload: vi.fn().mockResolvedValue({ ok: true }),
      createSignedUrl: vi.fn().mockResolvedValue('https://signed.example/file?token=short-lived'),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    }
    processRealDocument.mockReset().mockResolvedValue({ candidate_count: 1 })
    documentHealthIntelligenceService.getForPatient.mockClear()
  })

  it('focuses and scrolls to the source document selected from Health Intelligence', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.location.hash = '#medical-document-doc-1'
    render(<MedicalDocumentsPage service={service} />)
    const source = await screen.findByText('Hospital discharge')
    expect(source.closest('li')).toHaveAttribute('id', 'medical-document-doc-1')
    await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('offers only photo and file selection with labeled document details', async () => {
    render(<MedicalDocumentsPage service={service} />)
    expect(await screen.findByRole('heading', { name: 'Medical Documents' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Take Photo|Camera/i })).toBeNull()
    expect(screen.queryByLabelText(/Take a medical document photo/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Choose Photo/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Choose File/ })).toBeTruthy()
    expect(screen.getByLabelText('Choose an existing medical document photo').getAttribute('accept')).toContain('image/jpeg')
    expect(screen.getByLabelText('Document Type')).toBeTruthy()
    expect(screen.getByLabelText(/Document Date/)).toBeTruthy()
    expect(screen.getByLabelText(/Title/)).toBeTruthy()
  })

  it('uploads the selected source file once and shows uploaded provenance in the list', async () => {
    const user = userEvent.setup()
    render(<MedicalDocumentsPage service={service} />)
    const file = new File(['%PDF-1.7'], 'discharge.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose a medical document file'), file)
    await user.selectOptions(screen.getByLabelText('Document Type'), 'discharge_summary')
    await user.type(screen.getByLabelText(/Title/), 'Hospital discharge')
    await user.type(screen.getByLabelText(/Document Date/), '2026-08-12')
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(service.upload).toHaveBeenCalledTimes(1))
    expect(service.upload).toHaveBeenCalledWith(expect.objectContaining({
      file, documentType: 'discharge_summary', title: 'Hospital discharge', documentDate: '2026-08-12',
    }))
    expect(service.listMine).toHaveBeenCalledWith('profile-1')
    expect(await screen.findByText('Uploaded by you', { exact: false })).toBeTruthy()
    expect(await screen.findByText(/has not been interpreted/)).toBeTruthy()
  })

  it('does not show test processing or development fixture UI, even when the test pipeline exists', async () => {
    service.listMine.mockResolvedValue([{ ...sample, document_type: 'lab_report', title: 'Synthetic lab report' }])
    render(<MedicalDocumentsPage service={service} />)
    await screen.findByText('Synthetic lab report')
    expect(screen.queryByRole('button', { name: /Process document for testing/i })).toBeNull()
    expect(screen.queryByText('Development test fixture')).toBeNull()
    expect(screen.queryByRole('link', { name: /synthetic Lab Report PDF/i })).toBeNull()
  })

  it('extracts the clicked real document, reports Ready for review, and refreshes Health Intelligence', async () => {
    const user = userEvent.setup()
    processRealDocument.mockResolvedValue({ candidate_count: 1, source_document_id: sample.id, review_status: 'needs_review' })
    render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    await user.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    await waitFor(() => expect(processRealDocument).toHaveBeenCalledWith(sample.id))
    expect(await screen.findByRole('status')).toHaveTextContent(/Ready for review/i)
    expect(documentHealthIntelligenceService.getForPatient).toHaveBeenCalledWith('patient-1', expect.anything())
  })

  it('shows the prepared cervical summary in place of live extraction for a matching filename', async () => {
    service.listMine.mockResolvedValue([{ ...sample, title: 'Neck X-ray', original_filename: 'cervical_spondylosis.jpg' }])
    render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Neck X-ray')).closest('li')
    expect(within(row).queryByRole('button', { name: 'View Prepared Summary' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Extract for Review' })).toBeTruthy()
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText(/Your sample report describes mild changes/)).toBeTruthy()
    expect(processRealDocument).not.toHaveBeenCalled()
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByText('Cervical Spondylosis Report Summary')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Prepared document summary' })).toBeNull()
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    expect(within(intelligence).getByRole('table')).toBeTruthy()
    expect(within(intelligence).getByRole('list')).toBeTruthy()
    expect(within(intelligence).getByText('Nandar Kyaw')).toBeTruthy()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Anemia Lab Report Summary', /Your sample blood test results show low hemoglobin/, /နမူနာသွေးစစ်ဆေးမှုရလဒ်အရ/],
    ['my', 'သွေးအားနည်းရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်', /နမူနာသွေးစစ်ဆေးမှုရလဒ်အရ/, /Your sample blood test results show low hemoglobin/],
    ['both', 'Anemia Lab Report Summary', /Your sample blood test results show low hemoglobin/, null],
  ])('uses the prepared Anemia summary and language mode %s', async (mode, title, expectedText, excludedText) => {
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Anemia', original_filename: 'anemia-lab-report.pdf' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Anemia')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(expectedText)).toBeInTheDocument()
    const tables = within(intelligence).getAllByRole('table')
    expect(tables).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of tables) expect(table.querySelectorAll('tbody tr')).toHaveLength(9)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', "Jumper’s Knee MRI Report Summary", /Your sample MRI report describes mild irritation/, /နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ/],
    ['my', 'ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်', /နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ/, /Your sample MRI report describes mild irritation/],
    ['both', "Jumper’s Knee MRI Report Summary", /Your sample MRI report describes mild irritation/, null],
  ])('uses the prepared Jumper’s Knee summary in %s mode', async (mode, title, expectedText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Jumper’s Knee', original_filename: 'jumpers-knee.pdf' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Jumper’s Knee')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(expectedText)).toBeInTheDocument()
    const tables = within(intelligence).getAllByRole('table')
    expect(tables).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of tables) expect(table.querySelectorAll('tbody tr')).toHaveLength(8)
    expect(within(intelligence).getAllByText('Eaindray Kyaw')).toHaveLength(mode === 'both' ? 2 : 1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(within(intelligence).queryByText(/Right Knee/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    expect(processRealDocument).not.toHaveBeenCalled()
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Jumper’s Knee MRI Report Summary', /Your sample MRI report describes mild irritation/, /နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ/, /of the right knee/],
    ['my', 'ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်', /နမူနာ MRI စစ်ဆေးမှုရလဒ်အရ/, /Your sample MRI report describes mild irritation/, /ညာဘက်ဒူးခေါင်းအောက်ရှိ/],
    ['both', 'Jumper’s Knee MRI Report Summary', /Your sample MRI report describes mild irritation/, null, /of the right knee/],
  ])('uses the prepared Right Knee MRI lookup in %s mode', async (mode, title, expectedText, excludedText, localityText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Right Knee MRI', original_filename: 'right-knee-mri.png', mime_type: 'image/png' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Right Knee MRI')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(expectedText)).toBeInTheDocument()
    const tables = within(intelligence).getAllByRole('table')
    expect(tables).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of tables) expect(table.querySelectorAll('tbody tr')).toHaveLength(8)
    expect(within(intelligence).getAllByText('Eaindray Kyaw')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText('Right Knee MRI')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText(localityText).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Cervical Spondylosis Prescription Summary', /Your sample prescription describes a treatment plan/, /ဤနမူနာဆေးညွှန်းတွင်/],
    ['my', 'လည်ပင်းကျီးပေါင်းရောဂါ ဆေးညွှန်းနှင့် ကုသမှုအစီအစဉ် အကျဉ်းချုပ်', /ဤနမူနာဆေးညွှန်းတွင်/, /Your sample prescription describes a treatment plan/],
    ['both', 'Cervical Spondylosis Prescription Summary', /Your sample prescription describes a treatment plan/, null],
  ])('uses the prepared Medical Prescription lookup in %s mode', async (mode, title, visibleText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Medical Prescription', original_filename: 'medical-prescription.png', mime_type: 'image/png' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Medical Prescription')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(visibleText)).toBeInTheDocument()
    expect(within(intelligence).getAllByRole('table')).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of within(intelligence).getAllByRole('table')) {
      expect(table.querySelectorAll('thead th')).toHaveLength(3)
      expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    }
    expect(within(intelligence).getAllByText('Nandar Kyaw')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(intelligence.querySelector('.prepared-summary-warning')).toBeInTheDocument()
    expect(intelligence.querySelectorAll('.prepared-summary-warning p')).toHaveLength(mode === 'both' ? 6 : 3)
    expect(within(intelligence).getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Cervical Spondylosis Imaging Report Summary', /Your sample X-ray report shows mild changes/, /နမူနာ X-ray စစ်ဆေးမှုရလဒ်အရ/],
    ['my', 'လည်ပင်းကျီးပေါင်းရောဂါ X-ray စစ်ဆေးမှု အကျဉ်းချုပ်', /နမူနာ X-ray စစ်ဆေးမှုရလဒ်အရ/, /Your sample X-ray report shows mild changes/],
    ['both', 'Cervical Spondylosis Imaging Report Summary', /Your sample X-ray report shows mild changes/, null],
  ])('uses the prepared Cervical Spine lookup in %s mode', async (mode, title, visibleText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Cervical Spine X-ray', original_filename: 'cervical-spine.png', mime_type: 'image/png' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Cervical Spine X-ray')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(visibleText)).toBeInTheDocument()
    expect(within(intelligence).getAllByRole('table')).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of within(intelligence).getAllByRole('table')) expect(table.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(within(intelligence).getAllByText('Nandar Kyaw')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText(/Mild straightening|အနည်းငယ်ဖြောင့်/).length).toBeGreaterThan(0)
    expect(within(intelligence).getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Coronary Artery Imaging Report Summary', /Your sample CT scan report shows mild plaque buildup/, /နမူနာ CT စစ်ဆေးမှုရလဒ်အရ/],
    ['my', 'နှလုံးသွေးကြော CT စစ်ဆေးမှုရလဒ် အကျဉ်းချုပ်', /နမူနာ CT စစ်ဆေးမှုရလဒ်အရ/, /Your sample CT scan report shows mild plaque buildup/],
    ['both', 'Coronary Artery Imaging Report Summary', /Your sample CT scan report shows mild plaque buildup/, null],
  ])('uses the prepared Coronary CT lookup in %s mode', async (mode, title, visibleText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'CCTA', original_filename: 'coronary-ct.png', mime_type: 'image/png' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('CCTA')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(visibleText)).toBeInTheDocument()
    expect(within(intelligence).getAllByRole('table')).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of within(intelligence).getAllByRole('table')) expect(table.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(within(intelligence).getAllByText('U KyawAung Moe')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText(/20–30% narrowing|၂၀–၃၀% ကျဉ်း/).length).toBeGreaterThan(0)
    expect(within(intelligence).getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Diabetes Lab Report Summary', /Your sample laboratory results show that your blood sugar levels are higher than normal/, /နမူနာဓာတ်ခွဲစစ်ဆေးမှုရလဒ်များအရ/],
    ['my', 'ဆီးချိုရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်', /နမူနာဓာတ်ခွဲစစ်ဆေးမှုရလဒ်များအရ/, /Your sample laboratory results show that your blood sugar levels are higher than normal/],
    ['both', 'Diabetes Lab Report Summary', /Your sample laboratory results show that your blood sugar levels are higher than normal/, null],
  ])('uses the prepared Diabetes Lab Report lookup in %s mode', async (mode, title, visibleText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Diabetes Screening & Monitoring', original_filename: 'diabetes-lab-report.pdf', mime_type: 'application/pdf' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Diabetes Screening & Monitoring')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(visibleText)).toBeInTheDocument()
    expect(within(intelligence).getAllByRole('table')).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of within(intelligence).getAllByRole('table')) expect(table.querySelectorAll('tbody tr')).toHaveLength(7)
    expect(within(intelligence).getAllByText('Daw Ei Ei San')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText('154 mg/dL').length).toBeGreaterThan(0)
    expect(within(intelligence).getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it.each([
    ['en', 'Patient-Friendly Hypertension Lab Report Summary', /Your sample report shows that your blood pressure is higher than the recommended level/, /စစ်ဆေးမှုနမူနာရလဒ်များအရ/],
    ['my', 'သွေးတိုးရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်', /စစ်ဆေးမှုနမူနာရလဒ်များအရ/, /Your sample report shows that your blood pressure is higher than the recommended level/],
    ['both', 'Patient-Friendly Hypertension Lab Report Summary', /Your sample report shows that your blood pressure is higher than the recommended level/, null],
  ])('uses the prepared Hypertension Lab Report lookup in %s mode', async (mode, title, visibleText, excludedText) => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, title: 'Hypertension Assessment', original_filename: 'hypertension-lab-report.pdf', mime_type: 'application/pdf' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Hypertension Assessment')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(within(row).getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    expect(processRealDocument).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    const intelligence = screen.getByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })
    expect(within(intelligence).getByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(intelligence).getByText(visibleText)).toBeInTheDocument()
    expect(within(intelligence).getAllByRole('table')).toHaveLength(mode === 'both' ? 2 : 1)
    for (const table of within(intelligence).getAllByRole('table')) expect(table.querySelectorAll('tbody tr')).toHaveLength(8)
    expect(within(intelligence).getAllByText('U KyawAung Moe')).toHaveLength(mode === 'both' ? 2 : 1)
    expect(within(intelligence).getAllByText('158/96 mmHg').length).toBeGreaterThan(0)
    expect(within(intelligence).getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: 'Extracted Health Intelligence extracted health intelligence' })).toHaveLength(1)
    const heading = within(intelligence).getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    if (excludedText) expect(within(intelligence).queryByText(excludedText)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('holds a prepared match for 3000 ms, then scrolls to and focuses the intelligence heading', async () => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    service.listMine.mockResolvedValue([{ ...sample, original_filename: 'cervical-spondylosis.pdf' }])
    render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    const button = within(row).getByRole('button', { name: 'Extract for Review' })
    vi.useFakeTimers()
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Processing document...' })).toBeDisabled()
    fireEvent.click(button)
    expect(screen.queryByText(/Your sample report describes mild changes/)).toBeNull()
    await act(async () => { vi.advanceTimersByTime(2999) })
    expect(screen.queryByText(/Your sample report describes mild changes/)).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByText(/Your sample report describes mild changes/)).toBeTruthy()
    const heading = screen.getByRole('heading', { name: 'Extracted Health Intelligence' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(processRealDocument).not.toHaveBeenCalled()
    expect(screen.getAllByRole('article', { name: 'Prepared document summary for review' })).toHaveLength(1)
    vi.useRealTimers()
  })

  it('clears the prepared-summary timer when the page unmounts', async () => {
    service.listMine.mockResolvedValue([{ ...sample, original_filename: 'cervical-spondylosis.pdf' }])
    const view = render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it.each([
    ['en', true, false], ['my', false, true], ['both', true, true],
  ])('renders only the requested prepared language(s): %s', async (mode, hasEnglish, hasMyanmar) => {
    sessionStorage.setItem('easycare-health-intelligence-language-mode', mode)
    service.listMine.mockResolvedValue([{ ...sample, original_filename: 'cervical-spondylosis.pdf' }])
    render(<LocalizationProvider><MedicalDocumentsPage service={service} /></LocalizationProvider>)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    vi.useFakeTimers()
    fireEvent.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(Boolean(screen.queryByText(/Your sample report describes mild changes/))).toBe(hasEnglish)
    expect(Boolean(screen.queryByText(/ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်/))).toBe(hasMyanmar)
    vi.useRealTimers()
  })

  it('shows the requested processing label while extraction is running', async () => {
    const user = userEvent.setup()
    let finishExtraction
    processRealDocument.mockImplementation(() => new Promise(resolve => { finishExtraction = resolve }))
    render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    await user.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(await screen.findByRole('button', { name: 'Processing document…' })).toBeDisabled()
    finishExtraction({ candidate_count: 1, source_document_id: sample.id, review_status: 'needs_review' })
    expect(await screen.findByRole('status')).toHaveTextContent(/Ready for review/i)
  })

  it('shows a useful safe extraction configuration error', async () => {
    const user = userEvent.setup()
    processRealDocument.mockRejectedValue(new Error('AI service configuration is missing.'))
    render(<MedicalDocumentsPage service={service} />)
    const row = (await screen.findByText('Hospital discharge')).closest('li')
    await user.click(within(row).getByRole('button', { name: 'Extract for Review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI service configuration is missing.')
    expect(screen.queryByText(/Ready for review/i)).toBeNull()
  })

  it('shows the uploaded row immediately and preserves it after a page refresh', async () => {
    const user = userEvent.setup()
    service.listMine.mockResolvedValueOnce([]).mockResolvedValueOnce([sample])
    const view = render(<MedicalDocumentsPage service={service} />)
    expect(await screen.findByText('No medical documents yet')).toBeTruthy()
    const file = new File(['%PDF-1.7'], 'discharge.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose a medical document file'), file)
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByText('Hospital discharge')).toBeTruthy()
    view.unmount()
    render(<MedicalDocumentsPage service={service} />)
    expect(await screen.findByText('Hospital discharge')).toBeTruthy()
  })

  it('creates private signed access for View / Download', async () => {
    const user = userEvent.setup()
    const popup = { opener: window, location: { replace: vi.fn() }, close: vi.fn() }
    const opened = vi.spyOn(window, 'open').mockImplementation(() => popup)
    render(<MedicalDocumentsPage service={service} />)
    await user.click(await screen.findByRole('button', { name: 'View' }))
    await waitFor(() => expect(service.createSignedUrl).toHaveBeenCalledWith(sample, undefined, { download: false }))
    expect(opened).toHaveBeenCalledWith('', '_blank')
    expect(popup.opener).toBeNull()
    expect(popup.location.replace).toHaveBeenCalledWith('https://signed.example/file?token=short-lived')
    opened.mockRestore()
  })

  it('uses the photo picker for image upload and exposes a separate download action', async () => {
    const user = userEvent.setup()
    const popup = { opener: window, location: { replace: vi.fn() }, close: vi.fn() }
    const opened = vi.spyOn(window, 'open').mockImplementation(() => popup)
    render(<MedicalDocumentsPage service={service} />)
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'scan.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText('Choose an existing medical document photo'), photo)
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(service.upload).toHaveBeenCalledWith(expect.objectContaining({ file: photo })))
    expect(await screen.findByRole('button', { name: 'View' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(service.createSignedUrl).toHaveBeenCalledWith(sample, undefined, { download: true }))
    opened.mockRestore()
  })

  it('requires confirmation before owner removal and refreshes the list after success', async () => {
    const user = userEvent.setup()
    service.listMine.mockResolvedValueOnce([sample]).mockResolvedValueOnce([])
    render(<MedicalDocumentsPage service={service} />)
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog', { name: 'Remove this document?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Keep Document' }))
    expect(service.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove Document' }))
    await waitFor(() => expect(service.remove).toHaveBeenCalledWith('doc-1'))
    await waitFor(() => expect(screen.getByText('No medical documents yet')).toBeTruthy())
    expect(documentHealthIntelligenceService.getForPatient).toHaveBeenCalledTimes(2)
  })

  it('does not offer removal when the signed-in user is not the uploader', async () => {
    useAuth.mockReturnValue({ patient: { id: 'patient-1' }, user: { id: 'different-profile' } })
    render(<MedicalDocumentsPage service={service} />)
    await screen.findByText('Hospital discharge')
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('shows a recoverable message when upload fails without claiming success', async () => {
    const user = userEvent.setup()
    service.upload.mockRejectedValue(new Error('We could not upload this document. Please try again.'))
    render(<MedicalDocumentsPage service={service} />)
    const file = new File(['%PDF-1.7'], 'discharge.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose a medical document file'), file)
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not upload/)
    expect(screen.queryByText(/Medical document uploaded/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(false)
  })

  it('shows a recoverable message when removal fails and exits its busy state', async () => {
    const user = userEvent.setup()
    service.remove.mockRejectedValue(new Error('We could not safely remove this document. Refresh and try again.'))
    render(<MedicalDocumentsPage service={service} />)
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove Document' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not safely remove/)
    expect(screen.getByRole('button', { name: 'Remove Document' }).disabled).toBe(false)
  })

  it('does not submit duplicate uploads while an earlier upload is pending', async () => {
    const user = userEvent.setup()
    let resolveUpload
    service.upload.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve }))
    render(<MedicalDocumentsPage service={service} />)
    const file = new File(['%PDF-1.7'], 'discharge.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Choose a medical document file'), file)
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await user.click(screen.getByRole('button', { name: 'Uploading…' }))
    expect(service.upload).toHaveBeenCalledTimes(1)
    resolveUpload({ ok: true })
    await screen.findByText(/has not been interpreted/)
  })

  it('shows a recoverable identity error instead of attempting a list without a patient identity', async () => {
    useAuth.mockReturnValue({ patient: null, user: null })
    render(<MedicalDocumentsPage service={service} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm your patient account/i)
    expect(service.listMine).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(true)
  })

  it('reports a blocked document window without requesting a signed URL', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<MedicalDocumentsPage service={service} />)
    await user.click(await screen.findByRole('button', { name: 'View' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Allow pop-ups/)
    expect(service.createSignedUrl).not.toHaveBeenCalled()
    window.open.mockRestore()
  })
})

