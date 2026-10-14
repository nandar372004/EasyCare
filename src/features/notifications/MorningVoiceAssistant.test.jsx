import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { MorningVoiceAssistant } from './MorningVoiceAssistant.jsx'
import { NightVoiceAssistant } from './NightVoiceAssistant.jsx'

const restoreGlobals = () => {
  vi.useRealTimers()
  delete window.Audio
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
}
afterEach(restoreGlobals)

function renderAssistants(path = '/dashboard') {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state: { openMorningVoiceAssistant: true } }]}><LocalizationProvider><Routes><Route path="*" element={<><MorningVoiceAssistant /><NightVoiceAssistant /></>} /></Routes></LocalizationProvider></MemoryRouter>)
}

function installAudioAndRecognition() {
  const audios = []
  const active = new Set()
  let peakAudioCount = 0
  class MockAudio {
    constructor(src) { this.src = src; this.paused = false; audios.push(this) }
    play() { this.paused = false; active.add(this); peakAudioCount = Math.max(peakAudioCount, active.size); return Promise.resolve() }
    pause() { this.paused = true; active.delete(this) }
    finish() { active.delete(this); this.onended?.() }
  }
  const recognitions = []
  class MockRecognition {
    constructor() { this.start = vi.fn(() => this.onstart?.()); this.stop = vi.fn(); this.abort = vi.fn(); recognitions.push(this) }
  }
  window.Audio = MockAudio
  window.SpeechRecognition = MockRecognition
  return { audios, recognitions, peak: () => peakAudioCount }
}

const openAtMorning = () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z')) // 09:30 in Yangon
}

