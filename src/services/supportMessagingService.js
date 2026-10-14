import { supabase } from '../lib/supabase.js'

const FAILURE = 'Unable to load support messages. Please try again.'

export function createSupportMessagingService(client = supabase) {
  async function rpc(name, args) {
    if (!client) throw new Error(FAILURE)
    const { data, error } = await client.rpc(name, args)
    if (error) throw new Error(FAILURE)
    return data
  }

  function subscribe(topic, onChange, onStatus) {
    if (!client || !topic) return () => {}
    const channel = client.channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'message_changed' }, event => {
        const payload = event?.payload ?? event
        if (payload?.event === 'message_changed') onChange?.(payload)
      })
      .subscribe(status => onStatus?.(status))
    return () => { void client.removeChannel(channel) }
  }

  return {
    getOrCreatePatientConversation() { return rpc('get_or_create_my_support_conversation') },
    listPatientMessages(conversationId) { return rpc('list_my_support_messages', { p_conversation_id: conversationId }) },
    sendPatientMessage(conversationId, body) { return rpc('send_my_support_message', { p_conversation_id: conversationId, p_body: body }) },
    listAdminConversations() { return rpc('admin_list_support_conversations') },
    listAdminMessages(conversationId) { return rpc('admin_list_support_messages', { p_conversation_id: conversationId }) },
    sendAdminReply(conversationId, body) { return rpc('admin_send_support_reply', { p_conversation_id: conversationId, p_body: body }) },
    subscribePatientConversation(conversationId, onChange, onStatus) {
      return subscribe(`support:${conversationId}`, event => {
        if (event.conversation_id === conversationId) onChange?.(event)
      }, onStatus)
    },
    subscribeAdminInbox(profileId, onChange, onStatus) {
      return subscribe(`support:admin:${profileId}`, onChange, onStatus)
    },
  }
}

export const supportMessagingService = createSupportMessagingService()
