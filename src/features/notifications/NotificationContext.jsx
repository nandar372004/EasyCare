import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { notificationService } from '../../services/notificationService.js'
import { useAuth } from '../auth/AuthContext.jsx'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { patient, user, workspace, isPrototypeMode } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const profileId = user?.id

  const refresh = useCallback(async () => {
    if (!profileId || !patient || workspace !== 'patient' || isPrototypeMode) {
      setNotifications([])
      setUnreadCount(0)
      return
    }
    try {
      const [rows, count] = await Promise.all([notificationService.list(), notificationService.unreadCount()])
      setNotifications(Array.isArray(rows) ? rows : [])
      setUnreadCount(count)
      setError('')
    } catch {
      setError('Notifications could not be refreshed. Try again.')
    }
  }, [isPrototypeMode, patient, profileId, workspace])

  useEffect(() => {
    let current = true
    if (!profileId || !patient || workspace !== 'patient' || isPrototypeMode) {
      setNotifications([])
      setUnreadCount(0)
      setError('')
      setLoading(false)
      return undefined
    }
    setNotifications([])
    setUnreadCount(0)
    setLoading(true)
    const load = async () => {
      if (!current) return
      try {
        const [rows, count] = await Promise.all([notificationService.list(), notificationService.unreadCount()])
        if (!current) return
        setNotifications(Array.isArray(rows) ? rows : [])
        setUnreadCount(count)
        setError('')
      } catch {
        if (current) setError('Notifications could not be refreshed. Try again.')
      } finally {
        if (current) setLoading(false)
      }
    }
    const unsubscribe = notificationService.subscribe(profileId, () => { void load() }, status => {
      if (status === 'SUBSCRIBED') void load()
    })
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    void load()
    return () => {
      current = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [isPrototypeMode, patient, profileId, workspace])

  const value = useMemo(() => ({ notifications, unreadCount, loading, error, refresh }), [notifications, unreadCount, loading, error, refresh])
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used within NotificationProvider')
  return context
}
