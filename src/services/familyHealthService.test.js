import { describe, expect, it, vi } from 'vitest'
import { createFamilyHealthService } from './familyHealthService.js'

const activeGrant = { id: 'grant-1', status: 'active', expires_at: '2099-01-01T00:00:00Z', records: true, appointments: false, medications: false, alerts: true }
const selectedMember = { member_id: 'member-mother', patient_id: 'patient-mother', display_name: 'Mother', relationship: 'mother', role: 'member', is_self: false, authorization: activeGrant }

function repository(overrides = {}) {
  return {
    getGroups: vi.fn().mockResolvedValue([{ id: 'group-1', display_name: 'Family' }]),
    getMembers: vi.fn().mockResolvedValue([{ member_id: 'member-self', patient_id: 'patient-viewer', display_name: 'Viewer', is_self: true }, selectedMember]),
    getNextAppointment: vi.fn().mockResolvedValue(null),
    getMedications: vi.fn().mockResolvedValue([]),
    getActiveAlerts: vi.fn().mockResolvedValue([]),
    getLatestVitals: vi.fn().mockResolvedValue({ heart_rate: null }),
    getVitalHistory: vi.fn().mockResolvedValue([]),
    getRecentHealthRecords: vi.fn().mockResolvedValue([]),
    getRecentLabResults: vi.fn().mockResolvedValue([]),
    getDocumentFactIntelligence: vi.fn().mockResolvedValue({ status: 'ready', items: [], total_count: 0 }),
    getFamilyCarePlans: vi.fn().mockResolvedValue([]),
    getFamilyPatientCarePlan: vi.fn().mockResolvedValue({ health_goals: [], medications: [], monitoring_plans: [], lifestyle_plans: [], appointments: [], access: { medications: false, appointments: false, records: false } }),
    getFamilyReportedHealthRecords: vi.fn().mockResolvedValue([]),
    getFamilyMedicalDocuments: vi.fn().mockResolvedValue([]),
    getCommandFollowUps: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

describe('authorization-aware family health service', () => {
  it('requires records scope for standalone follow-ups and masks revoked reads',async()=>{
    const repo=repository({getCommandDocuments:vi.fn().mockResolvedValue([])})
    const result=await createFamilyHealthService(repo).loadHealth({groupId:'group-1',memberId:'member-mother',commandCenter:true})
    expect(repo.getCommandFollowUps).toHaveBeenCalledWith('patient-mother')
    expect(result.sections.followUps.status).toBe('ready')
    repo.getMembers.mockResolvedValue([{...selectedMember,authorization:{...activeGrant,records:false}}])
    repo.getCommandFollowUps.mockClear()
    await createFamilyHealthService(repo).loadHealth({groupId:'group-1',memberId:'member-mother',commandCenter:true})
    expect(repo.getCommandFollowUps).not.toHaveBeenCalled()
  })
  it('reports missing follow-up SELECT privileges without breaking other overview reads',async()=>{
    const error=Object.assign(new Error('Denied'),{code:'42501'})
    const repo=repository({getCommandDocuments:vi.fn().mockResolvedValue([]),getCommandFollowUps:vi.fn().mockRejectedValue(error)})
    const result=await createFamilyHealthService(repo).loadHealth({selfPatient:{id:'self'},commandCenter:true})
    expect(result.sections.followUps).toEqual({status:'unsupported',data:null})
    expect(result.sections.alerts.status).toBe('ready')
  })
  it('shares only two directory reads per group and skips unused overview queries', async () => {
    const repo = repository({ getCommandDocuments: vi.fn().mockResolvedValue([]), getMembers: vi.fn().mockResolvedValue([selectedMember, { ...selectedMember, member_id: 'father', patient_id: 'patient-father' }]) })
    const rows = await createFamilyHealthService(repo).loadCommandCenterGroup('group-1')
    expect(rows).toHaveLength(2)
    expect(repo.getMembers).toHaveBeenCalledTimes(2)
    expect(repo.getCommandDocuments).toHaveBeenCalledTimes(2)
    for (const name of ['getLatestVitals', 'getVitalHistory', 'getRecentHealthRecords', 'getRecentLabResults']) expect(repo[name]).not.toHaveBeenCalled()
  })
  it('masks revoked records and removed or reassigned memberships after all group reads', async () => {
    const initial = [selectedMember, { ...selectedMember, member_id: 'removed', patient_id: 'patient-removed' }, { ...selectedMember, member_id: 'changed', patient_id: 'original' }]
    const fresh = [{ ...selectedMember, authorization: { ...activeGrant, status: 'revoked' } }, { ...initial[2], patient_id: 'other-patient' }]
    const repo = repository({ getMembers: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(fresh), getCommandDocuments: vi.fn().mockResolvedValue([{ id: 'SECRET' }]), getDocumentFactIntelligence: vi.fn().mockResolvedValue({ items: [{ fact_id: 'SECRET' }] }) })
    const rows = await createFamilyHealthService(repo).loadCommandCenterGroup('group-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].sections.documentActivity).toEqual({ status: 'revoked', data: null })
    expect(rows[0].sections.documentIntelligence).toEqual({ status: 'revoked', data: null })
    expect(JSON.stringify(rows)).not.toContain('SECRET')
  })
  it('reads no overview signals without active scoped sharing', async () => {
    const repo = repository({ getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: null }]), getCommandDocuments: vi.fn(), getCommandAppointments: vi.fn() })
    await createFamilyHealthService(repo).loadCommandCenterGroup('group-1')
    for (const name of ['getCommandDocuments', 'getCommandAppointments', 'getDocumentFactIntelligence', 'getActiveAlerts', 'getMedications', 'getFamilyCarePlans']) expect(repo[name]).not.toHaveBeenCalled()
  })
  it('loads only detail modules with granted scopes and skips analytics cards', async () => {
    const repo = repository()
    const service = createFamilyHealthService(repo)
    const result = await service.loadHealth({ groupId: 'group-1', memberId: 'member-mother' })

    expect(repo.getMembers).toHaveBeenCalledTimes(2)
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
    expect(repo.getVitalHistory).not.toHaveBeenCalled()
    expect(repo.getFamilyReportedHealthRecords).toHaveBeenCalledWith('group-1', 'member-mother')
    expect(repo.getFamilyMedicalDocuments).toHaveBeenCalledWith('patient-mother')
    expect(repo.getRecentHealthRecords).not.toHaveBeenCalled()
    expect(repo.getDocumentFactIntelligence).not.toHaveBeenCalled()
    expect(repo.getActiveAlerts).not.toHaveBeenCalled()
    expect(repo.getNextAppointment).not.toHaveBeenCalled()
    expect(repo.getMedications).not.toHaveBeenCalled()
    expect(repo.getRecentLabResults).not.toHaveBeenCalled()
    expect(result.sections.appointments.status).toBe('not_authorized')
    expect(result.sections.medications.status).toBe('not_authorized')
    expect(result.sections.records.status).toBe('ready')
    expect(result.sections.alerts).toBeUndefined()
    expect(result.sections.vitals).toBeUndefined()
    expect(result.sections.documentIntelligence).toBeUndefined()
    expect(result.sections.labs).toBeUndefined()
  })

  it('does not query clinical data from membership alone', async () => {
    const repo = repository({ getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: null }]) })
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
    expect(repo.getActiveAlerts).not.toHaveBeenCalled()
    expect(result.sections.records).toEqual({ status: 'not_authorized', data: null })
    expect(repo.getDocumentFactIntelligence).not.toHaveBeenCalled()
    expect(result.sections.medications).toEqual({ status: 'not_authorized', data: null })
    expect(repo.getFamilyCarePlans).not.toHaveBeenCalled()
  })

  it('requires the separate care_plans scope and resolves the member by membership ID', async () => {
    const grant = { ...activeGrant, care_plans: true }
    const repo = repository({ getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: grant }]) })
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(repo.getFamilyCarePlans).toHaveBeenCalledWith('group-1', 'member-mother')
    expect(repo.getFamilyPatientCarePlan).toHaveBeenCalledWith('group-1', 'member-mother')
    expect(result.sections.carePlan).toEqual({ status: 'ready', data: [] })

    const recordsOnly = repository({ getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: activeGrant }]) })
    const locked = await createFamilyHealthService(recordsOnly).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(recordsOnly.getFamilyCarePlans).not.toHaveBeenCalled()
    expect(locked.sections.carePlan).toEqual({ status: 'not_authorized', data: null })
  })

  it('exposes only selected appointment and medication scopes as read queries', async () => {
    const grant = { ...activeGrant, records: false, appointments: true, medications: true, alerts: false }
    const repo = repository({
      getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: grant }]),
    })
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(repo.getNextAppointment).toHaveBeenCalledWith('patient-mother')
    expect(repo.getMedications).toHaveBeenCalledWith('patient-mother')
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
    expect(repo.getRecentHealthRecords).not.toHaveBeenCalled()
    expect(result.sections.appointments.status).toBe('ready')
    expect(result.sections.medications.status).toBe('ready')
    expect(result.sections.alerts).toBeUndefined()
    expect(result.sections.vitals).toBeUndefined()
  })

  it('clears data when authorization is revoked during a read', async () => {
    const repo = repository({ getMembers: vi.fn()
      .mockResolvedValueOnce([{ ...selectedMember, authorization: activeGrant }])
      .mockResolvedValueOnce([{ ...selectedMember, authorization: { ...activeGrant, status: 'revoked', records: false, alerts: false } }]),
    })
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(result.sections.records).toEqual({ status: 'revoked', data: null })
    expect(result.sections.alerts).toBeUndefined()
    expect(result.sections.appointments.status).toBe('revoked')
  })

  it('clears the family Care Plan projection when its grant expires during the read', async () => {
    const repo = repository({
      getFamilyCarePlans: vi.fn().mockResolvedValue([{ plan: { title: 'Private plan' } }]),
      getMembers: vi.fn()
        .mockResolvedValueOnce([{ ...selectedMember, authorization: { ...activeGrant, care_plans: true } }])
        .mockResolvedValueOnce([{ ...selectedMember, authorization: { ...activeGrant, care_plans: true, expires_at: '2020-01-01T00:00:00Z' } }]),
    })
    const result = await createFamilyHealthService(repo, () => Date.parse('2026-01-01T00:00:00Z')).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(result.sections.carePlan).toEqual({ status: 'expired', data: null })
  })

  it('isolates a failed section from successful authorized reads', async () => {
    const repo = repository({
      getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: { ...activeGrant, medications: true } }]),
      getFamilyReportedHealthRecords: vi.fn().mockRejectedValue(new Error('RPC error')),
      getMedications: vi.fn().mockResolvedValue([{ id: 'shared-med' }]),
    })
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(result.sections.records).toEqual({ status: 'error', data: null })
    expect(result.sections.medications).toEqual({ status: 'ready', data: [{ id: 'shared-med' }] })
  })

  it('marks expired grants without making clinical queries', async () => {
    const repo = repository({ getMembers: vi.fn().mockResolvedValue([{ ...selectedMember, authorization: { ...activeGrant, expires_at: '2020-01-01T00:00:00Z' } }]) })
    const result = await createFamilyHealthService(repo, () => Date.parse('2026-01-01T00:00:00Z')).loadHealth({ groupId: 'group-1', memberId: 'member-mother' })
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
    expect(result.sections.records.status).toBe('expired')
    expect(result.sections.alerts).toBeUndefined()
  })

  it('returns no member data for IDs outside the accepted membership result', async () => {
    const repo = repository()
    const result = await createFamilyHealthService(repo).loadHealth({ groupId: 'group-1', memberId: 'arbitrary-member' })
    expect(result.membershipRemoved).toBe(true)
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
  })

  it('loads Self through the authenticated patient identity and retains the own-account lab view', async () => {
    const repo = repository()
    const result = await createFamilyHealthService(repo).loadHealth({ selfPatient: { id: 'authenticated-patient', full_name: 'Self' } })
    expect(repo.getLatestVitals).not.toHaveBeenCalled()
    expect(repo.getRecentLabResults).not.toHaveBeenCalled()
    expect(repo.getMembers).not.toHaveBeenCalled()
    expect(repo.getFamilyCarePlans).not.toHaveBeenCalled()
    expect(result.member.is_self).toBe(true)
    expect(result.sections.labs).toBeUndefined()
  })
})

