import { describe, it, expect, vi } from 'vitest'
import { createFamilyCommandCenterService, deriveFamilyCommandCenter, upcomingCareGroup } from './familyCommandCenterService.js'
const now = new Date('2026-10-08T05:00:00Z')
const ready = data => ({ status: 'ready', data })
const base = { member: { patient_id: 'owner', display_name: 'Me', is_self: true }, sections: { appointments: ready([]), medications: ready([]), carePlan: ready([]), documentIntelligence: ready({ items: [] }) } }
const derive = sections => deriveFamilyCommandCenter('owner', [{ ...base, sections: { ...base.sections, ...sections } }], now)
const plan = { plan: { id: 'plan', status: 'active', updated_at: '2026-10-07T05:00:00Z' }, tasks: [{ id: 'task', task_type: 'follow_up' }], occurrences: [{ id: 'due', task_id: 'task', status: 'pending', scheduled_at: '2026-10-07T05:00:00Z' }] }
describe('family command center operational rules', () => {
  it.each(['revoked', 'expired', 'not_authorized'])('removes %s member cards and every protected signal', async authorizationStatus => {
    const health = { getGroups: async () => [{ id: 'g' }], loadHealth: async () => structuredClone(base), loadCommandCenterGroup: async () => [{ member: { patient_id: 'mother', display_name: 'Private Mother' }, authorizationStatus, permissions: { records: true }, sections: { carePlan: ready([plan]) } }] }
    const result = await createFamilyCommandCenterService(health, { listMyPlans: async () => [] }, () => now).load({ id: 'owner' })
    expect(result.members.map(member => member.patientId)).toEqual(['owner'])
    expect(JSON.stringify(result)).not.toContain('Private Mother')
    expect(result.attentionItems).toEqual([])
    expect(result.hasConnectedMembers).toBe(true)
  })
  it('removes an otherwise active grant that expired during slow concurrent reads', async () => {
    const health = { getGroups: async () => [{ id: 'g' }], loadHealth: async () => structuredClone(base), loadCommandCenterGroup: async () => [{ member: { patient_id: 'mother' }, authorizationStatus: 'active', expiresAt: now.toISOString(), permissions: { care_plans: true }, sections: { carePlan: ready([plan]) } }] }
    const result = await createFamilyCommandCenterService(health, { listMyPlans: async () => [] }, () => now).load({ id: 'owner' })
    expect(result.members).toHaveLength(1)
    expect(result.accessExpiresAt).toBeNull()
  })
  it('summarizes real member statuses and chooses one family action', () => {
    const readouts = [base, { member: { patient_id: 'mother', display_name: 'Mother' }, sections: { carePlan: ready([plan]) } }, { member: { patient_id: 'father', display_name: 'Father' }, sections: { carePlan: ready([{ ...plan, occurrences: [] }]) } }]
    const model = deriveFamilyCommandCenter('owner', readouts, now)
    expect(model.summary).toMatchObject({ peopleCount: 3, needsAttentionCount: 1, monitoringCount: 1, stableCount: 1 })
    expect(model.summary.nextAction.displayName).toBe('Mother')
    expect(model.nextActions.map(row => row.patientId)).toEqual(['mother', 'father'])
  })
  it('orders overdue before today before review before near appointment', () => {
    const tasks = ['overdue', 'today'].map(id => ({ id, task_type: 'follow_up' }))
    const occurrences = [{ id: 'overdue-o', task_id: 'overdue', scheduled_at: '2026-10-07T05:00:00Z', status: 'pending' }, { id: 'today-o', task_id: 'today', scheduled_at: '2026-10-08T09:00:00Z', status: 'pending' }]
    const sections = { carePlan: ready([{ ...plan, tasks, occurrences }]), appointments: ready([{ id: 'soon', scheduledStart: '2026-10-09T05:00:00Z', status: 'confirmed' }]), documentIntelligence: ready({ items: [{ fact_id: 'f', source_document_id: 'd', review_status: 'needs_review' }] }) }
    const readout = changes => derive({ ...sections, ...changes })
    expect(readout({}).members[0].nextAction.priority).toBe(1)
    expect(readout({ carePlan: ready([{ ...plan, tasks, occurrences: occurrences.slice(1) }]) }).members[0].nextAction.priority).toBe(2)
    expect(readout({ carePlan: ready([]) }).members[0].nextAction.priority).toBe(3)
    expect(readout({ carePlan: ready([]), documentIntelligence: ready({ items: [] }) }).members[0].nextAction.priority).toBe(4)
    expect(readout({}).nextActions).toHaveLength(1)
  })
  it('merges identical sources across appointment tasks and document candidates', () => {
    const model = derive({ appointments: ready([{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-09T05:00:00Z' }, { id: 'a', status: 'confirmed', scheduledStart: '2026-10-09T05:00:00Z' }]), carePlan: ready([{ ...plan, tasks: [{ id: 'task', task_type: 'appointment', appointment_id: 'a' }], occurrences: [{ id: 'o', task_id: 'task', scheduled_at: '2026-10-09T05:00:00Z', status: 'pending' }] }]), documentIntelligence: ready({ items: ['f1', 'f2', 'f2'].map(fact_id => ({ fact_id, source_document_id: 'document', review_status: 'needs_review' })) }) })
    expect(model.upcomingCare).toHaveLength(1)
    expect(model.attentionItems).toHaveLength(1)
    expect(model.members[0].pendingReviewCount).toBe(2)
    expect(model.members[0].pendingReviews).toHaveLength(1)
  })
  it('groups upcoming care by Yangon calendar day and the current week', () => {
    expect(upcomingCareGroup('2026-10-08T09:00:00Z', now)).toBe('Today')
    expect(upcomingCareGroup('2026-10-08T18:00:00Z', now)).toBe('Tomorrow')
    expect(upcomingCareGroup('2026-10-10T05:00:00Z', now)).toBe('This week')
    expect(upcomingCareGroup('2026-10-12T05:00:00Z', now)).toBe('Later')
    const model = derive({ appointments: ready(['2026-10-08T09:00:00Z','2026-10-09T09:00:00Z','2026-10-10T09:00:00Z','2026-10-12T09:00:00Z'].map((scheduledStart, id) => ({ id: String(id), scheduledStart, status: 'confirmed' }))) })
    expect(model.upcomingCareGroups.map(group => group.label)).toEqual(['Today', 'Tomorrow', 'This week', 'Later'])
  })
  it('keeps completed appointments and document activity newest first without fabricating missing timestamps', () => {
    const model = derive({ appointments: ready([{ id: 'completed', status: 'completed', updatedAt: '2026-10-07T06:00:00Z' }, { id: 'unknown-time', status: 'completed' }]), documentActivity: ready([{ id: 'new', created_at: '2026-10-08T04:00:00Z' }, { id: 'old', created_at: '2026-08-01T00:00:00Z' }, { id: 'future', created_at: '2027-01-01T00:00:00Z' }]) })
    expect(model.recentChanges.map(row => row.title)).toEqual(['Your health document was added.', 'Your appointment is marked completed.'])
    expect(model.members[0].lastRelevantHealthEventAt).toBe('2026-10-08T04:00:00Z')
    expect(model.upcomingCare).toEqual([])
  })
  it('uses only valid projected progress and omits blocked progress or candidate values', () => {
    const model = derive({ carePlan: ready([{ ...plan, occurrences: [], progress: { today: { total: 4, completed: 2 } } }]), documentIntelligence: ready({ items: [{ fact_id: 'f', source_document_id: 'doc', review_status: 'needs_review', value_text: 'NOT CLINICAL TRUTH', name: 'NOT CLINICAL TRUTH' }] }) })
    expect(model.members[0].carePlanProgress).toMatchObject({ completed: 2, total: 4 })
    expect(JSON.stringify(model)).not.toContain('NOT CLINICAL TRUTH')
    expect(derive({ carePlan: { status: 'not_authorized', data: [plan] } }).members[0].carePlanProgress).toBeNull()
  })
  it('uses the group aggregation API instead of per-member directory reads', async () => {
    const getGroups = vi.fn().mockResolvedValue([{ id: 'g', display_name: 'Kyaw Family' }])
    const health = { getGroups, loadCommandCenterGroup: vi.fn().mockResolvedValue([{ member: { patient_id: 'mother', display_name: 'Mother' }, authorizationStatus: 'active', permissions: { records: true }, sections: base.sections }]), getMembers: vi.fn(), loadHealth: vi.fn().mockResolvedValue(base) }
    const model = await createFamilyCommandCenterService(health, { listMyPlans: async () => [] }, () => now).load({ id: 'owner' })
    expect(model.members).toHaveLength(2)
    expect(model.familyName).toBe('Kyaw Family')
    expect(getGroups).toHaveBeenCalledOnce()
    expect(health.loadCommandCenterGroup).toHaveBeenCalledOnce()
    expect(health.getMembers).not.toHaveBeenCalled()
    expect(health.loadHealth).toHaveBeenCalledOnce()
  })
  it('keeps the attention reason tied to an unresolved review even if todays appointment is the primary action', () => {
    const model = derive({ appointments: ready([{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-08T09:00:00Z' }]), documentIntelligence: ready({ items: [{ fact_id: 'f', review_status: 'needs_review' }] }) })
    expect(model.members[0].nextAction.title).toBe('View upcoming appointment')
    expect(model.members[0].statusReason).toBe('Review document item')
  })
  it('makes only read RPC calls for own plan enrichment, never clinical write intents', async () => {
    const calls = []
    const care = new Proxy({}, { get(_, name) { return async (...args) => { calls.push([name, ...args]); if (name === 'listMyPlans') return [{ id: 'p', patient_id: 'owner', status: 'active' }]; if (name === 'getDetail') return { plan: { id: 'p', status: 'active' } }; if (name === 'getOccurrences') return []; throw new Error(`Unexpected write intent: ${String(name)}`) } } })
    const health = { getGroups: async () => [], loadHealth: async () => structuredClone(base) }
    await createFamilyCommandCenterService(health, care, () => now).load({ id: 'owner' })
    expect(calls).toEqual([['listMyPlans'], ['getDetail', 'p'], ['getOccurrences', 'p']])
  })
  it('does not attribute other authorized patients care plans to self', async () => {
    const care = { listMyPlans: async () => [{ id: 'foreign-plan', patient_id: 'unrelated', status: 'active' }], getDetail: vi.fn(), getOccurrences: vi.fn() }
    const health = { getGroups: async () => [], loadHealth: async () => structuredClone(base) }
    const model = await createFamilyCommandCenterService(health, care, () => now).load({ id: 'owner' })
    expect(model.members[0].activeCarePlanCount).toBe(0)
    expect(care.getDetail).not.toHaveBeenCalled()
  })
  it('has a deterministic stable fallback and one primary action', () => {
    const model = derive({})
    expect(model.members[0].status).toBe('stable')
    expect(model.members[0].nextAction.title).toBe('No action needed right now')
    expect(model.nextActions).toEqual([])
    expect(derive({})).toEqual(model)
  })
  it('prioritizes overdue follow-up over review and upcoming care', () => {
    const model = derive({ carePlan: ready([plan]), appointments: ready([{ id: 'appt', scheduledStart: '2026-10-09T05:00:00Z', status: 'confirmed' }]), documentIntelligence: ready({ items: [{ fact_id: 'fact', review_status: 'needs_review', fact_type: 'condition_candidate', name: 'PRIVATE DIAGNOSIS', review_created_at: '2026-10-07T04:00:00Z' }] }) })
    expect(model.members[0].status).toBe('needs_attention')
    expect(model.members[0].nextAction.title).toBe('Review overdue follow-up')
    expect(model.nextActions).toHaveLength(1)
    expect(model.attentionItems).toHaveLength(2)
    expect(model.upcomingCare).toHaveLength(1)
    expect(model.recentChanges.map(row => row.title)).toContain('Your care plan was updated.')
    expect(JSON.stringify(model)).not.toContain('PRIVATE DIAGNOSIS')
  })
  it('monitors active plans, future follow-ups, appointments and medications', () => {
    for (const sections of [{ carePlan: ready([{ ...plan, occurrences: [] }]) }, { carePlan: ready([{ ...plan, occurrences: [{ ...plan.occurrences[0], scheduled_at: '2026-10-09T05:00:00Z' }] }]) }, { appointments: ready([{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-09T05:00:00Z' }]) }, { medications: ready([{ id: 'med' }]) }]) expect(derive(sections).members[0].status).toBe('monitoring')
  })
  it('never consumes blocked data or equates candidate confirmation with clinical truth', () => {
    const model = derive({ carePlan: { status: 'revoked', data: [plan] }, documentIntelligence: ready({ items: [{ review_status: 'confirmed', name: 'DIAGNOSIS', attention_level: 'source_flagged' }] }) })
    expect(model.attentionItems).toEqual([])
    expect(model.members[0].activeCarePlanCount).toBe(0)
    expect(model.members[0].limitedAccess).toBe(true)
    expect(JSON.stringify(model)).not.toContain('DIAGNOSIS')
  })
  it('excludes cancelled and completed tasks, records real completion and scheduled events', () => {
    const model = derive({ carePlan: ready([{ ...plan, occurrences: [{ ...plan.occurrences[0], status: 'completed', completed: true, completed_at: '2026-10-07T06:00:00Z' }] }]), appointments: ready([{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-09T05:00:00Z', createdAt: '2026-10-07T06:00:00Z' }]) })
    expect(model.attentionItems).toEqual([])
    expect(model.recentChanges.map(row => row.title)).toEqual(expect.arrayContaining(['Your follow-up was completed.', 'Your appointment was scheduled.']))
  })
  it('includes own family only through directory membership and performs no writes', async () => {
    const health = { getGroups: vi.fn().mockResolvedValue([{ id: 'group' }]), getMembers: vi.fn().mockResolvedValue([{ member_id: 'mother', patient_id: 'family' }]), loadHealth: vi.fn().mockImplementation(async input => input.selfPatient ? structuredClone(base) : { member: { patient_id: 'unrelated' }, sections: { carePlan: ready([plan]) } }) }
    const care = { listMyPlans: vi.fn().mockResolvedValue([]) }
    const result = await createFamilyCommandCenterService(health, care, () => now).load({ id: 'owner' })
    expect(result.members.map(row => row.patientId)).toEqual(['owner'])
    expect(health.loadHealth).toHaveBeenCalledWith({ groupId: 'group', memberId: 'mother', commandCenter: true })
    expect(Object.keys(care)).toEqual(['listMyPlans'])
  })
  it('includes accepted matching family and drops removed members', async () => {
    const health = { getGroups: async () => [{ id: 'g' }], getMembers: async () => [{ member_id: 'm', patient_id: 'family' }], loadHealth: async input => input.selfPatient ? structuredClone(base) : { member: { patient_id: 'family', member_id: 'm', display_name: 'Mother' }, authorizationStatus: 'active', permissions: { records: true }, sections: base.sections } }
    const service = createFamilyCommandCenterService(health, { listMyPlans: async () => [] }, () => now)
    expect((await service.load({ id: 'owner' })).members).toHaveLength(2)
    health.loadHealth = async input => input.selfPatient ? structuredClone(base) : { membershipRemoved: true }
    expect((await service.load({ id: 'owner' })).members).toHaveLength(1)
  })
})
