const negativePatterns = [
  /မ\s*စစ်\s*နဲ့/u,
  /မလိုတော့ဘူး/u,
  /စစ်ပြီးပြီ/u,
  /မစစ်/u,
  /don't\s+(?:need\s+to\s+)?check/i,
  /do\s+not\s+(?:need\s+to\s+)?check/i,
  /already\s+(?:checked|check)/i,
  /(?:no\s+need|don't\s+need)\s+to\s+check/i,
  /checked\s+already/i,
]

const positivePatterns = [
  /စစ်ပေး/u,
  /စစ်ကြည့်ပေး/u,
  /စစ်ဆေးပေး/u,
  /please\s+check/i,
  /check\s+(?:for\s+me|it)/i,
  /can\s+you\s+check/i,
]

export function detectNightVoiceIntent(transcript) {
  const text = String(transcript || '').trim()
  if (!text) return { intent: 'NO_SPEECH', language: 'en' }
  const language = /[\u1000-\u109f]/u.test(text) ? 'my' : 'en'
  if (negativePatterns.some(pattern => pattern.test(text))) return { intent: 'ALREADY_CHECKED_OR_DECLINE', language }
  if (positivePatterns.some(pattern => pattern.test(text))) return { intent: 'CHECK_REQUEST', language }
  return { intent: 'UNKNOWN', language }
}

export const NIGHT_VOICE_AUDIO = Object.freeze({
  CHECK_REQUEST: Object.freeze({ my: '/audio/Not Check(Myanmar).mp3', en: '/audio/Not Check(English).mp3' }),
  ALREADY_CHECKED_OR_DECLINE: Object.freeze({ my: '/audio/Done Check(Myanmar).mp3', en: '/audio/Done Check(English).mp3' }),
  UNKNOWN: Object.freeze({ my: '/audio/For Unknown(Myanmar).mp3', en: '/audio/For Unknown(English).mp3' }),
  GREETING: Object.freeze({ my: '/audio/Greeting Night(Myanmar).mp3', en: '/audio/Greeting Night(English).mp3' }),
})

export function nightVoiceAudioFor(intent, language) {
  return NIGHT_VOICE_AUDIO[intent]?.[language] || NIGHT_VOICE_AUDIO.UNKNOWN[language] || NIGHT_VOICE_AUDIO.UNKNOWN.en
}
