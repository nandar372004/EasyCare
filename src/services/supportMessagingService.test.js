import { describe, expect, it, vi } from 'vitest'
import { createSupportMessagingService } from './supportMessagingService.js'

describe('support messaging Realtime subscriptions', () => {
  it('uses a private patient topic, ignores mismatched events, and removes its channel', () => {
    const received = vi.fn()
    const status = vi.fn()
    let onBroadcast
    let onStatus
    const channel = {
      on: vi.fn((_type, _filter, callback) => { onBroadcast = callback; return channel }),
      subscribe: vi.fn(callback => { onStatus = callback; return channel }),
    }
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() }
    const service = createSupportMessagingService(client)
    const conversationId = '123e4567-e89b-42d3-a456-426614174000'
    const unsubscribe = service.subscribePatientConversation(conversationId, received, status)

    expect(client.channel).toHaveBeenCalledWith(`support:${conversationId}`, { config: { private: true } })
    onStatus('SUBSCRIBED')
    onBroadcast({ payload: { conversation_id: 'different-conversation', event: 'message_changed' } })
    onBroadcast({ payload: { conversation_id: conversationId, event: 'message_changed' } })
    expect(status).toHaveBeenCalledWith('SUBSCRIBED')
    expect(received).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(client.removeChannel).toHaveBeenCalledWith(channel)
  })

  it('routes the designated inbox listener to its own private topic', () => {
    const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn() }
    createSupportMessagingService(client).subscribeAdminInbox('admin-profile', vi.fn())
    expect(client.channel).toHaveBeenCalledWith('support:admin:admin-profile', { config: { private: true } })
  })
})
