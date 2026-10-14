import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Mic, Play, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import { createMorningConversation, detectMorningIntent, MORNING_PLAYBACK, morningConversationReducer } from './morningVoiceConversation.js'
import './morningVoiceAssistant.css'

const MORNING_AUDIO = Object.freeze({
  'MORNING_GREETING:my': '/audio/Good Morning(Myanmar).mp3',
  'MORNING_GREETING:en': '/audio/Good Morning(English).mp3',
  'PLAYING_GOOD_SLEEP:my': '/audio/Good Sleep(Myanmar).mp3',
  'PLAYING_GOOD_SLEEP:en': '/audio/Good Sleep(English).mp3',
  'PLAYING_WHY_NOT_SLEEP:my': '/audio/Why Not Sleep(Myanmar).mp3',
  'PLAYING_WHY_NOT_SLEEP:en': '/audio/Why Not Sleep(English).mp3',
  'PLAYING_SO_WHY:my': '/audio/So Why(Myanmar).mp3',
  'PLAYING_SO_WHY:en': '/audio/So Why(English).mp3',
  'PLAYING_GOOD_LUCK:my': '/audio/Good Luck(Myanmar).mp3',
  'PLAYING_GOOD_LUCK:en': '/audio/Good Luck(English).mp3',
})
const WAITING_STEPS = new Set(['WAITING_FOR_SLEEP_STATUS', 'WAITING_FOR_SLEEP_REASON', 'WAITING_FOR_EXPLANATION'])
const MAX_RETRIES = 2

function morningSubtitle(step, language, notice = '') {
  if (notice === 'silence') return language === 'my' ? 'မကြားလိုက်ရဘူး၊ ထပ်ပြောကြည့်ပါနော်။' : "I didn't hear anything. Please try again."
  if (notice === 'audio') return language === 'my' ? 'အသံဖွင့်မရပါ။ ထပ်စမ်းကြည့်ပါနော်။' : "I couldn't play that. Please try again."
  if (step === 'UNKNOWN_RESPONSE') return language === 'my' ? 'နားမလည်လိုက်ဘူး။ ထပ်ပြောကြည့်ပါနော်။' : "I didn't understand that. Please try again."
  const my = {
    MORNING_GREETING: 'မင်္ဂလာနံနက်ခင်းပါ။ ညက ကောင်းကောင်းအိပ်ပျော်ခဲ့လား။',
    WAITING_FOR_SLEEP_STATUS: 'ညက ကောင်းကောင်းအိပ်ပျော်ခဲ့လား။',
    PLAYING_GOOD_SLEEP: 'ကောင်းကောင်းအိပ်ပျော်ခဲ့လို့ ဝမ်းသာပါတယ်။',
    PLAYING_WHY_NOT_SLEEP: 'ဘာကြောင့် ကောင်းကောင်းအိပ်မပျော်တာလဲ။',
    WAITING_FOR_SLEEP_REASON: 'ဘာကြောင့် ကောင်းကောင်းအိပ်မပျော်တာလဲ။',
    PLAYING_SO_WHY: 'ဒါဆို ဘာကြောင့်လဲ။',
    WAITING_FOR_EXPLANATION: 'ဒါဆို ဘာကြောင့် အိပ်မပျော်တာလဲ။',
    PLAYING_GOOD_LUCK: 'ဒီနေ့ ပြိုင်ပွဲမှာ ကံကောင်းပါစေ။',
    COMPLETED: 'ကောင်းသောနေ့လေး ဖြစ်ပါစေ။',
  }
  const en = {
    MORNING_GREETING: 'Good morning! Did you sleep well?',
    WAITING_FOR_SLEEP_STATUS: 'Did you sleep well last night?',
    PLAYING_GOOD_SLEEP: "I'm glad you slept well.",
    PLAYING_WHY_NOT_SLEEP: "Why couldn't you sleep well?",
    WAITING_FOR_SLEEP_REASON: "Why couldn't you sleep well?",
    PLAYING_SO_WHY: 'So why?',
    WAITING_FOR_EXPLANATION: 'Then what kept you awake?',
    PLAYING_GOOD_LUCK: 'Good luck with your competition today!',
    COMPLETED: 'Have a good day!',
  }
  return (language === 'my' ? my : en)[step] || (language === 'my' ? 'ပြောပြပေးပါနော်။' : 'Tell me a little more.')
}

function fallbackOptions(step, language) {
  if (step === 'WAITING_FOR_SLEEP_STATUS') return language === 'my'
    ? [{ label: 'ကောင်းကောင်းအိပ်ပျော်တယ်', phrase: 'ကောင်းကောင်းအိပ်ပျော်တယ်' }, { label: 'အိပ်မပျော်ဘူး', phrase: 'အိပ်မပျော်ဘူး' }]
    : [{ label: 'I slept well', phrase: 'I slept well' }, { label: "I couldn't sleep", phrase: "I couldn't sleep" }]
  if (step === 'WAITING_FOR_SLEEP_REASON') return language === 'my'
    ? [{ label: 'လည်ပင်းကြောင့်မဟုတ်ဘူး', phrase: 'လည်ပင်းကြောင့်မဟုတ်ဘူး' }, { label: 'ပြိုင်ပွဲကြောင့်', phrase: 'ပြိုင်ပွဲကြောင့်' }]
    : [{ label: "It's not because of my neck", phrase: "It's not because of my neck" }, { label: "It's because of my competition", phrase: "It's because of my competition" }]
  if (step === 'WAITING_FOR_EXPLANATION') return language === 'my'
    ? [{ label: 'ဒီနေ့ပြိုင်ပွဲရှိလို့ စိတ်လှုပ်ရှားနေတာ', phrase: 'ဒီနေ့ပြိုင်ပွဲရှိလို့ စိတ်လှုပ်ရှားနေတာ' }]
    : [{ label: 'I have a competition today', phrase: 'I have a competition today' }]
  return []
}

