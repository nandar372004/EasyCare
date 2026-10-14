import { withViewerRelationships } from '../../services/familyRelationship.js'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { FamilyCommandCenterView } from './FamilyCommandCenterPage.jsx'
import { deriveFamilyCommandCenter } from '../../services/familyCommandCenterService.js'
const now = new Date('2026-10-08T05:00:00Z')
const show = props => render(<MemoryRouter><FamilyCommandCenterView {...props} /></MemoryRouter>)
describe('command center UI', () => {
  it('does not imply revoked sharing removed the accepted Health Circle relationship', () => {
    show({ model: { ...deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: {} }], now), hasConnectedMembers: true } })
    expect(screen.getByText('No family health access is shared right now. Manage your Health Circle to review sharing.')).toBeInTheDocument()
    expect(screen.queryByText('Add someone to your Health Circle to manage care together.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Health Circle sharing' })).toHaveAttribute('href', '/family')
  })
  it('shows skeleton loading and safe error states', () => {
    const view = show({ loading: true })
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading family health overview')
    view.unmount()
    show({ error: true })
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your family health overview. Please try again.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
  it('shows the existing group name in the banner and keeps the management link', () => {
    const model = { ...deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: {} }], now), familyName: 'Kyaw Family' }
    const view = show({ model })
    expect(screen.getByRole('heading', { level: 1, name: 'Kyaw Family' })).toBeInTheDocument()
    expect(screen.getByText('YOUR HEALTH CIRCLE')).toBeInTheDocument()
    expect(screen.getByText('Manage your family’s care, appointments, and updates together.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Health Circle' })).toHaveAttribute('href', '/family')
    expect(view.container.querySelector('.command-banner-artwork img')).toHaveAttribute('src', '/family-health-circle.png')
    view.rerender(<MemoryRouter><FamilyCommandCenterView model={{ ...model, familyName: 'Changed group name' }} /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Changed group name' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Kyaw Family' })).not.toBeInTheDocument()
  })
  it('uses My Family when the group name is unavailable', () => {
    show({ model: deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: {} }], now) })
    expect(screen.getByRole('heading', { level: 1, name: 'My Family' })).toBeInTheDocument()
  })
  it('shows empty family and care states', () => {
    show({ model: deriveFamilyCommandCenter('owner', [], now) })
    expect(screen.getByText('Add someone to your Health Circle to manage care together.')).toBeInTheDocument()
    expect(screen.getByText('Everyone is up to date.')).toBeInTheDocument()
    expect(screen.getByText('No upcoming care scheduled.')).toBeInTheDocument()
  })
  it('renders cards and actionable sections with valid destinations', () => {
    const model = deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: { appointments: { status: 'ready', data: [{ id: 'a', status: 'pending', scheduledStart: '2026-10-09T05:00:00Z', createdAt: '2026-10-07T05:00:00Z' }] } } }], now)
    show({ model })
    expect(within(screen.getByRole('region', { name: 'Who needs attention' })).getByText('Review pending appointment')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Upcoming care' })).getByRole('link')).toHaveAttribute('href', '/appointments/a')
    expect(within(screen.getByRole('region', { name: 'Recent changes' })).getByText('Your appointment was scheduled.')).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })
  it('shows summary counts and supports keyboard expansion without exposing blocked detail', async () => {
    const model = deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'mother', member_id: 'm', groupId: 'g', display_name: 'Mother', relationship: 'mother' }, sections: { carePlan: { status: 'not_authorized', data: [{ plan: { id: 'SECRET PLAN', status: 'active' } }] } } }], now)
    show({ model })
    const overviewRegion = screen.getByRole('region', { name: 'Family health summary' })
    const overview = within(overviewRegion)
    expect(overview.getByRole('heading', { name: 'Family Health Overview' })).toBeInTheDocument()
    expect(overviewRegion.querySelector('.command-summary-metric--total strong')).toHaveTextContent('1')
    expect(overview.getByText('family members')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Show care details for Mother' })
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getByRole('region', { name: 'Care details for Mother' })
    expect(button).toHaveAttribute('aria-controls', details.id)
    expect(within(details).getByText('No active care plan in shared information.')).toBeInTheDocument()
    expect(screen.queryByText('SECRET PLAN')).not.toBeInTheDocument()
    expect(within(details).getByRole('link')).toHaveAttribute('href', '/family/health?groupId=g&memberId=m')
    await userEvent.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Care details for Mother' })).not.toBeInTheDocument()
  })
  it('renders the redesigned independent lower columns and family overview sections', () => {
    const model = deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: {} }], now)
    const { container } = show({ model })
    expect(screen.getByRole('heading', { name: 'Family Health Overview' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Next family action' })).toHaveTextContent('No action needed right now')
    expect(screen.getByRole('heading', { name: 'Family Members' })).toBeInTheDocument()
    const columns = container.querySelectorAll('.command-lower-column')
    expect(columns).toHaveLength(2)
    expect(within(columns[0]).getAllByRole('region').map(region => region.getAttribute('aria-label')))
      .toEqual(['Who needs attention', 'Upcoming care'])
    expect(within(columns[1]).getAllByRole('region').map(region => region.getAttribute('aria-label')))
      .toEqual(['Next actions', 'Recent changes'])
  })
  it('shows progress, last activity and time groups with descriptive links', () => {
    const model = deriveFamilyCommandCenter('owner', [{ member: { patient_id: 'owner', display_name: 'Me' }, sections: { appointments: { status: 'ready', data: [{ id: 'a', status: 'confirmed', scheduledStart: '2026-10-09T05:00:00Z' }] }, documentActivity: { status: 'ready', data: [{ id: 'd', created_at: '2026-10-07T05:00:00Z' }] }, carePlan: { status: 'ready', data: [{ plan: { id: 'p', status: 'active' }, progress: { today: { completed: 2, total: 4 } } }] } } }], now)
    show({ model })
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2')
    expect(screen.getByText('Last activity')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Upcoming care' })).getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Recent changes' })).getByRole('link', { name: /View documents/ })).toHaveAttribute('href', '/medical-documents#medical-document-d')
  })
})

describe('relationship labels on overview cards',()=>{
  it.each([
    ['n',['Self','Father','Mother']],
    ['f',['Child','Self','Wife']],
    ['m',['Child','Husband','Self']],
  ])('renders viewer %s with safe perspective labels', (viewer, labels)=>{
    const rows=withViewerRelationships([
      {patient_id:'n',display_name:'Nandar',role:'owner',relationship:'self',is_self:viewer==='n'},
      {patient_id:'f',display_name:'Kyaw Aung Moe',role:'member',relationship:'father',is_self:viewer==='f'},
      {patient_id:'m',display_name:'Mother',role:'member',relationship:'mother',is_self:viewer==='m'},
    ], {groupId:'family'})
    show({model:deriveFamilyCommandCenter(viewer,rows.map(member=>({member,sections:{}})),now)})
    rows.forEach((member,i)=>{
      const card=screen.getByRole('heading',{name:member.display_name}).closest('article')
      expect(within(card).getByText(labels[i],{selector:'.command-relationship'})).toBeInTheDocument()
    })
  })
})
