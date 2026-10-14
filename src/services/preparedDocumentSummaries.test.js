import { describe, expect, it } from 'vitest'
import { getPreparedDocumentSummary, normalizeDocumentTitle } from './preparedDocumentSummaries.js'

describe('prepared document summaries', () => {
  it.each(['Cervical Spondylosis.pdf', 'CERVICAL SPONDYLOSIS', 'cervical-spondylosis.pdf', 'cervical_spondylosis.jpg'])('matches %s', title => {
    expect(getPreparedDocumentSummary(title)).toMatchObject({ key: 'cervical spondylosis', title: 'Cervical Spondylosis', patient: 'Nandar Kyaw', age: '22 years', sex: 'Female', reportType: 'Cervical Spine X-ray' })
  })

  it('normalizes case, extension, separators, and repeated spaces', () => {
    expect(normalizeDocumentTitle('  CERVICAL__SPONDYLOSIS.PDF  ')).toBe('cervical spondylosis')
  })

  it('provides both prepared language versions and does not match unrelated documents', () => {
    const summary = getPreparedDocumentSummary('cervical-spondylosis')
    expect(summary.english).toContain('Cervical Spondylosis Report Summary')
    expect(summary.myanmar).toContain('ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်')
    expect(getPreparedDocumentSummary('blood-test.pdf')).toBeNull()
  })

  it.each(['Anemia', 'Anemia.pdf', 'ANEMIA', 'anemia.pdf', 'anemia-lab-report.pdf', 'anemia_lab_report.jpg'])('matches Anemia title %s', title => {
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'anemia', title: 'Anemia', summaryTitle: 'Anemia Lab', patient: 'Nandar Kyaw',
      age: '22 years', sex: 'Female', reportType: 'Anemia Laboratory Test',
    })
  })

  it('keeps Anemia content in the prepared lookup and rejects unrelated files', () => {
    const summary = getPreparedDocumentSummary('anemia_lab_report.jpg')
    expect(summary.titleMyanmar).toBe('သွေးအားနည်းရောဂါ ဓာတ်ခွဲစစ်ဆေးမှု အကျဉ်းချုပ်')
    expect(summary.english).toContain('10.2 g/dL')
    expect(summary.english).toContain('Transferrin Saturation')
    expect(summary.myanmar).toContain('ကျန်းမာရေးအကြံပြုချက်များ')
    expect(getPreparedDocumentSummary('unrelated-xray.pdf')).toBeNull()
  })

  it.each([
    ['Jumper Knee.pdf', 'jumpers knee'],
    ["Jumper's Knee.pdf", 'jumpers knee'],
    ['Jumper’s Knee', 'jumpers knee'],
    ['jumpers-knee.pdf', 'jumpers knee'],
    ['jumpers_knee.jpg', 'jumpers knee'],
    ["JUMPER'S KNEE", 'jumpers knee'],
  ])('matches Jumper’s Knee variant %s', (title, key) => {
    expect(normalizeDocumentTitle(title)).toBe(key)
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key, title: 'Jumper’s Knee', patient: 'Eaindray Kyaw', age: '27 years',
      sex: 'Female', reportType: 'Knee MRI',
    })
  })

  it('preserves Jumper’s Knee source details and does not match unrelated documents', () => {
    const summary = getPreparedDocumentSummary("Jumper's Knee.pdf")
    expect(summary.english).toContain('no tendon tear, major ligament injury')
    expect(summary.english).not.toContain('Right Knee')
    expect(summary.myanmar).toContain('ဒူးခေါင်းအရွတ်ရောင်ရမ်းနာကျင်ခြင်း MRI စစ်ဆေးမှု အကျဉ်းချုပ်')
    expect(getPreparedDocumentSummary('right-knee-fracture.pdf')).toBeNull()
  })

  it.each(['Right Knee MRI', 'Right Knee MRI.png', 'Right Knee MRI.jpg', 'right-knee-mri.png', 'right_knee_mri.jpg', 'RIGHT KNEE MRI', 'MRI Right Knee'])('matches Right Knee MRI variant %s', title => {
    expect(normalizeDocumentTitle(title)).toBe('right knee mri')
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'right knee mri', title: 'Right Knee MRI', patient: 'Eaindray Kyaw',
      age: '27 years', sex: 'Female', reportType: 'Right Knee MRI',
    })
  })

  it('keeps right-side findings limited to the explicitly named Right Knee MRI lookup', () => {
    const summary = getPreparedDocumentSummary('right_knee_mri.jpg')
    expect(summary.english).toContain('of the right knee')
    expect(summary.myanmar).toContain('ညာဘက်ဒူးခေါင်းအောက်ရှိ')
    expect(getPreparedDocumentSummary('left-knee-mri.png')).toBeNull()
    expect(getPreparedDocumentSummary('knee-mri.png')).toBeNull()
  })

  it.each(['Medical Prescription.png', 'Medical Prescription.jpg', 'medical-prescription.png', 'medical_prescription.jpg', 'Cervical Spondylosis Prescription', 'Cervical Spondylosis Prescription.png'])('matches Medical Prescription variant %s', title => {
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'medical prescription', title: 'Medical Prescription', summaryType: 'prescription',
      patient: 'Nandar Kyaw', age: '22 years', sex: 'Female',
      reportType: 'Prescription / Treatment Plan', condition: 'Cervical Spondylosis / Neck Pain',
    })
  })

  it('keeps the prescription prepared content local and rejects unrelated files', () => {
    const summary = getPreparedDocumentSummary('Cervical Spondylosis Prescription.png')
    expect(normalizeDocumentTitle(' MEDICAL__PRESCRIPTION.JPG ')).toBe('medical prescription')
    expect(summary.english).toContain('Paracetamol 500 mg')
    expect(summary.english).toContain('Vitamin B complex is not an established treatment')
    expect(summary.myanmar).toContain('ဆီးဝမ်းထိန်းချုပ်မှု')
    expect(getPreparedDocumentSummary('cervical-spondylosis-xray.png')).toBeNull()
    expect(getPreparedDocumentSummary('random-prescription.pdf')).toBeNull()
  })

  it.each(['Cervical Spine', 'Cervical Spine.png', 'Cervical Spine.jpg', 'Cervical Spine.pdf', 'cervical-spine.png', 'cervical_spine.jpg', 'Cervical Spine X-ray', 'Cervical Spine Xray', 'CERVICAL SPINE'])('matches Cervical Spine variant %s', title => {
    expect(normalizeDocumentTitle(title)).toBe('cervical spine')
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'cervical spine', title: 'Cervical Spine', patient: 'Nandar Kyaw', age: '22 years',
      sex: 'Female', reportType: 'Cervical Spine X-ray',
    })
  })

  it('keeps Cervical Spine imaging content separate from other cervical lookups', () => {
    const summary = getPreparedDocumentSummary('cervical_spine.jpg')
    expect(summary.titleEnglish).toBe('Cervical Spondylosis Imaging Report Summary')
    expect(summary.english).toContain('mild changes at C5–C6')
    expect(summary.myanmar).toContain('ကျန်းမာရေးအခြေအနေ အကျဉ်းချုပ်')
    expect(getPreparedDocumentSummary('thoracic-spine.png')).toBeNull()
    expect(getPreparedDocumentSummary('cervical-rib-xray.png')).toBeNull()
    expect(getPreparedDocumentSummary('Cervical Spondylosis')).toMatchObject({ key: 'cervical spondylosis' })
  })

  it.each(['Coronary CT', 'Coronary CT.png', 'Coronary CT.jpg', 'Coronary CT.pdf', 'coronary-ct.png', 'coronary_ct.jpg', 'CT Coronary Angiography', 'Coronary Angiography', 'CCTA', 'CORONARY CT'])('matches Coronary CT variant %s', title => {
    expect(normalizeDocumentTitle(title)).toBe('coronary ct')
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'coronary ct', title: 'Coronary CT', patient: 'U KyawAung Moe', age: '59 years',
      sex: 'Male', reportType: 'CT Coronary Angiography (CCTA)',
    })
  })

  it('keeps Coronary CT content prepared and rejects unrelated documents', () => {
    const summary = getPreparedDocumentSummary('coronary_ct.jpg')
    expect(summary.titleEnglish).toBe('Coronary Artery Imaging Report Summary')
    expect(summary.english).toContain('20–30% narrowing')
    expect(summary.myanmar).toContain('၂၀% မှ ၃၀% ခန့်')
    expect(getPreparedDocumentSummary('cardiac-ultrasound.pdf')).toBeNull()
    expect(getPreparedDocumentSummary('coronary-bypass.pdf')).toBeNull()
  })

  it.each(['Diabetes Lab Report.pdf', 'Diabetes Lab Report.png', 'diabetes-lab-report.pdf', 'diabetes_lab_report.jpg', 'Diabetes Screening', 'Diabetes Screening & Monitoring', 'Diabetes Monitoring Report', 'DIABETES LAB REPORT'])('matches Diabetes Lab Report variant %s', title => {
    expect(normalizeDocumentTitle(title)).toBe('diabetes lab report')
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'diabetes lab report', title: 'Diabetes Lab Report', patient: 'Daw Ei Ei San',
      age: '49 years', sex: 'Female', reportType: 'Diabetes Screening & Monitoring',
    })
  })

  it('keeps Diabetes Lab Report values in prepared display content and rejects unrelated files', () => {
    const summary = getPreparedDocumentSummary('diabetes_lab_report.jpg')
    expect(summary.titleEnglish).toBe('Diabetes Lab Report Summary')
    expect(summary.english).toContain('154 mg/dL')
    expect(summary.english).toContain('7.4%')
    expect(summary.myanmar).toContain('ဒေါ်အိအိစံ၏ နမူနာရလဒ်တွင်')
    expect(getPreparedDocumentSummary('liver-panel-report.pdf')).toBeNull()
    expect(getPreparedDocumentSummary('diabetes-medication-list.pdf')).toBeNull()
  })

  it.each(['Hypertension Lab Report.pdf', 'Hypertension Lab Report.png', 'hypertension-lab-report.pdf', 'hypertension_lab_report.jpg', 'Hypertension Assessment', 'Blood Pressure Report', 'HYPERTENSION LAB REPORT'])('matches Hypertension Lab Report variant %s', title => {
    expect(normalizeDocumentTitle(title)).toBe('hypertension lab report')
    expect(getPreparedDocumentSummary(title)).toMatchObject({
      key: 'hypertension lab report', title: 'Hypertension Lab Report', patient: 'U KyawAung Moe',
      age: '59 years', sex: 'Male', reportType: 'Hypertension Assessment',
    })
  })

  it('keeps Hypertension Lab Report prepared values and rejects unrelated files', () => {
    const summary = getPreparedDocumentSummary('hypertension_lab_report.jpg')
    expect(summary.titleEnglish).toBe('Patient-Friendly Hypertension Lab Report Summary')
    expect(summary.english).toContain('158/96 mmHg')
    expect(summary.english).toContain('does not confirm a diagnosis of hypertension')
    expect(summary.myanmar).toContain('ဦးကျော်အောင်မိုး၏ နမူနာရလဒ်အရ')
    expect(getPreparedDocumentSummary('blood-glucose-report.pdf')).toBeNull()
    expect(getPreparedDocumentSummary('heart-ecg-report.png')).toBeNull()
  })
})
