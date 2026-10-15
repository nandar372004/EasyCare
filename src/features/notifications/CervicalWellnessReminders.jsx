import { useContext, useEffect, useRef, useState } from 'react'
import { MascotNotificationContext } from './GlobalMascotNotification.jsx'
import { HeartPulse, X } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.jsx'
import { hasCervicalPresentationProfile } from '../../data/presentationProfiles.js'
import { notificationService } from '../../services/notificationService.js'
import { CERVICAL_REMINDERS, CERVICAL_REMINDER_INTERVAL_MS, SPONDYLOSIS_REMINDER_INTERVAL_MS, readSequence, saveSequence, wellnessSessionId, resetSequenceForDevelopment } from './cervicalReminderSequence.js'
import './cervicalWellnessReminders.css'

const messages = {
  WELLNESS_FIRST: { my: 'ဒီနေ့ ဘယ်လိုခံစားနေရပါသလဲ။', en: 'How are you feeling today?' },
  MEDICATION_SECOND: { my: 'ဒီနေ့ ဆေးသောက်ဖို့ မမေ့နဲ့နော်။', en: "Don't forget to take your medicine today" },
  SPONDYLOSIS_THIRD: CERVICAL_REMINDERS[0],
}

export function CervicalWellnessReminders() {
  const auth = useAuth()
  const mascot = useContext(MascotNotificationContext)
  const sessionId = wellnessSessionId(auth.session)
  const eligible = auth.status === 'authenticated' && auth.role === 'patient' && auth.workspace === 'patient'
    && hasCervicalPresentationProfile(auth.patient, auth.user) && sessionId
  const key = eligible ? `easycare.cervical-wellness.v1:${sessionId}` : null
  const [shown, setShown] = useState(null)
  const timerRef = useRef()

  // Replay only changes local presentation state; database dedupe stays unchanged.
  useEffect(() => {
    if (key) void notificationService.persistDailyCervicalWellness().catch(() => {})
  }, [key])

  useEffect(() => {
    const record = key ? readSequence(key) || { stage: 'WELLNESS_FIRST' } : null
    if (key) saveSequence(key, record)
    setShown(record ? { key, ...record } : null)
  }, [key])

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!key || shown?.key !== key || !['WAITING_8_SECONDS', 'SPONDYLOSIS_THIRD'].includes(shown.stage)) return undefined
    timerRef.current = setTimeout(() => {
      const record = readSequence(key)
      if (record?.stage !== shown.stage || record.nextAt !== shown.nextAt || record.index !== shown.index) return
      const index = record.stage === 'WAITING_8_SECONDS' ? 0 : record.index + 1
      const updated = index < CERVICAL_REMINDERS.length
        ? { stage: 'SPONDYLOSIS_THIRD', index, nextAt: Date.now() + SPONDYLOSIS_REMINDER_INTERVAL_MS }
        : { stage: 'COMPLETE' }
      saveSequence(key, updated)
      setShown({ key, ...updated })
    }, Math.max(0, shown.nextAt - Date.now()))
    return () => clearTimeout(timerRef.current)
  }, [key, shown])

  const dismiss = () => {
    const record = readSequence(key)
    if (!record || record.stage !== shown?.stage || record.index !== shown?.index) return
    clearTimeout(timerRef.current)
    const updated = record.stage === 'WELLNESS_FIRST' ? { stage: 'MEDICATION_SECOND' }
      : record.stage === 'MEDICATION_SECOND' ? { stage: 'WAITING_8_SECONDS', nextAt: Date.now() + CERVICAL_REMINDER_INTERVAL_MS }
        : { stage: 'COMPLETE' }
    saveSequence(key, updated)
    setShown({ key, ...updated })
  }
  const message = key && shown?.key === key && (shown.stage === 'SPONDYLOSIS_THIRD' ? CERVICAL_REMINDERS[shown.index] : messages[shown.stage])
  useEffect(() => {
    mascot?.setWellnessActive(Boolean(key))
    return () => mascot?.setWellnessActive(false)
  }, [key, mascot?.setWellnessActive])
  useEffect(() => {
    mascot?.setSequence(message ? {
      id: `${key}:${shown.stage}:${shown.index ?? ''}`, title: message.my,
      body: message.en, language: 'my', presentation: true, dismiss,
    } : null)
    return () => mascot?.setSequence(null)
  }, [key, shown, mascot?.setSequence])

  const replay = () => {
    clearTimeout(timerRef.current)
    if (!resetSequenceForDevelopment(key)) return
    const record = { stage: 'SPONDYLOSIS_THIRD', index: 0, nextAt: Date.now() + SPONDYLOSIS_REMINDER_INTERVAL_MS }
    saveSequence(key, record)
    setShown({ key, ...record })
  }
  return <>
    {key && <button type="button" className="cervical-wellness-replay" onClick={replay}>Replay Wellness Reminders</button>}
    {message && !mascot && <aside className="cervical-wellness-toast" aria-label="Wellness reminder">
      <HeartPulse aria-hidden="true" size={22} />
      <div className="cervical-wellness-copy" role="status" aria-live="polite" aria-atomic="true">
        <p lang="my">{message.my}</p>
        <small lang="en">{message.en}</small>
      </div>
      <button className="cervical-wellness-close" type="button" aria-label="Dismiss wellness reminder" onClick={dismiss}><X size={18} /></button>
    </aside>}
  </>
}
