import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FamilyCommandCenterView } from './FamilyCommandCenterPage.jsx'
import { deriveFamilyCommandCenter } from '../../services/familyCommandCenterService.js'

const now = new Date('2026-10-08T05:00:00Z')
const ready = data => ({ status: 'ready', data })
const make = sections => deriveFamilyCommandCenter('self', [{ member: { patient_id: 'self', display_name: 'Audit person' }, sections }], now)
const activePlan = extra => ({ plan: { id: 'p', status: 'active', current_version_id: 'v2' }, versions: [{ id: 'v2', title: 'Current plan' }], tasks: [], goals: [], occurrences: [], ...extra })
const display = model => render(<MemoryRouter><FamilyCommandCenterView model={model} /></MemoryRouter>)

describe('family overview related data regressions', () => {
  it('keeps appointment status/time and excludes cancelled/completed upcoming care', () => {
    const model = make({ appointments: ready(['confirmed','pending','cancelled','completed'].map((status,i)=>({ id:`a${i}`,status,scheduledStart:'2026-10-09T05:00:00Z',updatedAt:'2026-10-07T06:00:00Z' }))) })
    expect(model.upcomingCare.map(row=>row.sourceStatus).sort()).toEqual(['confirmed','pending'])
    display(model)
    expect(within(screen.getByRole('region',{ name:'Upcoming care' })).getAllByText(/11:30 AM/)).toHaveLength(2)
  })
  it('includes active rescheduled appointments', () => {
    const model = make({ appointments: ready([{ id:'rescheduled',status:'rescheduled',scheduledStart:'2026-10-09T05:00:00Z' }]) })
    expect(model.upcomingCare).toHaveLength(1)
  })
  it('accepts active plan progress and excludes completed plans', () => {
    const model = make({ carePlan: ready([activePlan({ progress:{today:{total:3,completed:1}} }),{plan:{id:'done',status:'completed'}}]) })
    expect(model.members[0].activeCarePlanCount).toBe(1)
    expect(model.members[0].carePlanProgress).toMatchObject({ total:3,completed:1 })
    expect(model.members[0].carePlanSummaries.map(row=>row.title)).toEqual(['Current plan'])
  })
  it('ignores pending historical-version tasks', () => {
    const model = make({ carePlan: ready([activePlan({tasks:[{id:'old',version_id:'v1',task_type:'instruction'}],occurrences:[{id:'old-o',task_id:'old',version_id:'v1',status:'pending',scheduled_at:'2026-10-07T05:00:00Z'}]})]) })
    expect(model.members[0].nextAction.title).toBe('View active care plan')
  })
  it('uses only current-version tasks, goals and occurrences while preserving projected progress',()=>{
    const model=make({carePlan:ready([activePlan({tasks:[{id:'old',version_id:'v1',task_type:'instruction'},{id:'current',version_id:'v2',task_type:'instruction'}],goals:[{id:'old-goal',version_id:'v1',review_at:'2026-10-09T05:00:00Z'},{id:'current-goal',version_id:'v2',review_at:'2026-10-10T05:00:00Z'}],occurrences:[{id:'old-o',version_id:'v1',task_id:'old',status:'pending',scheduled_at:'2026-10-06T05:00:00Z'},{id:'current-o',version_id:'v2',task_id:'current',status:'pending',scheduled_at:'2026-10-07T05:00:00Z'}],progress:{today:{total:2,completed:1}}})])})
    expect(model.nextActions[0].sourceKey).toContain('current-o')
    expect(model.upcomingCare.map(row=>row.sourceKey)).toEqual(['self:goal:current-goal'])
    expect(model.members[0].carePlanProgress).toMatchObject({total:2,completed:1})
  })
  it('deduplicates standalone and projected follow-ups and uses stored standalone completions',()=>{
    const model=make({followUps:ready([{id:'f',status:'pending',due_at:'2026-10-09T05:00:00Z'},{id:'done',status:'completed',completed_at:'2026-10-07T05:00:00Z'},{id:'cancelled',status:'cancelled',due_at:'2026-10-09T05:00:00Z'}]),carePlan:ready([activePlan({tasks:[{id:'t',version_id:'v2',task_type:'follow_up',follow_up:{id:'f'}}],occurrences:[{id:'o',version_id:'v2',task_id:'t',status:'pending',scheduled_at:'2026-10-09T05:00:00Z'}]})])})
    expect(model.upcomingCare).toHaveLength(1)
    expect(model.recentChanges[0]).toMatchObject({dueAt:'2026-10-07T05:00:00Z',title:'Your follow-up was completed.'})
  })
  it('prioritizes projected overdue follow-up and records only stored completion timestamps', () => {
    const model = make({ carePlan: ready([activePlan({tasks:[{id:'late',version_id:'v2',task_type:'follow_up'},{id:'done',version_id:'v2',task_type:'follow_up'}],occurrences:[{id:'late-o',version_id:'v2',task_id:'late',status:'pending',scheduled_at:'2026-10-07T05:00:00Z'},{id:'done-o',version_id:'v2',task_id:'done',status:'completed',completed:true,completed_at:'2026-10-07T07:00:00Z'}]})]), documentIntelligence:ready({items:[{fact_id:'f',review_status:'needs_review'}]}) })
    expect(model.nextActions).toHaveLength(1)
    expect(model.nextActions[0]).toMatchObject({ priority:1,careType:'Follow-up' })
    expect(model.recentChanges.map(row=>row.dueAt)).toEqual(['2026-10-07T07:00:00Z'])
  })
  it('shows alert metadata and keeps acknowledged alerts explicitly informational', async () => {
    const model = make({alerts:ready([{id:'a',status:'open',title:'Stored alert title',message:'Stored alert message',severity:'critical',detected_at:'2026-10-07T05:00:00Z'}])})
    display(model)
    await userEvent.click(screen.getByRole('button',{name:'Show care details for Audit person'}))
    expect(screen.getAllByText('Stored alert title').length).toBeGreaterThan(0)
    expect(screen.getByText('Stored alert message')).toBeInTheDocument()
    expect(screen.getByText('critical · open')).toBeInTheDocument()
    expect(model.members[0].alerts[0].detectedAt).toBe('2026-10-07T05:00:00Z')
    expect(model.nextActions[0].dueAt).toBeNull()
    const acknowledged=make({alerts:ready([{id:'a',status:'acknowledged'}])})
    expect(acknowledged.members[0].status).toBe('monitoring')
    expect(acknowledged.members[0].alerts[0].informational).toBe(true)
    expect(acknowledged.attentionItems).toEqual([])
  })
  it('counts distinct candidate facts, deduplicates document actions and keeps candidate values out of truth', () => {
    const model = make({documentIntelligence:ready({items:[{fact_id:'f1',source_document_id:'d',review_status:'needs_review',value_text:'CANDIDATE ONLY'},{fact_id:'f2',source_document_id:'d',review_status:'needs_review'},{fact_id:'f2',source_document_id:'d',review_status:'needs_review'},{fact_id:'confirmed',review_status:'confirmed'}]}),documentActivity:ready([{id:'d',created_at:'2026-10-07T05:00:00Z'}])})
    expect(model.members[0].pendingReviewCount).toBe(2)
    expect(model.members[0].pendingReviews).toHaveLength(1)
    expect(JSON.stringify(model)).not.toContain('CANDIDATE ONLY')
    expect(model.recentChanges).toHaveLength(1)
  })
  it('orders real recent events newest-first and skips invalid/future timestamps', () => {
    const model = make({appointments:ready([{id:'a',status:'pending',scheduledStart:'2026-10-09T05:00:00Z',createdAt:'2026-10-06T05:00:00Z'},{id:'done',status:'completed',updatedAt:'2026-10-07T06:00:00Z'}]),documentActivity:ready([{id:'d',created_at:'2026-10-08T04:00:00Z'},{id:'future',created_at:'2027-01-01'},{id:'invalid',created_at:'invalid'}])})
    expect(model.recentChanges.map(row=>row.dueAt)).toEqual(['2026-10-08T04:00:00Z','2026-10-07T06:00:00Z','2026-10-06T05:00:00Z'])
  })
  it('keeps one primary action per member and summary counts equal card statuses', () => {
    const inputs=[{member:{patient_id:'self'},sections:{}},{member:{patient_id:'shared'},sections:{alerts:ready([{id:'a',status:'open'}])}},{member:{patient_id:'monitor'},sections:{carePlan:ready([activePlan({})])}}]
    const model=deriveFamilyCommandCenter('self',inputs,now)
    expect(model.summary).toMatchObject({peopleCount:3,needsAttentionCount:1,monitoringCount:1,stableCount:1})
    expect(new Set(model.nextActions.map(row=>row.patientId)).size).toBe(model.nextActions.length)
    expect(model.summary.nextAction).toEqual(model.nextActions[0])
  })
  it('includes standalone follow-ups without inventing document-level review', () => {
    const model=make({followUps:ready([{id:'f',status:'pending',due_at:'2026-10-07T05:00:00Z'}]),documentActivity:ready([{id:'d',created_at:'2026-10-07T05:00:00Z',review_status:'needs_review'}])})
    expect(model.nextActions[0]).toMatchObject({priority:1,careType:'Follow-up'})
    expect(model.members[0].pendingReviewCount).toBe(0)
  })
  it('compares medication priority six before upcoming care priority seven', () => {
    const model=make({medications:ready([{id:'m',medication_schedules:[{time_of_day:'09:00'}]}]),appointments:ready([{id:'a',status:'confirmed',scheduledStart:'2026-10-12T05:00:00Z'}])})
    expect(model.members[0].nextAction.priority).toBe(6)
    expect(make({medications:ready([{id:'m'}])}).members[0].nextAction.priority).toBe(6)
  })
})
