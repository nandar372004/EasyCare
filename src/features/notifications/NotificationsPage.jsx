import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, CheckCheck, ChevronRight, ClipboardCheck, MessageSquare, Pill, UsersRound } from 'lucide-react'
import { notificationService } from '../../services/notificationService.js'
import { useNotifications } from './NotificationContext.jsx'
import './notifications.css'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const iconByType = {
  medication: Pill,
  booking: CalendarDays,
  visit_status: CalendarDays,
  family_update: UsersRound,
  follow_up: ClipboardCheck,
  care_action: ClipboardCheck,
  health_alert: Bell,
  support_message: MessageSquare,
}

export function notificationDestination(notification) {
  const sourceId = uuid.test(notification?.source_id || '') ? notification.source_id : null
  switch (notification?.type) {
    case 'support_message': return '/messages'
    case 'wellness_check':
      if (notification?.source_type === 'cervical_wellness_medication') return '/my-care-plan#care-my-medications'
      if (notification?.source_type === 'cervical_wellness') return '/my-care-plan'
      return '/dashboard'
    case 'medication': return ['medication_daily', 'medication_done'].includes(notification?.source_type)
      ? '/my-care-plan#care-my-medications' : '/medications'
    case 'booking':
    case 'visit_status': return ['appointment', 'appointment_reminder'].includes(notification?.source_type) && sourceId ? `/appointments/${sourceId}` : '/appointments'
    case 'family_update': return '/family/overview'
    case 'follow_up': return '/my-care-plan'
    case 'care_action': return notification?.source_type === 'monitoring_alert' ? '/dashboard' : '/my-care-plan'
    case 'health_alert': return '/dashboard'
    default: return '/notifications'
  }
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function dayGroup(value, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  return date.toDateString() === now.toDateString() ? 'Today' : 'Earlier'
}

export function NotificationsPage() {
  const { notifications, unreadCount, loading, error, refresh } = useNotifications()
  const [actionError, setActionError] = useState('')
  const navigate = useNavigate()

  async function openNotification(notification) {
    setActionError('')
    try {
      if (!notification.read_at) await notificationService.markRead(notification.id)
      await refresh()
      navigate(notificationDestination(notification))
    } catch {
      setActionError('This notification could not be marked as read. Try again.')
    }
  }

  async function markAllRead() {
    setActionError('')
    try {
      await notificationService.markAllRead()
      await refresh()
    } catch {
      setActionError('Notifications could not be marked as read. Try again.')
    }
  }

  const groups = ['Today', 'Earlier'].map(title => ({ title, rows: notifications.filter(row => dayGroup(row.created_at) === title) })).filter(group => group.rows.length)

  return <section className="notification-page" aria-labelledby="notification-heading">
    <header className="notification-heading"><div><span className="eyebrow">Your updates</span><h1 id="notification-heading">Notifications</h1><p>Messages and care actions connected to your account.</p></div>
      {unreadCount > 0 && <button className="notification-mark-all" type="button" onClick={() => void markAllRead()}><CheckCheck size={17} aria-hidden="true" /> Mark all as read</button>}
    </header>
    {(error || actionError) && <p className="notification-error" role="alert">{actionError || error} <button type="button" onClick={() => void refresh()}>Try again</button></p>}
    <div className="notification-list card" aria-live="polite">
      {loading && !notifications.length ? <p className="notification-empty" role="status">Loading notifications…</p> : !notifications.length ? <div className="notification-empty"><Bell aria-hidden="true" /><strong>You’re all caught up</strong><span>New messages and care actions will appear here.</span></div> : groups.map(group => <section className="notification-group" key={group.title} aria-labelledby={`notification-group-${group.title.toLowerCase()}`}>
        <h2 id={`notification-group-${group.title.toLowerCase()}`}>{group.title}</h2>
        {group.rows.map(notification => {
          const Icon = iconByType[notification.type] || Bell
          const unread = !notification.read_at && notification.status !== 'read'
          return <button type="button" className={`notification-row${unread ? ' is-unread' : ''}`} key={notification.id} onClick={() => void openNotification(notification)}>
            <span className="notification-row-icon"><Icon aria-hidden="true" /></span>
            <span className="notification-row-copy"><strong>{notification.title}</strong><span>{notification.body}</span><time dateTime={notification.created_at}>{formatTime(notification.created_at)}</time></span>
            {unread && <span className="notification-unread-dot" aria-label="Unread" />}
            <ChevronRight className="notification-chevron" aria-hidden="true" />
          </button>
        })}
      </section>)}
    </div>
  </section>
}