export function MorningVoiceAssistant() {
  const location = useLocation()
  const navigate = useNavigate()
  const { language } = useLocalization()
  const [assistantLanguage, setAssistantLanguage] = useState(language === 'my' ? 'my' : 'en')
  const [conversation, dispatch] = useReducer(morningConversationReducer, undefined, createMorningConversation)
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const audioRef = useRef(null)
  const recognitionRef = useRef(null)
  const handledLocationKey = useRef(null)
  const mutedRef = useRef(false)
  const micErrorCount = useRef(0)

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.onended = null
    audio.onerror = null
    audio.pause?.()
    try { audio.currentTime = 0 } catch { /* browser audio may not be seekable yet */ }
    audioRef.current = null
  }, [])
  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onresult = null
      recognition.onend = null
      recognition.onerror = null
      try { recognition.abort?.() } catch { /* recognition may already be stopped */ }
    }
  }, [])
  const close = useCallback(() => {
    stopRecognition()
    stopAudio()
    setOpen(false)
    dispatch({ type: 'SKIP' })
  }, [stopAudio, stopRecognition])

  useEffect(() => {
    if (!location.state?.openMorningVoiceAssistant || handledLocationKey.current === location.key) return
    handledLocationKey.current = location.key
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...location.state, openMorningVoiceAssistant: undefined } })
    stopRecognition()
    stopAudio()
    dispatch({ type: 'RESET' })
    micErrorCount.current = 0
    setAssistantLanguage(language === 'my' ? 'my' : 'en')
    setOpen(true)
  }, [language, location.key, location.pathname, location.search, location.state, navigate, stopAudio, stopRecognition])

  useEffect(() => {
    if (open && ['/login', '/provider/login', '/register', '/'].includes(location.pathname)) close()
  }, [close, location.pathname, open])

  useEffect(() => {
    if (open) return
    setAssistantLanguage(language === 'my' ? 'my' : 'en')
  }, [language, open])

  useEffect(() => {
    if (!open || !conversation.playback) return undefined
    const { step, id, shouldAdvance } = conversation.playback
    const src = MORNING_AUDIO[`${step}:${assistantLanguage}`]
    if (!src) return undefined
    const audio = new Audio(src)
    audioRef.current = audio
    audio.muted = mutedRef.current
    audio.onended = () => {
      if (audioRef.current !== audio) return
      audioRef.current = null
      dispatch({ type: 'AUDIO_ENDED', step, id })
    }
    audio.onerror = () => {
      if (audioRef.current !== audio) return
      audioRef.current = null
      dispatch({ type: 'AUDIO_FAILED', step })
    }
    void audio.play().catch(() => {
      if (audioRef.current !== audio) return
      audioRef.current = null
      dispatch({ type: 'AUDIO_FAILED', step })
    })
    return () => {
      audio.onended = null
      audio.onerror = null
      audio.pause?.()
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [assistantLanguage, conversation.playback?.id, open])

  useEffect(() => {
    const step = conversation.step
    if (!open || conversation.playback || !WAITING_STEPS.has(step)) return undefined
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      dispatch({ type: 'MIC_FALLBACK', notice: 'unsupported' })
      return undefined
    }
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = assistantLanguage === 'my' ? 'my-MM' : 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      if (recognitionRef.current === recognition) dispatch({ type: 'LISTENING', value: true })
    }
    recognition.onresult = event => {
      if (recognitionRef.current !== recognition) return
      const transcript = event.results?.[0]?.[0]?.transcript || ''
      recognitionRef.current = null
      try { recognition.stop?.() } catch { /* recognition may have ended */ }
      dispatch({ type: 'LISTENING', value: false })
      dispatch({ type: 'INTENT', intent: detectMorningIntent(transcript, step) })
    }
    recognition.onerror = event => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      dispatch({ type: 'LISTENING', value: false })
      if (event.error === 'no-speech') {
        dispatch({ type: 'SILENCE' })
        return
      }
      micErrorCount.current += 1
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || micErrorCount.current >= 2) {
        dispatch({ type: 'MIC_FALLBACK', notice: 'microphone' })
      }
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
        dispatch({ type: 'LISTENING', value: false })
      }
    }
    try { recognition.start() } catch {
      recognitionRef.current = null
      dispatch({ type: 'MIC_FALLBACK', notice: 'microphone' })
    }
    return () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
      recognition.onresult = null
      recognition.onend = null
      recognition.onerror = null
      try { recognition.abort?.() } catch { /* already stopped */ }
    }
  }, [assistantLanguage, conversation.listenCycle, conversation.notice, conversation.playback?.id, conversation.step, open])

  useEffect(() => () => {
    stopRecognition()
    stopAudio()
  }, [stopAudio, stopRecognition])

  const changeLanguage = nextLanguage => {
    if (nextLanguage === assistantLanguage) return
    stopRecognition()
    setAssistantLanguage(nextLanguage)
  }
  const answerWithPhrase = phrase => {
    stopRecognition()
    const detectorStep = conversation.step === 'UNKNOWN_RESPONSE' ? conversation.resumeStep : conversation.step
    const intent = detectMorningIntent(phrase, detectorStep)
    dispatch({ type: 'INTENT', intent })
  }
  const skip = () => {
    stopRecognition()
    stopAudio()
    dispatch({ type: 'SKIP' })
  }
  const retry = () => {
    stopRecognition()
    stopAudio()
    dispatch({ type: 'RETRY' })
  }
  const toggleMute = () => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (audioRef.current) audioRef.current.muted = next
  }

  if (!open) return null
  const audioIsPlaying = Boolean(conversation.playback && MORNING_PLAYBACK[conversation.playback.step])
  const options = fallbackOptions(conversation.step === 'UNKNOWN_RESPONSE' ? conversation.resumeStep : conversation.step, assistantLanguage)
  const fallbackVisible = conversation.micFallback || conversation.step === 'UNKNOWN_RESPONSE' || conversation.notice === 'silence'
  const retryVisible = conversation.step === 'UNKNOWN_RESPONSE' && conversation.retryCount < MAX_RETRIES && conversation.resumeStep

  return <div className="morning-voice-backdrop" role="presentation"><section className={`morning-voice-dialog ${conversation.listening ? 'is-listening' : ''} ${audioIsPlaying ? 'is-speaking' : ''}`} role="dialog" aria-modal="true" aria-label={assistantLanguage === 'my' ? 'မနက်ခင်း စကားပြောအကူ' : 'Morning voice assistant'}>
    <header className="morning-voice-header"><span className="morning-voice-state" role="status">{conversation.listening ? (assistantLanguage === 'my' ? 'နားထောင်နေသည်' : 'Listening') : audioIsPlaying ? (assistantLanguage === 'my' ? 'ပြောနေသည်' : 'Speaking') : ''}</span><button type="button" className="morning-voice-close" aria-label="Close" onClick={close}><X /></button></header>
    <div className="morning-voice-language" role="group" aria-label="Choose assistant language"><button type="button" aria-pressed={assistantLanguage === 'my'} onClick={() => changeLanguage('my')}>Myanmar</button><button type="button" aria-pressed={assistantLanguage === 'en'} onClick={() => changeLanguage('en')}>English</button></div>
    <div className="morning-voice-mascot"><img src="/easycare-night-elephant.png" alt="EasyCare elephant" /></div>
    {fallbackVisible && <div className="morning-voice-fallback voice-assistant-actions" aria-label={assistantLanguage === 'my' ? 'အဖြေရွေးပါ' : 'Choose a response'}>
      {retryVisible && <button className="button button--primary" type="button" onClick={retry}>{assistantLanguage === 'my' ? 'ထပ်စမ်းရန်' : 'Try Again'}</button>}
      {options.map(option => <button className="button button--secondary" type="button" key={option.phrase} onClick={() => answerWithPhrase(option.phrase)}>{option.label}</button>)}
      {conversation.step !== 'COMPLETED' && <button className="button button--secondary" type="button" onClick={skip}>{assistantLanguage === 'my' ? 'ကျော်မည်' : 'Skip'}</button>}
    </div>}
    <footer className="morning-voice-controls">
      <button type="button" onClick={() => dispatch({ type: 'REPLAY' })} aria-label={assistantLanguage === 'my' ? 'ပြန်ဖွင့်ရန်' : 'Replay'}><Play />{assistantLanguage === 'my' ? 'ပြန်ဖွင့်ရန်' : 'Replay'}</button>
      <button type="button" onClick={toggleMute} aria-label={muted ? (assistantLanguage === 'my' ? 'အသံဖွင့်ရန်' : 'Unmute') : (assistantLanguage === 'my' ? 'အသံပိတ်ရန်' : 'Mute')}>{muted ? <VolumeX /> : <Volume2 />}{muted ? (assistantLanguage === 'my' ? 'အသံဖွင့်ရန်' : 'Unmute') : (assistantLanguage === 'my' ? 'အသံပိတ်ရန်' : 'Mute')}</button>
      {conversation.step !== 'COMPLETED' && !fallbackVisible && <button type="button" onClick={skip} aria-label={assistantLanguage === 'my' ? 'ကျော်မည်' : 'Skip'}><SkipForward />{assistantLanguage === 'my' ? 'ကျော်မည်' : 'Skip'}</button>}
      {conversation.listening && <span className="morning-voice-mic" aria-hidden="true"><Mic /></span>}
    </footer>
  </section></div>
}
