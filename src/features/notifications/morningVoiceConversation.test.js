import { describe, expect, it } from 'vitest'
import { createMorningConversation, detectMorningIntent, morningConversationReducer } from './morningVoiceConversation.js'
describe('morning conversation intent priority', () => {
  it('checks negative sleep phrases before positive patterns', () => {
    expect(detectMorningIntent('အိပ်မပျော်ဘူး', 'WAITING_FOR_SLEEP_STATUS')).toBe('DID_NOT_SLEEP_WELL')
    expect(detectMorningIntent('ကောင်းကောင်းမအိပ်ရဘူး', 'WAITING_FOR_SLEEP_STATUS')).toBe('DID_NOT_SLEEP_WELL')
    expect(detectMorningIntent("I didn't sleep well", 'WAITING_FOR_SLEEP_STATUS')).toBe('DID_NOT_SLEEP_WELL')
    expect(detectMorningIntent("I couldn't sleep", 'WAITING_FOR_SLEEP_STATUS')).toBe('DID_NOT_SLEEP_WELL')
    expect(detectMorningIntent('I slept well', 'WAITING_FOR_SLEEP_STATUS')).toBe('SLEPT_WELL')
  })

  it('does not skip the neck follow-up unless a competition explanation is supplied', () => {
    expect(detectMorningIntent("It's not because of my neck.", 'WAITING_FOR_SLEEP_REASON')).toBe('NOT_NECK_RELATED')
    expect(detectMorningIntent("It's not because of my neck. I have a competition today and was excited.", 'WAITING_FOR_SLEEP_REASON')).toBe('COMPETITION_EXCITEMENT')
    expect(detectMorningIntent('I have a competition today', 'WAITING_FOR_EXPLANATION')).toBe('COMPETITION_EXCITEMENT')
  })

  it('takes the direct slept-well flow to completion', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'SLEPT_WELL' })
    expect(state.step).toBe('PLAYING_GOOD_SLEEP')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_GOOD_SLEEP', id: state.playback.id })
    expect(state.step).toBe('COMPLETED')
  })

  it('routes the full sleep-reason flow through So Why before Good Luck', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'DID_NOT_SLEEP_WELL' })
    expect(state.step).toBe('PLAYING_WHY_NOT_SLEEP')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_WHY_NOT_SLEEP', id: state.playback.id })
    expect(state.step).toBe('WAITING_FOR_SLEEP_REASON')
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'NOT_NECK_RELATED' })
    expect(state.step).toBe('PLAYING_SO_WHY')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_SO_WHY', id: state.playback.id })
    expect(state.step).toBe('WAITING_FOR_EXPLANATION')
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'COMPETITION_EXCITEMENT' })
    expect(state.step).toBe('PLAYING_GOOD_LUCK')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_GOOD_LUCK', id: state.playback.id })
    expect(state.step).toBe('COMPLETED')
  })

  it('plays Good Luck directly when the initial sleep response already explains the competition', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    const intent = detectMorningIntent("I couldn't sleep because I have a competition today and I was excited", state.step)
    state = morningConversationReducer(state, { type: 'INTENT', intent })
    expect(state.step).toBe('PLAYING_GOOD_LUCK')
  })

  it('plays the step-specific fallback sequence only for recognized unknown speech', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'UNKNOWN' })
    expect(state.step).toBe('PLAYING_WHY_NOT_SLEEP')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_WHY_NOT_SLEEP', id: state.playback.id })
    expect(state.step).toBe('WAITING_FOR_SLEEP_REASON')
  })

  it('keeps silence on the same question and starts another listening cycle', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'NO_SPEECH' })
    expect(state.step).toBe('WAITING_FOR_SLEEP_STATUS')
    expect(state.notice).toBe('silence')
    expect(state.listenCycle).toBe(1)
    expect(state.playback).toBeNull()
  })

  it('advances recognized unknowns from sleep reason to So Why, then Good Luck and completion', () => {
    let state = createMorningConversation()
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'MORNING_GREETING', id: 1 })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'UNKNOWN' })
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_WHY_NOT_SLEEP', id: state.playback.id })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'UNKNOWN' })
    expect(state.step).toBe('PLAYING_SO_WHY')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_SO_WHY', id: state.playback.id })
    state = morningConversationReducer(state, { type: 'INTENT', intent: 'UNKNOWN' })
    expect(state.step).toBe('PLAYING_GOOD_LUCK')
    state = morningConversationReducer(state, { type: 'AUDIO_ENDED', step: 'PLAYING_GOOD_LUCK', id: state.playback.id })
    expect(state.step).toBe('COMPLETED')
  })
})
