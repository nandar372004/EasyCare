import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { detectNightVoiceIntent, nightVoiceAudioFor } from './nightVoiceIntent.js'
import './nightVoiceAssistant.css'

const YANGON = 'Asia/Yangon'
export const isNightVoiceTime = (date = new Date()) => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: YANGON, hour: 'numeric', hourCycle: 'h23' }).format(date))
  return hour >= 18 || hour < 2
}

export function NightVoiceAssistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const { language } = useLocalization()
  const [assistantLanguage, setAssistantLanguage] = useState(language === 'my' ? 'my' : 'en')
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState('greeting')
  const [audioFallback, setAudioFallback] = useState(false)
  const audioRef = useRef(null)
  const recognitionRef = useRef(null)
  const closedRef = useRef(false)
  const handledLocationKey = useRef(null)
  const preferredLanguage = assistantLanguage

  const startListening = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setPhase('retry')
      return
    }
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = preferredLanguage === 'my' ? 'my-MM' : 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => { if (closedRef.current || recognitionRef.current !== recognition) return; setPhase('listening') }
    recognition.onresult = event => {
      if (closedRef.current || recognitionRef.current !== recognition) return
      const transcript = event.results?.[0]?.[0]?.transcript || ''
      const result = detectNightVoiceIntent(transcript)
      if (result.intent === 'NO_SPEECH') {
        setPhase('retry')
        return
      }
      recognitionRef.current?.stop?.()
      const audio = new Audio(nightVoiceAudioFor(result.intent, preferredLanguage))
      audioRef.current = audio
      setPhase('speaking')
      audio.onended = () => { if (!closedRef.current) setPhase('retry') }
      audio.onerror = () => { if (!closedRef.current) setPhase('retry') }
      void audio.play().catch(() => { setPhase('retry') })
    }
    recognition.onerror = event => {
      if (closedRef.current || recognitionRef.current !== recognition) return
      if (event.error === 'no-speech') {
        setPhase('retry')
      } else if (!closedRef.current) {
        setPhase('retry')
      }
    }
    try { recognition.start() } catch {
      setPhase('retry')
    }
  }, [preferredLanguage])

  const playGreeting = useCallback(() => {
    const audio = new Audio(nightVoiceAudioFor('GREETING', preferredLanguage))
    audioRef.current = audio
    audio.onended = () => { if (!closedRef.current && audioRef.current === audio) startListening() }
    audio.onerror = () => { if (!closedRef.current && audioRef.current === audio) setAudioFallback(true) }
    void audio.play().catch(() => { if (!closedRef.current && audioRef.current === audio) setAudioFallback(true) })
  }, [preferredLanguage, startListening])

  useEffect(() => {
    if (!location.state?.openNightVoiceAssistant || handledLocationKey.current === location.key) return
    handledLocationKey.current = location.key
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...location.state, openNightVoiceAssistant: undefined } })
    if (isNightVoiceTime()) {
      closedRef.current = false
      setPhase('greeting')
      setOpen(true)
    }
  }, [location.key, location.pathname, location.search, location.state, navigate, preferredLanguage])

  useEffect(() => {
    if (open && phase === 'greeting') playGreeting()
  }, [open, phase, playGreeting])

  useEffect(() => () => {
    closedRef.current = true
    recognitionRef.current?.abort?.()
    if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause?.() }
  }, [])

  const close = () => {
    closedRef.current = true
    recognitionRef.current?.abort?.()
    if (audioRef.current) { audioRef.current.onended = null; audioRef.current.pause?.() }
    setOpen(false)
  }
  const changeAssistantLanguage = nextLanguage => {
    if (nextLanguage === preferredLanguage) return
    closedRef.current = true
    recognitionRef.current?.abort?.()
    recognitionRef.current = null
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause?.()
      audioRef.current.currentTime = 0
    }
    closedRef.current = false
    setAssistantLanguage(nextLanguage)
    setAudioFallback(false)
    setPhase('greeting')
  }
  const speakButtonIntent = phrase => {
    const { intent } = detectNightVoiceIntent(phrase)
    const audio = new Audio(nightVoiceAudioFor(intent, preferredLanguage))
    audioRef.current = audio
    setPhase('speaking')
    audio.onended = () => { if (!closedRef.current) setPhase('retry') }
    audio.onerror = () => { if (!closedRef.current) setPhase('retry') }
    void audio.play().catch(() => { if (!closedRef.current) setPhase('retry') })
  }
  if (!open) return null
  return <div className="night-voice-backdrop" role="presentation"><section className="night-voice-dialog" role="dialog" aria-modal="true" aria-label="Night assistant">
    <header className="night-voice-heading"><div className="night-voice-heading-controls">{phase === 'listening' && <span className="night-voice-mic is-active" role="status" aria-label={preferredLanguage === 'my' ? 'နားထောင်နေသည်' : 'Microphone on'}><Mic aria-hidden="true" /></span>}<button className="night-voice-close" type="button" onClick={close} aria-label="Close"><X /></button></div></header>
    <div className="night-voice-language" role="group" aria-label="Choose assistant language">
      <button type="button" aria-pressed={preferredLanguage === 'my'} onClick={() => changeAssistantLanguage('my')}>Myanmar</button>
      <button type="button" aria-pressed={preferredLanguage === 'en'} onClick={() => changeAssistantLanguage('en')}>English</button>
    </div>
    <div className={`night-voice-mascot is-${phase}`}><img className="night-voice-moon" src="/easycare-night-moon.png" alt="" aria-hidden="true" /><img className="night-voice-elephant" src="/easycare-night-elephant.png" alt="EasyCare elephant waving" /></div>
    {audioFallback && phase === 'greeting' && <div className="voice-assistant-actions night-voice-start-actions"><button className="button button--primary" type="button" onClick={() => { setAudioFallback(false); playGreeting() }}>{preferredLanguage === 'my' ? 'စတင်ပြောမည်' : 'Start Talking'}</button></div>}
    {phase === 'retry' && <div className="night-voice-actions voice-assistant-actions"><button className="button button--primary" type="button" onClick={startListening}>{preferredLanguage === 'my' ? 'ထပ်စမ်းရန်' : 'Try Again'}</button><button className="button button--secondary" type="button" onClick={() => speakButtonIntent(preferredLanguage === 'my' ? 'စစ်ပေးပါ' : 'Please check')}>{preferredLanguage === 'my' ? 'စစ်ပေးပါ' : 'Please check'}</button><button className="button button--secondary" type="button" onClick={() => speakButtonIntent(preferredLanguage === 'my' ? 'မစစ်နဲ့' : "Don't check")}>{preferredLanguage === 'my' ? 'မစစ်နဲ့ / စစ်ပြီးပြီ' : 'Already checked / Don’t check'}</button><button className="button button--secondary" type="button" onClick={close}>{preferredLanguage === 'my' ? 'နောက်မှ' : 'Not now'}</button></div>}
  </section></div>
}
