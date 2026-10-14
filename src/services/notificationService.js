import { supabase } from '../lib/supabase.js'

function requireClient() {
  if (!supabase) throw new Error('Notifications are not available right now.')
  return supabase
}

async function call(name, args) {
  const { data, error } = await requireClient().rpc(name, args)
  if (error) throw new Error('Notifications are not available right now.')
  return data
}

export const notificationService = {
  persistDailyCervicalWellness: () => call('create_my_daily_cervical_wellness_notifications'),
  list: (limit = 50, offset = 0) => call('list_my_notifications', { p_limit: limit, p_offset: offset }),
  unreadCount: async () => Number(await call('get_my_unread_notification_count')) || 0,
  markRead: id => call('mark_notification_read', { target_notification_id: id }),
  markAllRead: () => call('mark_all_my_notifications_read'),
  subscribe(profileId, onChange, onStatus) {
    if (!supabase || !profileId) return () => {}
    const channel = supabase.channel(`notifications:${profileId}`, { config: { private: true } })
      .on('broadcast', { event: 'notification_changed' }, () => onChange?.())
      .subscribe(status => onStatus?.(status))
    return () => { void supabase.removeChannel(channel) }
  },
}
