import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { familyService } from '../../services/familyService.js'
import { FamilyAccessPermissions } from './FamilyAccessPermissions.jsx'

vi.mock('../../services/familyService.js', () => ({ familyService: {
  loadMyFamilyManagement: vi.fn(), getFamilyMembers: vi.fn(), grantFamilyAuthorization: vi.fn(), revokeFamilyAuthorization: vi.fn(),
} }))
const group = { id: 'group-1', display_name: 'Kyaw Family', is_owner: true }
const activeMember = { id: 'member-1', display_name: 'Eaindray Kyaw', relationshipLabel: 'Sibling', role: 'member', is_self: false, authorization: { id: 'grant-1', status: 'active', expires_at: '2027-10-13T00:00:00.000Z', appointments: true, care_plans: true, payments: false, records: true, medications: true, alerts: false } }
const self = { id: 'self', display_name: 'Nandar Kyaw', relationshipLabel: 'Self', role: 'owner', is_self: true, authorization: null }
const ready = data => ({ status: 'ready', data })

beforeEach(() => {
  vi.resetAllMocks()
  familyService.loadMyFamilyManagement.mockResolvedValue({ groups: ready([group]), invitations: ready([]) })
  familyService.getFamilyMembers.mockResolvedValue([self, activeMember])
  familyService.grantFamilyAuthorization.mockResolvedValue('grant-1')
  familyService.revokeFamilyAuthorization.mockResolvedValue(undefined)
})

describe('My Family access permissions', () => {
  it('shows current persisted scopes and ties Medical Documents to Health Records', async () => {
    render(<FamilyAccessPermissions familyName="Kyaw Family" />)
    expect(await screen.findByRole('heading', { name: 'Access & Permissions' })).toBeInTheDocument()
    expect(screen.getByText('Kyaw Family · Membership does not automatically share health information.')).toBeInTheDocument()
    const card = (await screen.findByText('Eaindray Kyaw')).closest('article')
    expect(within(card).getAllByText('Allowed')).not.toHaveLength(0)
    expect(within(card).getAllByText('Not Allowed')).not.toHaveLength(0)
    expect(within(card).getByText('Allowed via Records')).toBeInTheDocument()
    expect(screen.queryByText('Nandar Kyaw')).not.toBeInTheDocument()
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('saves explicit permission changes through the existing grant RPC with expiry and consent', async () => {
    render(<FamilyAccessPermissions familyName="Kyaw Family" />)
    const card = await screen.findByText('Eaindray Kyaw').then(node => node.closest('article'))
    fireEvent.click(within(card).getByRole('button', { name: 'Manage permissions' }))
    fireEvent.click(within(card).getByLabelText(/Payments/))
    fireEvent.change(within(card).getByLabelText('Access expires'), { target: { value: '2027-09-01T10:00' } })
    fireEvent.click(within(card).getByLabelText(/I consent to sharing/))
    fireEvent.click(within(card).getByRole('button', { name: 'Save permissions' }))
    await waitFor(() => expect(familyService.grantFamilyAuthorization).toHaveBeenCalledWith('member-1', {
      appointments: true, care_plans: true, payments: true, records: true, medications: true, alerts: false,
    }, new Date('2027-09-01T10:00').toISOString()))
    expect(familyService.revokeFamilyAuthorization).not.toHaveBeenCalled()
  })

  it('revokes all existing access when the owner turns every scope off', async () => {
    render(<FamilyAccessPermissions familyName="Kyaw Family" />)
    const card = await screen.findByText('Eaindray Kyaw').then(node => node.closest('article'))
    fireEvent.click(within(card).getByRole('button', { name: 'Manage permissions' }))
    for (const name of ['Appointments / Booking', 'Care Plan', 'Health Records', 'Medications']) {
      fireEvent.click(within(card).getByLabelText(new RegExp(name)))
    }
    fireEvent.click(within(card).getByRole('button', { name: 'Revoke all access' }))
    await waitFor(() => expect(familyService.revokeFamilyAuthorization).toHaveBeenCalledWith('grant-1'))
    expect(familyService.grantFamilyAuthorization).not.toHaveBeenCalled()
  })

  it('does not expose controls for expired authorizations', async () => {
    familyService.getFamilyMembers.mockResolvedValue([{ ...activeMember, authorization: { ...activeMember.authorization, status: 'expired', expires_at: '2020-01-01T00:00:00.000Z' } }])
    render(<FamilyAccessPermissions familyName="Kyaw Family" />)
    const card = await screen.findByText('Eaindray Kyaw').then(node => node.closest('article'))
    expect(within(card).getByText('Expired')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Manage permissions' })).not.toBeInTheDocument()
  })
})
