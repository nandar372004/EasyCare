import { describe, expect, it, vi } from 'vitest'
import { createFamilyHealthRepository } from './familyHealthRepository.js'

describe('family document read access', () => {
  it('uses the membership-scoped patient-reported Health Records RPC and maps only the member intake', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [
      { id: 'allergy-1', itemType: 'allergy', entryKind: 'item', name: 'Pollen', details: { reaction: 'Sneezing' }, createdAt: '2026-01-01', updatedAt: '2026-01-02', verificationStatus: 'unverified' },
      { id: 'vaccine-1', itemType: 'vaccination', entryKind: 'item', name: 'Flu vaccine', details: { dateGiven: '2026-02-03' } },
      { id: 'med-1', itemType: 'medication', entryKind: 'item', name: 'Member medication' },
      { id: 'none-1', itemType: 'condition', entryKind: 'none_known' },
    ] }, error: null }) }
    const result = await createFamilyHealthRepository(client, {}).getFamilyReportedHealthRecords('group-id', 'membership-id')
    expect(client.rpc).toHaveBeenCalledWith('get_family_reported_health_records', { p_group_id: 'group-id', p_member_id: 'membership-id' })
    expect(result.map(row => [row.kind, row.record.title, row.record.type])).toEqual([
      ['reported', 'Pollen', 'Allergy'], ['reported', 'Flu vaccine', 'Vaccination'],
    ])
    expect(result[0].record.details).toEqual({ reaction: 'Sneezing' })
  })

  it('keeps the family medical documents read source separate and patient scoped', async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn().mockResolvedValue({ data: [
      { id: 'doc-1', patient_id: 'member-patient', title: 'Discharge note', source: 'patient_upload', status: 'active', created_at: '2026-01-01' },
      { id: 'foreign', patient_id: 'other-patient', title: 'Private document' },
    ], error: null }) }
    const client = { from: vi.fn(() => query) }
    const rows = await createFamilyHealthRepository(client, {}).getFamilyMedicalDocuments('member-patient')
    expect(client.from).toHaveBeenCalledWith('clinical_documents')
    expect(query.eq.mock.calls).toEqual([['patient_id', 'member-patient'], ['status', 'active'], ['source', 'patient_upload']])
    expect(rows.map(row => row.record.id)).toEqual(['doc-1'])
    expect(rows[0].kind).toBe('document')
  })

  it('reads follow-ups using only required fields and excludes foreign patient rows',async()=>{
    const query={select:vi.fn(()=>query),eq:vi.fn(()=>query),in:vi.fn(()=>query),order:vi.fn(()=>query),range:vi.fn().mockResolvedValue({data:[{id:'own',patient_id:'patient',status:'pending'},{id:'foreign',patient_id:'other'}],error:null})}
    const client={from:vi.fn(()=>query)}
    expect((await createFamilyHealthRepository(client,{}).getCommandFollowUps('patient')).map(row=>row.id)).toEqual(['own'])
    expect(query.select).toHaveBeenCalledWith('id,patient_id,follow_up_type,due_at,status,completed_at')
    expect(query.eq).toHaveBeenCalledWith('patient_id','patient')
    expect(query.in).toHaveBeenCalledWith('status',['pending','completed'])
  })
  it('reads intended nullable alert metadata under patient and active-status filters', async () => {
    const rows = [{ id: 'alert', title: null, message: 'Recorded message', detected_at: null, created_at: '2026-10-08' }]
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn().mockResolvedValue({ data: rows, error: null }) }
    const client = { from: vi.fn(() => query) }
    expect(await createFamilyHealthRepository(client, {}).getActiveAlerts('patient')).toEqual(rows)
    expect(client.from).toHaveBeenCalledWith('monitoring_alerts')
    expect(query.select).toHaveBeenCalledWith('id, alert_type, severity, status, title, message, detected_at, created_at')
    expect(query.eq).toHaveBeenCalledWith('patient_id', 'patient')
    expect(query.in).toHaveBeenCalledWith('status', ['open', 'acknowledged', 'escalated'])
  })
  it('scopes command appointments to the patient, excludes unrelated rows and performs reads only', async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query), or: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn().mockResolvedValue({ data: [{ id: 'own', patient_id: 'patient', status: 'pending', scheduled_start: '2026-10-09' }, { id: 'other', patient_id: 'unrelated' }], error: null }) }
    const client = { from: vi.fn(() => query) }
    expect(await createFamilyHealthRepository(client, {}).getCommandAppointments('patient', new Date('2026-10-08T00:00:00Z'))).toEqual([{ id: 'own', status: 'pending', scheduledStart: '2026-10-09', scheduledEnd: undefined, createdAt: undefined, updatedAt: undefined }])
    expect(query.eq).toHaveBeenCalledWith('patient_id', 'patient')
    expect(query.in).toHaveBeenCalledWith('status', ['pending', 'confirmed', 'rescheduled', 'completed'])
    expect(query.or).toHaveBeenCalledWith('status.neq.completed,updated_at.gte.2026-09-08T00:00:00.000Z')
    expect(client.from).toHaveBeenCalledWith('appointments')
  })
  it('reads only active patient-uploaded document metadata under the patient scope', async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn().mockResolvedValue({ data: [{ id: 'document', patient_id: 'patient', created_at: '2026-10-08' }, { id: 'unrelated', patient_id: 'other' }], error: null }) }
    const result = await createFamilyHealthRepository({ from: () => query }, {}).getCommandDocuments('patient')
    expect(result.map(row => row.id)).toEqual(['document'])
    expect(query.select).toHaveBeenCalledWith('id,patient_id,created_at')
    expect(query.eq.mock.calls).toEqual([['patient_id', 'patient'], ['status', 'active'], ['source', 'patient_upload']])
  })
  it('rechecks visible metadata under the current session and signs only the authorized row for 60 seconds', async () => {
    const row = { storage_bucket: 'medical-documents', storage_path: 'patient/document/random.pdf', original_filename: 'source.pdf' }
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
    const storageBucket = { createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' }, error: null }) }
    const client = { from: vi.fn(() => query), storage: { from: vi.fn(() => storageBucket) } }
    const repository = createFamilyHealthRepository(client, {})
    await expect(repository.createDocumentSignedUrl('member-patient', 'document-id')).resolves.toBe('https://signed.example/file')
    expect(client.from).toHaveBeenCalledWith('clinical_documents')
    expect(query.eq).toHaveBeenCalledWith('patient_id', 'member-patient')
    expect(query.eq).toHaveBeenCalledWith('status', 'active')
    expect(client.storage.from).toHaveBeenCalledWith('medical-documents')
    expect(storageBucket.createSignedUrl).toHaveBeenCalledWith(row.storage_path, 60, { download: row.original_filename })
  })

  it('does not sign when RLS hides a document or access has been revoked', async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const storageBucket = { createSignedUrl: vi.fn() }
    const repository = createFamilyHealthRepository({ from: () => query, storage: { from: () => storageBucket } }, {})
    await expect(repository.createDocumentSignedUrl('member-patient', 'document-id')).rejects.toThrow('Unable to open')
    expect(storageBucket.createSignedUrl).not.toHaveBeenCalled()
  })
})