describe('Morning Voice Assistant', () => {
  it.each([
    ['/dashboard', '2026-10-13T17:30:00Z'], // 01:00 Yangon
    ['/dashboard', '2026-10-14T00:00:00Z'], // 07:00 Yangon
    ['/dashboard', '2026-10-14T07:00:00Z'], // 14:00 Yangon
    ['/dashboard', '2026-10-14T13:00:00Z'], // 20:00 Yangon
    ['/dashboard', '2026-10-14T17:00:00Z'], // 23:30 Yangon
    ['/onboarding', '2026-10-14T17:00:00Z'], // Account creation at 23:30 Yangon
  ])('opens Morning after auth at %s at %s without opening Night', async (path, time) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(time))
    const { audios } = installAudioAndRecognition()
    renderAssistants(path)
    expect(await screen.findByRole('dialog', { name: 'Morning voice assistant' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Night assistant' })).not.toBeInTheDocument()
    await waitFor(() => expect(audios).toHaveLength(1))
    expect(audios[0].src).toBe('/audio/Good Morning(English).mp3')
  })

  it('runs the English sleep-reason conversation in order with no overlapping MP3s', async () => {
    openAtMorning()
    const { audios, recognitions, peak } = installAudioAndRecognition()
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    expect(audios[0].src).toBe('/audio/Good Morning(English).mp3')
    expect(screen.getByText('Good morning! Did you sleep well?')).toBeInTheDocument()
    expect(recognitions).toHaveLength(0)

    audios[0].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onresult({ results: [[{ transcript: "I couldn't sleep" }]] })
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[1].src).toBe('/audio/Why Not Sleep(English).mp3')
    audios[1].finish()

    await waitFor(() => expect(recognitions).toHaveLength(2))
    recognitions[1].onresult({ results: [[{ transcript: "It's not because of my neck." }]] })
    await waitFor(() => expect(audios).toHaveLength(3))
    expect(audios[2].src).toBe('/audio/So Why(English).mp3')
    audios[2].finish()

    await waitFor(() => expect(recognitions).toHaveLength(3))
    recognitions[2].onresult({ results: [[{ transcript: "I have a competition today, so I was too excited to sleep last night" }]] })
    await waitFor(() => expect(audios).toHaveLength(4))
    expect(audios[3].src).toBe('/audio/Good Luck(English).mp3')
    audios[3].finish()

    expect(await screen.findByText('Have a good day!')).toBeInTheDocument()
    expect(peak()).toBe(1)
  })

  it('maps a slept-well response to Good Sleep and completes', async () => {
    openAtMorning()
    const { audios, recognitions } = installAudioAndRecognition()
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onresult({ results: [[{ transcript: 'I slept well' }]] })
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[1].src).toBe('/audio/Good Sleep(English).mp3')
    audios[1].finish()
    expect(await screen.findByText('Have a good day!')).toBeInTheDocument()
  })

  it('goes directly to Good Luck when the first answer includes the competition explanation', async () => {
    openAtMorning()
    const { audios, recognitions } = installAudioAndRecognition()
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onresult({ results: [[{ transcript: "I couldn't sleep because I have a competition today" }]] })
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[1].src).toBe('/audio/Good Luck(English).mp3')
    expect(audios.some(audio => audio.src === '/audio/Why Not Sleep(English).mp3')).toBe(false)
    expect(audios.some(audio => audio.src === '/audio/So Why(English).mp3')).toBe(false)
  })

  it('switches the entire flow to Myanmar and completes the full follow-up path', async () => {
    openAtMorning()
    const { audios, recognitions, peak } = installAudioAndRecognition()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Myanmar' }))
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[0].paused).toBe(true)
    expect(audios[1].src).toBe('/audio/Good Morning(Myanmar).mp3')
    audios[1].finish()

    await waitFor(() => expect(recognitions).toHaveLength(1))
    expect(recognitions[0].lang).toBe('my-MM')
    recognitions[0].onresult({ results: [[{ transcript: 'အိပ်မပျော်ဘူး' }]] })
    await waitFor(() => expect(audios).toHaveLength(3))
    expect(audios[2].src).toBe('/audio/Why Not Sleep(Myanmar).mp3')
    audios[2].finish()

    await waitFor(() => expect(recognitions).toHaveLength(2))
    recognitions[1].onresult({ results: [[{ transcript: 'လည်ပင်းကြောင့်မဟုတ်ဘူး' }]] })
    await waitFor(() => expect(audios).toHaveLength(4))
    expect(audios[3].src).toBe('/audio/So Why(Myanmar).mp3')
    audios[3].finish()

    await waitFor(() => expect(recognitions).toHaveLength(3))
    recognitions[2].onresult({ results: [[{ transcript: 'ဒီနေ့ ပြိုင်ပွဲရှိလို့ စိတ်လှုပ်ရှားပြီး အိပ်မရတာ' }]] })
    await waitFor(() => expect(audios).toHaveLength(5))
    expect(audios[4].src).toBe('/audio/Good Luck(Myanmar).mp3')
    audios[4].finish()
    expect(await screen.findByText('ကောင်းသောနေ့လေး ဖြစ်ပါစေ။')).toBeInTheDocument()
    expect(peak()).toBe(1)
  })

  it('uses state-aware fallback choices when speech recognition is unavailable', async () => {
    openAtMorning()
    const audios = []
    class MockAudio {
      constructor(src) { this.src = src; audios.push(this) }
      play() { return Promise.resolve() }
      pause() {}
      finish() { this.onended?.() }
    }
    window.Audio = MockAudio
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    expect(await screen.findByRole('button', { name: 'I slept well' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "I couldn't sleep" })).toBeInTheDocument()
  })

  it.each([
    ['English', 'en', '/audio/Why Not Sleep(English).mp3', '/audio/So Why(English).mp3', '/audio/Good Luck(English).mp3'],
    ['Myanmar', 'my', '/audio/Why Not Sleep(Myanmar).mp3', '/audio/So Why(Myanmar).mp3', '/audio/Good Luck(Myanmar).mp3'],
  ])('plays the recognized-unknown fallback chain in %s without overlapping audio', async (_label, language, whyNotSleep, soWhy, goodLuck) => {
    openAtMorning()
    const { audios, recognitions, peak } = installAudioAndRecognition()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    let greetingIndex = 0
    if (language === 'my') {
      await user.click(screen.getByRole('button', { name: 'Myanmar' }))
      await waitFor(() => expect(audios).toHaveLength(2))
      greetingIndex = 1
      expect(audios[0].paused).toBe(true)
      expect(audios[1].src).toBe('/audio/Good Morning(Myanmar).mp3')
    }
    audios[greetingIndex].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onresult({ results: [[{ transcript: 'xyzzy quux' }]] })
    await waitFor(() => expect(audios).toHaveLength(greetingIndex + 2))
    expect(audios.at(-1).src).toBe(whyNotSleep)
    audios.at(-1).finish()
    await waitFor(() => expect(recognitions).toHaveLength(2))
    recognitions[1].onresult({ results: [[{ transcript: 'xyzzy quux' }]] })
    await waitFor(() => expect(audios).toHaveLength(greetingIndex + 3))
    expect(audios.at(-1).src).toBe(soWhy)
    audios.at(-1).finish()
    await waitFor(() => expect(recognitions).toHaveLength(3))
    recognitions[2].onresult({ results: [[{ transcript: 'xyzzy quux' }]] })
    await waitFor(() => expect(audios).toHaveLength(greetingIndex + 4))
    expect(audios.at(-1).src).toBe(goodLuck)
    audios.at(-1).finish()
    const completed = language === 'my' ? 'ကောင်းသောနေ့လေး ဖြစ်ပါစေ။' : 'Have a good day!'
    expect(await screen.findByText(completed)).toBeInTheDocument()
    expect(peak()).toBe(1)
  })

  it('retries listening after silence without advancing the fallback chain', async () => {
    openAtMorning()
    const { audios, recognitions } = installAudioAndRecognition()
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onerror({ error: 'no-speech' })
    expect(await screen.findByText("I didn't hear anything. Please try again.")).toBeInTheDocument()
    await waitFor(() => expect(recognitions).toHaveLength(2))
    expect(audios).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'I slept well' })).toBeInTheDocument()
  })

  it('keeps the existing response buttons on microphone permission errors', async () => {
    openAtMorning()
    const { audios, recognitions } = installAudioAndRecognition()
    renderAssistants()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    recognitions[0].onerror({ error: 'not-allowed' })
    expect(await screen.findByRole('button', { name: 'I slept well' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "I couldn't sleep" })).toBeInTheDocument()
    expect(audios).toHaveLength(1)
  })
})
