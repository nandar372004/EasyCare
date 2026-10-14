import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabase = { rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }
vi.mock('../lib/supabase.js', () => ({ supabase }))
const { notificationService } = await import('./notificationService.js')

describe('notification service RPC contract', () => {
  beforeEach(() => { vi.clearAllMocks(); supabase.channel.mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }) })
  it('uses only patient-owned RPCs for list, unread count, and read updates', async () => {
    supabase.rpc.mockResolvedValue({ data: 4, error: null })
    await notificationService.list(20, 10)
    await notificationService.unreadCount()
    await notificationService.markRead('notice-id')
    await notificationService.markAllRead()
    expect(supabase.rpc.mock.calls).toEqual([
      ['list_my_notifications', { p_limit: 20, p_offset: 10 }],
      ['get_my_unread_notification_count', undefined],
      ['mark_notification_read', { target_notification_id: 'notice-id' }],
      ['mark_all_my_notifications_read', undefined],
    ])
  })
  it('subscribes to a private profile topic and reliably removes it', () => {
    const on = vi.fn().mockReturnThis(), subscribe = vi.fn().mockReturnThis()
    const channel = { on, subscribe }
    supabase.channel.mockReturnValue(channel)
    const changed = vi.fn(), status = vi.fn()
    const unsubscribe = notificationService.subscribe('profile-id', changed, status)
    expect(supabase.channel).toHaveBeenCalledWith('notifications:profile-id', { config: { private: true } })
    expect(on).toHaveBeenCalledWith('broadcast', { event: 'notification_changed' }, expect.any(Function))
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function))
    const callback = on.mock.calls[0][2]
    callback({ payload: { event: 'notification_changed' } })
    expect(changed).toHaveBeenCalledOnce()
    subscribe.mock.calls[0][0]('SUBSCRIBED')
    expect(status).toHaveBeenCalledWith('SUBSCRIBED')
    unsubscribe()
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel)
  })
})
