import { describe, expect, it } from 'vitest'
import { detectNightVoiceIntent, nightVoiceAudioFor } from './nightVoiceIntent.js'

describe('night voice intent mapping', () => {
  it.each([
    ['စစ်ပေးပါ', 'CHECK_REQUEST', '/audio/Not Check(Myanmar).mp3'],
    ['စစ်ကြည့်ပေးပါ', 'CHECK_REQUEST', '/audio/Not Check(Myanmar).mp3'],
    ['မစစ်နဲ့', 'ALREADY_CHECKED_OR_DECLINE', '/audio/Done Check(Myanmar).mp3'],
    ['ငါစစ်ပြီးပြီ', 'ALREADY_CHECKED_OR_DECLINE', '/audio/Done Check(Myanmar).mp3'],
    ['Please check', 'CHECK_REQUEST', '/audio/Not Check(English).mp3'],
    ["Don't check", 'ALREADY_CHECKED_OR_DECLINE', '/audio/Done Check(English).mp3'],
    ['I already checked', 'ALREADY_CHECKED_OR_DECLINE', '/audio/Done Check(English).mp3'],
  ])('%s maps to %s and its confirmed audio', (text, intent, audio) => {
    const result = detectNightVoiceIntent(text)
    expect(result.intent).toBe(intent)
    expect(nightVoiceAudioFor(result.intent, result.language)).toBe(audio)
  })

  it('prioritizes negative Myanmar forms over the positive check verb', () => {
    expect(detectNightVoiceIntent('မစစ်နဲ့').intent).toBe('ALREADY_CHECKED_OR_DECLINE')
  })

  it('keeps unsupported recognized speech unknown and empty input as no speech', () => {
    expect(detectNightVoiceIntent('tell me a joke')).toEqual({ intent: 'UNKNOWN', language: 'en' })
    expect(nightVoiceAudioFor('UNKNOWN', 'en')).toBe('/audio/For Unknown(English).mp3')
    expect(detectNightVoiceIntent('')).toEqual({ intent: 'NO_SPEECH', language: 'en' })
  })
})
