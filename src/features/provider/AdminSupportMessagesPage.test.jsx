import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminSupportMessagesPage } from './AdminSupportMessagesPage.jsx'

const { api } = vi.hoisted(() => ({ api: {
  listAdminConversations: vi.fn(), listAdminMessages: vi.fn(), sendAdminReply: vi.fn(), subscribeAdminInbox: vi.fn(() => () => {}),
} }))
vi.mock('../../services/supportMessagingService.js', () => ({ supportMessagingService: api }))
vi.mock('../auth/WorkspaceSwitcher.jsx', () => ({ WorkspaceSwitcher: () => null }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'admin-profile' } }) }))

describe('Admin support inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listAdminConversations.mockResolvedValue([{ conversation_id: 'c-1', patient_name: 'Patient Example', status: 'active', updated_at: '2026-10-12T00:00:00Z' }])
    api.listAdminMessages.mockResolvedValue([{ message_id: 'm-1', body: 'Can you help?', sender_is_support: false, created_at: '2026-10-12T00:00:00Z' }])
    api.sendAdminReply.mockResolvedValue([{ message_id: 'm-2' }])
  })

  it('opens the RPC inbox and sends an RPC reply', async () => {
    let onRealtime
    const unsubscribe = vi.fn()
    api.subscribeAdminInbox.mockImplementation((_id, onChange) => { onRealtime = onChange; return unsubscribe })
    render(<MemoryRouter><AdminSupportMessagesPage /></MemoryRouter>)
    expect(await screen.findByText('Can you help?')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Support Messages' })).toBeInTheDocument()
    expect(screen.getAllByText('Patient Example')).toHaveLength(2)
    expect(api.subscribeAdminInbox).toHaveBeenCalledWith('admin-profile', expect.any(Function), expect.any(Function))
    onRealtime({ conversation_id: 'c-1', event: 'message_changed' })
    await vi.waitFor(() => expect(api.listAdminConversations).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText('Reply to patient'), { target: { value: '  I can help.  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    expect(api.sendAdminReply).toHaveBeenCalledWith('c-1', 'I can help.')
  })
})