it('uses shared sources only for self and never bypasses member scope checks', async () => {
  const repo = repository({ getCommandAppointments: vi.fn().mockResolvedValue([]), getCommandDocuments: vi.fn().mockResolvedValue([]) })
  const shared = { appointments: vi.fn().mockResolvedValue([{ id: 'self-a', status: 'confirmed' }]), medications: vi.fn().mockResolvedValue([{ id: 'self-med' }]), alerts: vi.fn().mockResolvedValue([{ id: 'self-alert' }]) }
  const service = createFamilyHealthService(repo)
  const own = await service.loadHealth({ selfPatient: { id: 'patient-viewer' }, commandCenter: true, sharedOwnSections: shared })
  expect(own.sections.medications.data).toEqual([{ id: 'self-med' }])
  expect(shared.medications).toHaveBeenCalledTimes(1)
  expect(repo.getMedications).not.toHaveBeenCalled()
  const relative = await service.loadHealth({ groupId: 'group-1', memberId: 'member-mother', commandCenter: true, sharedOwnSections: shared })
  expect(relative.sections.medications.status).toBe('not_authorized')
  expect(shared.medications).toHaveBeenCalledTimes(1)
  expect(repo.getActiveAlerts).toHaveBeenCalledWith('patient-mother')
  expect(repo.getMembers).toHaveBeenCalledTimes(2)
})
