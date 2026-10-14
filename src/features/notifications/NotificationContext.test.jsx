import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationProvider, useNotifications } from './NotificationContext.jsx'

const auth = vi.hoisted(() => ({ patient: { id: 'patient-id' }, user: { id: 'profile-id' }, workspace: 'patient', isPrototypeMode: false }))
const service = vi.hoisted(() => ({
  list: vi.fn(), unreadCount: vi.fn(), subscribe: vi.fn(),
}))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/notificationService.js', () => ({ notificationService: service }))

function State() {
  const { notifications, unreadCount } = useNotifications()
  return <output>{`${notifications.length}:${unreadCount}`}</output>
}

describe('NotificationProvider', () => {
  beforeEach(() => {
    auth.patient = { id: 'patient-id' }; auth.user = { id: 'profile-id' }; auth.workspace = 'patient'; auth.isPrototypeMode = false
    service.list.mockReset().mockResolvedValue([{ id: 'n-1' }])
    service.unreadCount.mockReset().mockResolvedValue(1)
    service.subscribe.mockReset().mockImplementation((_profile, onChange) => { service.onChange = onChange; return vi.fn() })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('refreshes the list and badge on private Realtime hints and cleans up', async () => {
    const view = render(<NotificationProvider><State /></NotificationProvider>)
    await waitFor(() => expect(screen.getByText('1:1')).toBeInTheDocument())
    service.list.mockResolvedValue([{ id: 'n-1' }, { id: 'n-2' }])
    service.unreadCount.mockResolvedValue(2)
    await act(async () => { service.onChange() })
    await waitFor(() => expect(screen.getByText('2:2')).toBeInTheDocument())
    view.unmount()
    expect(service.subscribe).toHaveBeenCalledWith('profile-id', expect.any(Function), expect.any(Function))
    expect(service.subscribe.mock.results[0].value).toHaveBeenCalledOnce()
  })
})
