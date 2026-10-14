import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CalendarDays, ClipboardCheck, HeartPulse, MessageSquare, Pill, UsersRound, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { useNotifications } from './NotificationContext.jsx'
import { notificationService } from '../../services/notificationService.js'
import { notificationDestination } from './NotificationsPage.jsx'
import './globalMascotNotification.css'

export const MascotNotificationContext = createContext(null)

const notificationIcons = {
  medication: Pill,
  booking: CalendarDays,
  visit_status: CalendarDays,
  family_update: UsersRound,
  follow_up: ClipboardCheck,
  care_action: ClipboardCheck,
  health_alert: HeartPulse,
  support_message: MessageSquare,
  wellness_check: HeartPulse,
}

function notificationPreview(value, limit) {
  const text = String(value || '')
  const characters = Array.from(text)
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('').trimEnd()}…` : text
}

export function GlobalMascotNotification({ children }) {
  const auth = useAuth()
  const { notifications, refresh, loading } = useNotifications()
  const navigate = useNavigate()
  const enabled = auth.status === 'authenticated' && auth.workspace === 'patient'
  const owner = enabled ? auth.user?.id || auth.patient?.id : null
  const [queue, setQueue] = useState([])
  const [sequence, setSequence] = useState(null)
  const [wellnessActive, setWellnessActive] = useState(false)
  const [closing, setClosing] = useState(null)
  const [error, setError] = useState('')
  const seen = useRef(new Set())
  const dismissed = useRef(new Set())
  const previousOwner = useRef(owner)
  const exitTimer = useRef()
  const updateSequence = useCallback(item => setSequence(item), [])

  useEffect(() => {
    if (previousOwner.current !== owner || !owner) {
      previousOwner.current = owner; seen.current.clear(); dismissed.current.clear()
      clearTimeout(exitTimer.current); setQueue([]); setSequence(null); setClosing(null)
    }
    if (!owner || loading) return
    const unseen = [...notifications].reverse().filter(item => {
      if (seen.current.has(item.id)) return false
      seen.current.add(item.id)
      // These rows are already presented by the timed Nandar sequence.
      return !item.read_at && ['sent', 'delivered'].includes(item.status)
        && !['cervical_wellness', 'cervical_wellness_medication'].includes(item.source_type)
    })
    setQueue(current => [...current.filter(item => notifications.some(n => n.id === item.id && !n.read_at && ['sent','delivered'].includes(n.status))), ...unseen])
  }, [owner, notifications, loading])
  useEffect(() => () => clearTimeout(exitTimer.current), [])

  const item = owner && previousOwner.current === owner ? sequence || (!wellnessActive && queue[0]) : null
  const exit = useCallback(current => {
    if (!current) return
    if (current.presentation) { current.dismiss?.(); return }
    dismissed.current.add(current.id)
    clearTimeout(exitTimer.current)
    setClosing(current)
    exitTimer.current = setTimeout(() => {
      setClosing(null)
      if (current.presentation) current.dismiss?.()
      else setQueue(items => items.filter(n => n.id !== current.id))
    }, 350)
  }, [])
  const lastVisible = useRef(null)
  useEffect(() => {
    const previous = lastVisible.current
    if (previous && !dismissed.current.has(previous.id) && owner && !wellnessActive
      && (previous.presentation ? !sequence : !queue.some(n => n.id === previous.id) && !sequence)) exit(previous)
    lastVisible.current = item
  }, [item, queue, sequence, owner, wellnessActive, exit])

  const visible = closing || item
  const NotificationIcon = notificationIcons[visible?.type] || Bell
  const title = notificationPreview(visible?.title, 180)
  const body = notificationPreview(visible?.body, 320)
  const context = useMemo(() => ({ setSequence: updateSequence, setWellnessActive }), [updateSequence])
  const open = async () => {
    if (!visible || closing) return
    setError('')
    try {
      if (!visible.presentation) { await notificationService.markRead(visible.id); await refresh() }
      navigate(visible.presentation ? '/my-care-plan' : notificationDestination(visible))
      exit(visible)
    } catch { setError('Could not open this notification. Please try again.') }
  }
  return <MascotNotificationContext.Provider value={context}>
    {children}
    {owner && visible && <aside className={`global-mascot-notification${closing ? ' is-leaving' : ''}`} aria-label="EasyCare notification">
      <div className="mascot-stage">
        <img className="mascot-elephant" src="/easycare-clover-elephant.png" alt="" aria-hidden="true" />
        <section className="mascot-card" key={visible.id} aria-label="Notification details">
          <header className="mascot-card-header">
            <div className="mascot-notification-heading"><NotificationIcon size={16} aria-hidden="true" /><span>EasyCare Notification</span></div>
            <button type="button" className="mascot-close" aria-label="Dismiss notification" onClick={() => exit(visible)} disabled={Boolean(closing)}><X size={18} /></button>
          </header>
          <div className="mascot-card-message" role="status" aria-live="polite" aria-atomic="true">
            <p className="mascot-title" lang={visible.presentation ? visible.language || 'my' : undefined}>{title}</p>
            {visible.body && visible.body !== visible.title && <p className="mascot-body" lang={visible.presentation ? 'en' : undefined}>{body}</p>}
          </div>
          {error && <p className="mascot-error" role="alert">{error}</p>}
          <button type="button" className="mascot-open" onClick={() => void open()} disabled={Boolean(closing)}>View</button>
        </section>
      </div>
    </aside>}
  </MascotNotificationContext.Provider>
}
