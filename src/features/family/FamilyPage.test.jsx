import { withViewerRelationships } from '../../services/familyRelationship.js'
﻿import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FamilyPage } from './FamilyPage.jsx'
import { familyService } from '../../services/familyService.js'
const { auth } = vi.hoisted(() => ({ auth: { status: 'authenticated', patient: { id: 'own-patient', date_of_birth: '1990-01-01' }, user: { id: 'own-profile' } } }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/familyService.js', () => ({ familyService: {
  loadMyFamilyManagement: vi.fn(), getFamilyMembers: vi.fn(), createFamilyGroup: vi.fn(), createFamilyJoinCode: vi.fn(),
  inviteFamilyMember: vi.fn(), acceptFamilyInvitation: vi.fn(), declineFamilyInvitation: vi.fn(), cancelFamilyInvitation: vi.fn(),
  removeFamilyMember: vi.fn(), grantFamilyAuthorization: vi.fn(), revokeFamilyAuthorization: vi.fn(),
} }))
const ready = data => ({ status: 'ready', data })
const group = { id: 'group', display_name: 'Recorded Family', is_owner: true }
const member = { id: 'member', display_name: 'Recorded Adult', relationship: 'parent', role: 'member', is_self: false, authorization: null }
function sections(groups = [], invitations = []) { return { groups: ready(groups), invitations: ready(invitations) } }
function renderFamilyPage() { return render(<MemoryRouter><FamilyPage /></MemoryRouter>) }
beforeEach(() => {
  vi.resetAllMocks(); auth.status = 'authenticated'; auth.patient = { id: 'own-patient', date_of_birth: '1990-01-01' }; auth.user = { id: 'own-profile' }
  familyService.loadMyFamilyManagement.mockResolvedValue(sections())
  familyService.getFamilyMembers.mockResolvedValue([{ id: 'self', display_name: 'Recorded Owner', role: 'owner', relationship: 'self', is_self: true }, member])
})
describe('family management UI without clinical aggregation', () => {
  it('shows an eligibility state and invokes no family RPC-backed services for a minor', () => {
    auth.patient = { id: 'own-patient', date_of_birth: '2015-01-01' }
    renderFamilyPage()
    expect(screen.getByRole('status')).toHaveTextContent('Family management is currently available to active accounts aged 18 or older with a recorded date of birth.')
    expect(screen.queryByRole('button', { name: 'Create Family' })).not.toBeInTheDocument()
    expect(familyService.loadMyFamilyManagement).not.toHaveBeenCalled()
    expect(familyService.createFamilyGroup).not.toHaveBeenCalled()
    expect(familyService.createFamilyJoinCode).not.toHaveBeenCalled()
  })

  it('shows the eligibility state when DOB is missing', () => {
    auth.patient = { id: 'own-patient', date_of_birth: null }
    renderFamilyPage()
    expect(screen.getByRole('status')).toHaveTextContent(/available to active accounts aged 18 or older/)
    expect(familyService.loadMyFamilyManagement).not.toHaveBeenCalled()
  })

  it('shows truthful loading/empty states with no fabricated members or health status', async () => {
    renderFamilyPage()
    expect(screen.getByText('Loading families...')).toBeInTheDocument()
    expect(await screen.findByText('No family groups yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'My Family' })).toBeInTheDocument()
    expect(screen.getByText('No family invitations.')).toBeInTheDocument()
    expect(screen.getByText(/Membership and relationship labels never share health information by themselves/)).toBeInTheDocument()
    expect(screen.queryByText(/Nandar|Mom|Dad|High BP|Medication Due|Stable/)).not.toBeInTheDocument()
    expect(familyService.loadMyFamilyManagement).toHaveBeenCalledWith()
  })
  it('renders actual members and management roles without clinical fields', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
    renderFamilyPage()
    expect(await screen.findByText('Recorded Adult')).toBeInTheDocument()
    expect(familyService.getFamilyMembers).toHaveBeenCalledWith('group')
    expect(screen.getByText('Access you granted: Not granted')).toBeInTheDocument()
    expect(screen.queryByLabelText(/patient id|phone|email/i)).not.toBeInTheDocument()
  })
  it('creates real groups and generates only a server-provided join code', async () => {
    familyService.createFamilyJoinCode.mockResolvedValue('server-generated-code')
    renderFamilyPage()
    await screen.findByText('No family groups yet.')
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'A new group' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Family', exact: true }))
    await waitFor(() => expect(familyService.createFamilyGroup).toHaveBeenCalledWith('A new group'))
    await screen.findByText('Family created.')
    fireEvent.click(screen.getByRole('button', { name: 'Generate Invitation Code' }))
    expect(await screen.findByDisplayValue('server-generated-code')).toBeInTheDocument()
  })
  it('invites using the member code and distinguishes membership from access', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
    renderFamilyPage()
    await screen.findByText('Recorded Adult')
    fireEvent.change(screen.getByLabelText("Member's invitation code"), { target: { value: 'shared-code' } })
    fireEvent.change(screen.getByLabelText('Relationship to you'), { target: { value: 'parent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }))
    await waitFor(() => expect(familyService.inviteFamilyMember).toHaveBeenCalledWith('group', 'shared-code', 'parent'))
    expect(familyService.grantFamilyAuthorization).not.toHaveBeenCalled()
  })
  it.each([['Accept Invitation', 'acceptFamilyInvitation'], ['Decline Invitation', 'declineFamilyInvitation'], ['Cancel Invitation', 'cancelFamilyInvitation']])('supports %s from actual invitation data', async (label, method) => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([], [{ id: 'invite', display_name: 'Inviting family', is_incoming: method !== 'cancelFamilyInvitation', relationship: 'parent', status: 'pending', expires_at: '2030-01-01T00:00Z' }]))
    renderFamilyPage()
    fireEvent.click(await screen.findByRole('button', { name: label }))
    await waitFor(() => expect(familyService[method]).toHaveBeenCalledWith('invite'))
    expect(familyService.grantFamilyAuthorization).not.toHaveBeenCalled()
  })
  it('requires explicit scopes, consent and expiry to grant the caller own access', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
    renderFamilyPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Access' }))
    expect(screen.getByRole('heading', { name: 'Share Your Information with Recorded Adult' })).toBeInTheDocument()
    const form = screen.getByRole('button', { name: 'Grant Selected Access' }).closest('form')
    expect(screen.getAllByRole('checkbox').every(box => !box.checked)).toBe(true)
    expect(within(screen.getByText('Care Plans').closest('label')).getByRole('checkbox')).not.toBeChecked()
    fireEvent.submit(form)
    expect(familyService.grantFamilyAuthorization).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Health records, vitals and labs'))
    fireEvent.change(screen.getByLabelText(/Access expires/), { target: { value: '2027-01-01T10:00' } })
    fireEvent.click(screen.getByLabelText(/I consent to sharing/))
    fireEvent.submit(form)
    await waitFor(() => expect(familyService.grantFamilyAuthorization).toHaveBeenCalledWith('member', { records: true, appointments: false, medications: false, payments: false, alerts: false, care_plans: false }, new Date('2027-01-01T10:00').toISOString()))
  })
  it('grants Care Plans as its own permission without enabling Records', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
    renderFamilyPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Access' }))
    fireEvent.click(within(screen.getByText('Care Plans').closest('label')).getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText(/Access expires/), { target: { value: '2027-01-01T10:00' } })
    fireEvent.click(screen.getByLabelText(/I consent to sharing/))
    fireEvent.click(screen.getByRole('button', { name: 'Grant Selected Access' }))
    await waitFor(() => expect(familyService.grantFamilyAuthorization).toHaveBeenCalledWith('member', { records: false, appointments: false, medications: false, payments: false, alerts: false, care_plans: true }, new Date('2027-01-01T10:00').toISOString()))
  })
  it('revokes actual authorizations and removes membership without deletion APIs', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
    familyService.getFamilyMembers.mockResolvedValue([{ ...member, authorization: { id: 'grant', status: 'active', expires_at: '2027-01-01', records: true } }])
    renderFamilyPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Access' }))
    await waitFor(() => expect(familyService.revokeFamilyAuthorization).toHaveBeenCalledWith('grant'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Member' }))
    await waitFor(() => expect(familyService.removeFamilyMember).toHaveBeenCalledWith('member'))
  })
  it('isolates invitation errors and shows mutation failures honestly', async () => {
    familyService.loadMyFamilyManagement.mockResolvedValue({ groups: ready([group]), invitations: { status: 'error' } })
    familyService.inviteFamilyMember.mockRejectedValue(new Error('Operation unavailable'))
    renderFamilyPage()
    await screen.findByText('Recorded Adult')
    expect(screen.getByText('Unable to load invitations.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Member's invitation code"), { target: { value: 'bad-code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }))
    expect(await screen.findByText('Operation unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument()
  })
  it('clears and ignores private data after the authenticated account changes', async () => {
    let finish
    familyService.loadMyFamilyManagement.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const page = renderFamilyPage()
    auth.user = { id: 'second-account' }; auth.patient = { id: 'second-patient', date_of_birth: '1990-01-01' }
    page.rerender(<MemoryRouter><FamilyPage /></MemoryRouter>)
    await screen.findByText('No family groups yet.')
    await act(async () => finish(sections([{ ...group, display_name: 'PRIVATE OLD FAMILY' }])))
    expect(screen.queryByText('PRIVATE OLD FAMILY')).not.toBeInTheDocument()
  })
  it('does not load real data for a prototype identity without an Auth account', () => {
    auth.user = null; auth.patient = { isPrototype: true }
    renderFamilyPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in with an EasyCare patient account')
    expect(familyService.loadMyFamilyManagement).not.toHaveBeenCalled()
  })
})



it('shows viewer-relative owner labels separately from administrative owner role',async()=>{
  familyService.loadMyFamilyManagement.mockResolvedValue(sections([{...group,is_owner:false}]))
  familyService.getFamilyMembers.mockResolvedValue([
    {id:'father',display_name:'Kyaw Aung Moe',role:'member',relationship:'father',relationshipLabel:'Self',is_self:true},
    {id:'child',display_name:'Nandar',role:'owner',relationship:'self',relationshipLabel:'Child',is_self:false},
  ])
  renderFamilyPage()
  await screen.findByText('Nandar')
  expect(screen.getByText('Child · owner · Connected')).toBeInTheDocument()
  expect(screen.getByText('Self · member · Connected')).toBeInTheDocument()
  expect(screen.queryByText(/Family owner/)).not.toBeInTheDocument()
})

it.each(['Friend','Lover'])('offers %s with a lowercase invitation value',async label=>{
  familyService.loadMyFamilyManagement.mockResolvedValue(sections([group]))
  familyService.inviteFamilyMember.mockResolvedValue('invitation')
  renderFamilyPage()
  await screen.findByText('Recorded Adult')
  const dropdown=screen.getByLabelText('Relationship to you')
  const option=within(dropdown).getByRole('option',{name:label})
  expect(option).toHaveValue(label.toLowerCase())
  expect(within(dropdown).getAllByRole('option').map(o=>o.textContent)).toEqual(['Spouse','Lover','Friend','Mother','Father','Parent','Child','Sibling','Guardian','Other'])
  fireEvent.change(dropdown,{target:{value:label.toLowerCase()}})
  fireEvent.change(screen.getByLabelText("Member's invitation code"),{target:{value:'99000000-0000-4000-8000-000000000022'}})
  fireEvent.click(screen.getByRole('button',{name:'Send Invitation'}))
  await waitFor(()=>expect(familyService.inviteFamilyMember).toHaveBeenCalledWith(group.id,'99000000-0000-4000-8000-000000000022',label.toLowerCase()))
})

it.each([['father','Wife'],['mother','Husband']])('management shows the supported parent pair to %s',async (viewer,label)=>{
  auth.patient={id:viewer,date_of_birth:'1990-01-01'}
  familyService.loadMyFamilyManagement.mockResolvedValue(sections([{...group,is_owner:false}]))
  const rows=withViewerRelationships([
    {id:'owner',patient_id:'owner',display_name:'Nandar',role:'owner',relationship:'self'},
    {id:'father',patient_id:'father',display_name:'Kyaw Aung Moe',role:'member',relationship:'father',is_self:viewer==='father'},
    {id:'mother',patient_id:'mother',display_name:'Shwe Hnin San',role:'member',relationship:'mother',is_self:viewer==='mother'},
  ],{groupId:group.id})
  familyService.getFamilyMembers.mockResolvedValue(rows)
  renderFamilyPage()
  await screen.findByText('Nandar')
  expect(screen.getByText(label+' · member · Connected')).toBeInTheDocument()
  expect(screen.getByText('Child · owner · Connected')).toBeInTheDocument()
})
