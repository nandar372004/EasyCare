export const MORNING_PLAYBACK = Object.freeze({
  MORNING_GREETING: 'Good Morning',
  PLAYING_GOOD_SLEEP: 'Good Sleep',
  PLAYING_WHY_NOT_SLEEP: 'Why Not Sleep',
  PLAYING_SO_WHY: 'So Why',
  PLAYING_GOOD_LUCK: 'Good Luck',
})

const negativeSleepPatterns = [
  /အိပ်မပျော်/u,
  /အိပ်မရ/u,
  /မအိပ်ရ/u,
  /ကောင်းကောင်း\s*မအိပ်/u,
  /(?:couldn't|could not|didn't|did not)\s+(?:sleep|get to sleep)/i,
  /(?:didn't|did not)\s+sleep\s+well/i,
  /trouble\s+sleeping/i,
  /couldn't\s+sleep/i,
]

const positiveSleepPatterns = [
  /ကောင်းကောင်း\s*အိပ်ပျော်/u,
  /အိပ်ပျော်တယ်/u,
  /အိပ်လို့ကောင်းတယ်/u,
  /slept\s+well/i,
  /good\s+sleep/i,
  /had\s+a\s+good\s+sleep/i,
]

const neckNotReasonPatterns = [
  /လည်ပင်း.{0,18}(?:မဟုတ်ဘူး|မဆိုင်ဘူး)/u,
  /လည်ပင်းနဲ့\s*မဆိုင်/u,
  /not\s+because\s+of\s+(?:my\s+)?neck/i,
  /my\s+neck\s+(?:isn't|is\s+not)\s+the\s+reason/i,
  /not\s+due\s+to\s+(?:my\s+)?neck\s+pain/i,
  /wasn't\s+due\s+to\s+(?:my\s+)?neck/i,
]

function hasCompetitionExplanation(text, language) {
  if (language === 'my') {
    const competition = /ပြိုင်ပွဲ/u.test(text)
    const context = /ဒီနေ့|စိတ်လှုပ်ရှား|စိတ်ပူ|အိပ်မရ|အိပ်မပျော်|ကြောင့်|အတွက်|ရှိလို့|ဝင်ရမှာ/u.test(text)
    return competition && context
  }
  const competition = /competition|contest/i.test(text)
  const context = /today|excited|nervous|couldn't\s+sleep|could\s+not\s+sleep|didn't\s+sleep|did\s+not\s+sleep|because|due\s+to|for\s+my/i.test(text)
  return competition && context
}

export function detectMorningIntent(transcript, step) {
  const text = String(transcript || '').trim()
  if (!text) return 'NO_SPEECH'
  const language = /[\u1000-\u109f]/u.test(text) ? 'my' : 'en'

  if (step === 'WAITING_FOR_SLEEP_STATUS' && hasCompetitionExplanation(text, language)) return 'COMPETITION_EXCITEMENT'
  if (step === 'WAITING_FOR_SLEEP_REASON' && hasCompetitionExplanation(text, language)) return 'COMPETITION_EXCITEMENT'
  if (step === 'WAITING_FOR_EXPLANATION' && hasCompetitionExplanation(text, language)) return 'COMPETITION_EXCITEMENT'

  if (step === 'WAITING_FOR_SLEEP_STATUS') {
    if (negativeSleepPatterns.some(pattern => pattern.test(text))) return 'DID_NOT_SLEEP_WELL'
    if (positiveSleepPatterns.some(pattern => pattern.test(text))) return 'SLEPT_WELL'
  }
  if (step === 'WAITING_FOR_SLEEP_REASON' && neckNotReasonPatterns.some(pattern => pattern.test(text))) return 'NOT_NECK_RELATED'
  return 'UNKNOWN'
}

export function createMorningConversation() {
  return {
    step: 'MORNING_GREETING',
    playback: { step: 'MORNING_GREETING', shouldAdvance: true, id: 1 },
    lastAudioStep: null,
    resumeStep: null,
    listening: false,
    micFallback: false,
    notice: '',
    retryCount: 0,
    listenCycle: 0,
  }
}

function startPlayback(state, step) {
  return {
    ...state,
    step,
    playback: { step, shouldAdvance: true, id: (state.playback?.id ?? 0) + 1 },
    listening: false,
    micFallback: false,
    notice: '',
  }
}

function waitingStateAfterAudio(step) {
  if (step === 'MORNING_GREETING') return 'WAITING_FOR_SLEEP_STATUS'
  if (step === 'PLAYING_WHY_NOT_SLEEP') return 'WAITING_FOR_SLEEP_REASON'
  if (step === 'PLAYING_SO_WHY') return 'WAITING_FOR_EXPLANATION'
  return 'COMPLETED'
}

export function morningConversationReducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return createMorningConversation()
    case 'LISTENING':
      return { ...state, listening: action.value }
    case 'MIC_FALLBACK':
      return { ...state, listening: false, micFallback: true, notice: action.notice || '' }
    case 'SILENCE':
      return { ...state, step: state.resumeStep || state.step, playback: null, listening: false, resumeStep: null, notice: 'silence', listenCycle: state.listenCycle + 1 }
    case 'AUDIO_FAILED':
      return { ...state, step: 'UNKNOWN_RESPONSE', playback: null, listening: false, micFallback: true, resumeStep: action.step, notice: 'audio' }
    case 'AUDIO_ENDED': {
      if (state.playback?.id !== action.id || state.playback?.step !== action.step) return state
      if (!state.playback.shouldAdvance) return { ...state, playback: null, lastAudioStep: action.step }
      const nextStep = waitingStateAfterAudio(action.step)
      if (nextStep === 'COMPLETED') return { ...state, step: 'COMPLETED', playback: null, listening: false, lastAudioStep: action.step, notice: '' }
      return { ...state, step: nextStep, playback: null, listening: false, lastAudioStep: action.step, micFallback: false, notice: '' }
    }
    case 'INTENT': {
      const intentState = state.step === 'UNKNOWN_RESPONSE' && state.resumeStep ? { ...state, step: state.resumeStep } : state
      const intent = action.intent
      if (intent === 'NO_SPEECH') return { ...intentState, step: intentState.step, playback: null, listening: false, resumeStep: null, notice: 'silence', listenCycle: intentState.listenCycle + 1 }
      if (intent === 'UNKNOWN') {
        const fallbackStep = {
          WAITING_FOR_SLEEP_STATUS: 'PLAYING_WHY_NOT_SLEEP',
          WAITING_FOR_SLEEP_REASON: 'PLAYING_SO_WHY',
          WAITING_FOR_EXPLANATION: 'PLAYING_GOOD_LUCK',
        }[intentState.step]
        return fallbackStep ? startPlayback(intentState, fallbackStep) : intentState
      }
      if (intentState.step === 'WAITING_FOR_SLEEP_STATUS') {
        if (intent === 'SLEPT_WELL') return startPlayback(intentState, 'PLAYING_GOOD_SLEEP')
        if (intent === 'DID_NOT_SLEEP_WELL') return startPlayback(intentState, 'PLAYING_WHY_NOT_SLEEP')
        if (intent === 'COMPETITION_EXCITEMENT') return startPlayback(intentState, 'PLAYING_GOOD_LUCK')
      }
      if (intentState.step === 'WAITING_FOR_SLEEP_REASON') {
        if (intent === 'NOT_NECK_RELATED') return startPlayback(intentState, 'PLAYING_SO_WHY')
        if (intent === 'COMPETITION_EXCITEMENT') return startPlayback(intentState, 'PLAYING_GOOD_LUCK')
      }
      if (intentState.step === 'WAITING_FOR_EXPLANATION' && intent === 'COMPETITION_EXCITEMENT') return startPlayback(intentState, 'PLAYING_GOOD_LUCK')
      return { ...intentState, step: 'UNKNOWN_RESPONSE', playback: null, listening: false, resumeStep: intentState.step, notice: 'unknown' }
    }
    case 'RETRY':
      if (!state.resumeStep || state.retryCount >= 2) return state
      if (MORNING_PLAYBACK[state.resumeStep]) return { ...startPlayback(state, state.resumeStep), resumeStep: null, retryCount: state.retryCount + 1 }
      return { ...state, step: state.resumeStep, playback: null, listening: false, micFallback: false, notice: '', resumeStep: null, retryCount: state.retryCount + 1 }
    case 'REPLAY': {
      const replayStep = state.playback?.step || state.lastAudioStep || 'MORNING_GREETING'
      const shouldAdvance = state.step === replayStep && Boolean(state.playback?.shouldAdvance)
      return { ...state, playback: { step: replayStep, shouldAdvance, id: (state.playback?.id ?? 0) + 1 }, listening: false, notice: '' }
    }
    case 'SKIP':
      return { ...state, step: 'COMPLETED', playback: null, listening: false, micFallback: false, resumeStep: null, notice: '' }
    default:
      return state
  }
}
