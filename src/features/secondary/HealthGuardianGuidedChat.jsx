import { useCallback, useEffect, useRef, useState } from 'react'
import { HeartPulse, Mic, Pill, Send, Volume2 } from 'lucide-react'
import { useLocalization } from '../localization/LocalizationContext.jsx'
import './healthGuardianGuidedChat.css'
import askMedicineEnglish from '../../../Ask Medicine(English).mp3'
import askMedicineMyanmar from '../../../Ask Medicine(Myanmar).mp3'
import aboutMedicineEnglish from '../../../About Medicine(English).mp3'
import aboutMedicineMyanmar from '../../../About Medicine(Myanmar).mp3'
import heatProtectionEnglish from '../../../Heat Protection(English).mp3'
import heatProtectionMyanmar from '../../../Heat Protection(Myanmar).mp3'

export const WHO_HEAT_HEALTH_URL = 'https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health'

const clips = {
  en: { askMedicine: askMedicineEnglish, aboutMedicine: aboutMedicineEnglish, heatProtection: heatProtectionEnglish },
  my: { askMedicine: askMedicineMyanmar, aboutMedicine: aboutMedicineMyanmar, heatProtection: heatProtectionMyanmar },
}

export function HealthGuardianGuidedChat({ language }) {
  const { t } = useLocalization()
  const [category, setCategory] = useState('medicine')
  const [phase, setPhase] = useState('idle')
  const [entries, setEntries] = useState([])
  const [medicineName, setMedicineName] = useState('')
  const [medicineInputVisible, setMedicineInputVisible] = useState(false)
  const [fallback, setFallback] = useState(false)
  const recognitionRef = useRef(null)
  const audioRef = useRef(null)
  const finishAudioRef = useRef(null)
  const sessionRef = useRef(0)
  const transcriptRef = useRef('')
  const recognitionFailedRef = useRef(false)
  const previousLanguageRef = useRef(language)

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    recognition.onstart = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    try { recognition.abort?.() } catch { /* recognition may already be closed */ }
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    const finish = finishAudioRef.current
    audioRef.current = null
    finishAudioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      try { audio.pause() } catch { /* media element may already be stopped */ }
      try { audio.currentTime = 0 } catch { /* media element may not have loaded */ }
    }
    finish?.(false)
  }, [])

  const playClip = useCallback((src, session) => new Promise(resolve => {
    stopAudio()
    const audio = new Audio(src)
    audioRef.current = audio
    setPhase('speaking')
    let settled = false
    const finish = played => {
      if (settled) return
      settled = true
      if (audioRef.current === audio) audioRef.current = null
      if (finishAudioRef.current === finish) finishAudioRef.current = null
      audio.onended = null
      audio.onerror = null
      if (session === sessionRef.current) setPhase('idle')
      resolve(played)
    }
    finishAudioRef.current = finish
    audio.onended = () => finish(true)
    audio.onerror = () => finish(false)
    try { void audio.play().catch(() => finish(false)) } catch { finish(false) }
  }), [stopAudio])

  const showRecognitionFallback = useCallback(() => {
    setPhase('idle')
    setFallback(true)
    if (category === 'medicine') setMedicineInputVisible(true)
  }, [category])

  const runGuidedFlow = useCallback(async (session, transcript) => {
    if (session !== sessionRef.current) return
    setEntries(items => [...items, { id: `${session}-voice-${Date.now()}`, role: 'user', type: 'text', text: transcript || t('guardianGuided.voiceMessage') }])
    setPhase('processing')
    const selectedClips = clips[language === 'my' ? 'my' : 'en']
    if (category === 'medicine') {
      const played = await playClip(selectedClips.askMedicine, session)
      if (session !== sessionRef.current) return
      setMedicineInputVisible(true)
      if (!played) setEntries(items => [...items, { id: `${session}-ask-error`, role: 'assistant', type: 'text', text: t('guardianGuided.medicinePromptError') }])
      return
    }
    const played = await playClip(selectedClips.heatProtection, session)
    if (session !== sessionRef.current) return
    setEntries(items => [...items, { id: `${session}-who-${Date.now()}`, role: 'assistant', type: 'who', audioError: !played }])
  }, [category, language, playClip, t])

  const startRecognition = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      setFallback(true)
      if (category === 'medicine') setMedicineInputVisible(true)
      return
    }
    const session = ++sessionRef.current
    stopAudio()
    stopRecognition()
    transcriptRef.current = ''
    recognitionFailedRef.current = false
    const recognition = new Recognition()
    recognitionRef.current = recognition
    recognition.lang = language === 'my' ? 'my-MM' : 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    setFallback(false)
    setPhase('listening')
    recognition.onstart = () => {
      if (session === sessionRef.current && recognitionRef.current === recognition) setPhase('listening')
    }
    recognition.onresult = event => {
      if (session !== sessionRef.current || recognitionRef.current !== recognition) return
      const transcript = Array.from(event.results || []).map(result => result?.[0]?.transcript || '').join(' ').trim()
      if (transcript) transcriptRef.current = transcript
    }
    recognition.onerror = () => {
      if (session !== sessionRef.current || recognitionRef.current !== recognition) return
      recognitionFailedRef.current = true
      recognitionRef.current = null
      showRecognitionFallback()
    }
    recognition.onend = () => {
      if (session !== sessionRef.current || recognitionRef.current !== recognition) return
      recognitionRef.current = null
      if (recognitionFailedRef.current || !transcriptRef.current) {
        showRecognitionFallback()
        return
      }
      setPhase('processing')
      void runGuidedFlow(session, transcriptRef.current)
    }
    try { recognition.start() } catch {
      recognitionRef.current = null
      recognitionFailedRef.current = true
      showRecognitionFallback()
    }
  }, [category, language, runGuidedFlow, showRecognitionFallback, stopAudio, stopRecognition])

  const stopListening = () => {
    const recognition = recognitionRef.current
    if (!recognition) return
    try { recognition.stop() } catch { showRecognitionFallback() }
  }

  const changeCategory = nextCategory => {
    if (nextCategory === category) return
    sessionRef.current += 1
    stopRecognition()
    stopAudio()
    setCategory(nextCategory)
    setPhase('idle')
    setMedicineName('')
    setMedicineInputVisible(false)
    setFallback(false)
  }

  const sendMedicine = async event => {
    event.preventDefault()
    const value = medicineName.trim()
    if (!value || phase === 'speaking' || phase === 'processing') return
    const session = ++sessionRef.current
    stopRecognition()
    stopAudio()
    setMedicineName('')
    setMedicineInputVisible(false)
    setFallback(false)
    setEntries(items => [...items, { id: `${session}-medicine-${Date.now()}`, role: 'user', type: 'text', text: value }])
    setPhase('processing')
    const selectedClips = clips[language === 'my' ? 'my' : 'en']
    const played = await playClip(selectedClips.aboutMedicine, session)
    if (session !== sessionRef.current) return
    setEntries(items => [...items, { id: `${session}-medicine-safety`, role: 'assistant', type: 'text', text: played ? t('guardianGuided.medicineSafety') : t('guardianGuided.aboutAudioError') }])
  }

  const showHeatGuidance = async () => {
    const session = ++sessionRef.current
    stopRecognition()
    stopAudio()
    setFallback(false)
    setPhase('processing')
    const selectedClips = clips[language === 'my' ? 'my' : 'en']
    const played = await playClip(selectedClips.heatProtection, session)
    if (session !== sessionRef.current) return
    setEntries(items => [...items, { id: `${session}-who-${Date.now()}`, role: 'assistant', type: 'who', audioError: !played }])
  }

  const selectCategoryAndStart = () => {
    if (phase === 'listening') stopListening()
    else if (phase !== 'speaking' && phase !== 'processing') startRecognition()
  }

  useEffect(() => {
    if (previousLanguageRef.current === language) return
    previousLanguageRef.current = language
    sessionRef.current += 1
    stopRecognition()
    stopAudio()
    setPhase('idle')
    setMedicineInputVisible(false)
    setMedicineName('')
    setFallback(false)
  }, [language, stopAudio, stopRecognition])

  useEffect(() => () => {
    sessionRef.current += 1
    stopRecognition()
    stopAudio()
  }, [stopAudio, stopRecognition])

  const current = category === 'medicine' ? 'medicine' : 'healthGeneral'
  const listening = phase === 'listening'
  const busy = phase === 'processing' || phase === 'speaking'

  return <section className="guardian-guided" lang={language} aria-labelledby="guardian-guided-title">
    <header className="guardian-guided-heading">
      <div><span className="guardian-guided-eyebrow">{t('guardianGuided.prompt')}</span><h2 id="guardian-guided-title">{t(`guardianGuided.${current}`)}</h2></div>
    </header>
    <div className="guardian-guided-categories" role="group" aria-label={t('guardianGuided.prompt')}>
      <button type="button" className={category === 'medicine' ? 'is-selected' : ''} aria-pressed={category === 'medicine'} onClick={() => changeCategory('medicine')}>
        <Pill aria-hidden="true" /><span><strong>{t('guardianGuided.medicine')}</strong><small>{t('guardianGuided.medicineHint')}</small></span>
      </button>
      <button type="button" className={category === 'health' ? 'is-selected' : ''} aria-pressed={category === 'health'} onClick={() => changeCategory('health')}>
        <HeartPulse aria-hidden="true" /><span><strong>{t('guardianGuided.healthGeneral')}</strong><small>{t('guardianGuided.healthHint')}</small></span>
      </button>
    </div>

    <div className="guardian-guided-voice">
      <button type="button" className={`guardian-guided-mic${listening ? ' is-listening' : ''}${phase === 'speaking' ? ' is-speaking' : ''}`} onClick={selectCategoryAndStart} disabled={busy} aria-label={t(listening ? 'guardianGuided.stopVoice' : 'guardianGuided.startVoice')} aria-pressed={listening}>
        {phase === 'speaking' ? <Volume2 aria-hidden="true" /> : <Mic aria-hidden="true" />}
      </button>
      <div className="guardian-guided-status" role="status" aria-live="polite">
        {listening ? t('guardianGuided.listening') : phase === 'processing' ? t('guardianGuided.processing') : phase === 'speaking' ? <><span>{t('guardianGuided.speaking')}</span><i className="guardian-speaking-bars" aria-hidden="true"><b /><b /><b /><b /></i></> : fallback ? <>{t('guardianGuided.speechUnavailable')} {t(current === 'medicine' ? 'guardianGuided.medicineFallback' : 'guardianGuided.healthFallback')}</> : t(current === 'medicine' ? 'guardianGuided.medicineHint' : 'guardianGuided.healthHint')}
      </div>
    </div>

    {fallback && category === 'health' && <button type="button" className="guardian-guided-fallback button button--secondary" onClick={showHeatGuidance} disabled={busy}>{t('guardianGuided.showHeat')}</button>}

    {entries.length > 0 && <div className="guardian-guided-history" aria-label={t('guardianGuided.prompt')} aria-live="polite">
      {entries.map(entry => <article key={entry.id} className={`guardian-guided-message is-${entry.role}`}>
        <strong>{entry.role === 'user' ? t('guardianGuided.you') : t('guardianGuided.easycare')}</strong>
        {entry.type === 'who' ? <div className="guardian-who-card"><h3>{t('guardianGuided.whoTitle')}</h3><p>{t('guardianGuided.whoSummary')}</p>{entry.audioError && <p role="status">{t('guardianGuided.heatAudioError')}</p>}<a className="button button--secondary" href={WHO_HEAT_HEALTH_URL} target="_blank" rel="noopener noreferrer">{t('guardianGuided.readWho')}</a></div> : <p>{entry.text}</p>}
      </article>)}
    </div>}

    {medicineInputVisible && category === 'medicine' && phase !== 'speaking' && <form className="guardian-guided-medicine-form" onSubmit={sendMedicine}>
      <label htmlFor="guardian-medicine-name">{t('guardianGuided.medicineName')}</label>
      <div><input id="guardian-medicine-name" value={medicineName} onChange={event => setMedicineName(event.target.value)} placeholder={t('guardianGuided.medicinePlaceholder')} autoComplete="off" /><button className="primary-button" type="submit" disabled={!medicineName.trim() || busy}><Send aria-hidden="true" />{t('guardianGuided.send')}</button></div>
    </form>}
  </section>
}
