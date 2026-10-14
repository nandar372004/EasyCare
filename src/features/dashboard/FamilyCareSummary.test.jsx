import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { deriveFamilyCommandCenter, createFamilyCommandCenterService } from '../../services/familyCommandCenterService.js'
import { FamilyCareSummary, summarizeDashboardFamilyCare } from './FamilyCareSummary.jsx'

const now = new Date('2026-10-12T05:00:00Z')
const ready = data => ({ status: 'ready', data })
const sections = () => ({ appointments: ready([]), alerts: ready([]), followUps: ready([]), medications: ready([]), documentIntelligence: ready({ items: [] }), documentActivity: ready([]), carePlan: ready([]) })
const person = (id, changes = {}) => ({ member: { patient_id: id, display_name: id, member_id: `m-${id}`, groupId: 'g' }, sections: { ...sections(), ...changes } })
const overduePlan = { plan: { id: 'p', status: 'active' }, tasks: [{ id: 't', task_type: 'monitoring' }], occurrences: [{ id: 'o', task_id: 't', status: 'pending', scheduled_at: '2026-10-11T05:00:00Z' }] }
const model = () => deriveFamilyCommandCenter('owner', [person('owner'), person('Z-alert', { alerts: ready([{ id: 'alert', status: 'open', title: 'Review recorded monitoring alert' }]), carePlan: ready([overduePlan]) }), person('A-overdue', { carePlan: ready([overduePlan]) }), person('B-today', { carePlan: ready([{ ...overduePlan, occurrences: [{ ...overduePlan.occurrences[0], scheduled_at: '2026-10-12T10:00:00Z' }] }]) }), person('C-appointment', { appointments: ready([{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-13T05:00:00Z' }]) }), person('D-monitoring', { carePlan: ready([{ ...overduePlan, occurrences: [] }]) }), person('E-no-action')], now)
const view = family => <MemoryRouter><FamilyCareSummary family={family} /></MemoryRouter>

describe('dashboard authorized family care', () => {
  it('counts each authorized member once, excludes self and sorts explicit operational actions', () => {
    const summary = summarizeDashboardFamilyCare(model(), now)
    expect(summary.counts).toEqual({ attention: 3, monitoring: 2, noAction: 1, limited: 0 })
    expect(summary.actions.map(item => item.patientId)).toEqual(['Z-alert','A-overdue','B-today','C-appointment','D-monitoring'])
    expect(summary.actions[0]).toMatchObject({ reason: 'Review recorded monitoring alert', cta: 'View monitoring' })
    expect(summary.actions[1].reason).toBe('Review overdue care task')
    expect(summary.actions[2].reason).toBe('Review today’s care task')
    expect(summary.actions[3]).toMatchObject({ reason: 'View upcoming appointment', cta: 'View appointment' })
    expect(summary.actions.every(item => item.destination.startsWith('/family/health?'))).toBe(true)
    expect(summarizeDashboardFamilyCare(model(), now)).toEqual(summary)
  })
  it('renders clear reasons, counts and one next action per person without health inferences', () => {
    render(view({ ...model(), status: 'ready' }))
    const card = within(screen.getByRole('article', { name: 'Family Care Today' }))
    expect(card.getByText('Needs Attention: 3')).toBeInTheDocument()
    expect(card.getByText('Monitoring / Action Due: 2')).toBeInTheDocument()
    expect(card.getByText('No Current Action Due: 1')).toBeInTheDocument()
    expect(card.queryByText('E-no-action')).not.toBeInTheDocument()
    expect(card.getAllByRole('link')).toHaveLength(5)
    expect(card.getByRole('link', { name: 'View monitoring for Z-alert' })).toHaveAttribute('href', '/family/health?groupId=g&memberId=m-Z-alert')
    expect(card.queryByText(/high risk|critical|dangerous|worsening|medically healthy/i)).not.toBeInTheDocument()
  })
  it('uses a neutral empty state and does not count limited sharing as no action', () => {
    const family = deriveFamilyCommandCenter('owner', [person('owner'), person('No-action')], now)
    const page = render(view({ ...family, status: 'ready' }))
    expect(screen.getByText('Everyone is up to date for now.')).toBeInTheDocument()
    family.members[1].limitedAccess = true
    page.rerender(view({ ...family, status: 'ready' }))
    expect(screen.getByText('No Current Action Due: 0')).toBeInTheDocument()
    expect(screen.getByText('No current action found in shared information.')).toBeInTheDocument()
  })
  it.each(['revoked', 'expired', 'not_authorized'])('does not show %s data returned outside the service authorization boundary', async authorizationStatus => {
    const health = { getGroups: async () => [{ id: 'g' }], loadHealth: async () => person('owner'), loadCommandCenterGroup: async () => [{ ...person('Private-person', { carePlan: ready([overduePlan]) }), authorizationStatus, permissions: { care_plans: true } }] }
    const family = await createFamilyCommandCenterService(health, { listMyPlans: async () => [] }, () => now).load({ id: 'owner' })
    render(view({ ...family, status: 'ready' }))
    expect(screen.queryByText('Private-person')).not.toBeInTheDocument()
    expect(screen.getByText('Needs Attention: 0')).toBeInTheDocument()
  })
  it('removes stale details on a loading or failed shared result', () => {
    const page = render(view({ ...model(), status: 'ready' }))
    page.rerender(view(null))
    expect(screen.queryByText('Z-alert')).not.toBeInTheDocument()
    page.rerender(view({ status: 'error' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Family care summary is temporarily unavailable.')
  })
})
