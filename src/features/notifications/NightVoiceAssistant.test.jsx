import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { isNightVoiceTime, NightVoiceAssistant } from './NightVoiceAssistant.jsx'

const restoreGlobals = () => {
  vi.useRealTimers()
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
  delete window.Audio
}
afterEach(restoreGlobals)

const renderAssistant = () => render(<MemoryRouter initialEntries={[{ pathname: '/dashboard', state: { openNightVoiceAssistant: true } }]}><LocalizationProvider><Routes><Route path="/dashboard" element={<NightVoiceAssistant />} /></Routes></LocalizationProvider></MemoryRouter>)

describe('Yangon night voice window', () => {
  it.each([
    ['2026-10-14T11:30:00Z', true], // 18:00 Yangon
    ['2026-10-14T17:29:00Z', true], // 23:59 Yangon
    ['2026-10-14T17:30:00Z', true], // 00:00 Yangon
    ['2026-10-14T19:29:00Z', true], // 01:59 Yangon
    ['2026-10-14T19:30:00Z', false], // 02:00 Yangon
    ['2026-10-14T11:29:00Z', false], // 17:59 Yangon
  ])('checks %s as %s', (time, expected) => {
    expect(isNightVoiceTime(new Date(time))).toBe(expected)
  })
})

describe('night voice playback sequence', () => {
  it('finishes each greeting before listening and plays the selected language response without overlap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    const sequence = []
    const audios = []
    const activeAudios = new Set()
    const recognitions = []
    let peakConcurrentAudio = 0
    class MockAudio {
      constructor(src) { this.src = src; audios.push(this) }
      play() { activeAudios.add(this); peakConcurrentAudio = Math.max(peakConcurrentAudio, activeAudios.size); sequence.push(`play:${this.src}`); return Promise.resolve() }
      pause() { this.paused = true; activeAudios.delete(this) }
      finish() { activeAudios.delete(this); this.onended?.() }
    }
    class MockRecognition {
      constructor() { this.start = vi.fn(() => { sequence.push('recognition:start'); this.onstart?.() }); this.stop = vi.fn(() => sequence.push('recognition:stop')); this.abort = vi.fn(); recognitions.push(this) }
    }
    window.Audio = MockAudio
    window.SpeechRecognition = MockRecognition
    const { unmount } = renderAssistant()

    await waitFor(() => expect(audios).toHaveLength(1))
    expect(audios[0].src).toBe('/audio/Greeting Night(English).mp3')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Night assistant')
    expect(screen.getByRole('dialog').querySelector('p')).toBeNull()
    expect(recognitions).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Myanmar' }))
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[0].paused).toBe(true)
    expect(audios[1].src).toBe('/audio/Greeting Night(Myanmar).mp3')
    expect(screen.getByRole('button', { name: 'Myanmar' })).toHaveAttribute('aria-pressed', 'true')
    audios[1].finish()
    await waitFor(() => expect(recognitions).toHaveLength(1))
    expect(recognitions[0].lang).toBe('my-MM')
    expect(sequence.indexOf('play:/audio/Greeting Night(Myanmar).mp3')).toBeLessThan(sequence.indexOf('recognition:start'))
    expect(screen.getByRole('status', { name: 'နားထောင်နေသည်' })).toBeInTheDocument()

    recognitions[0].onresult({ results: [[{ transcript: 'စစ်ပေးပါ' }]] })
    await waitFor(() => expect(audios).toHaveLength(3))
    expect(recognitions[0].stop).toHaveBeenCalledOnce()
    expect(sequence.indexOf('recognition:stop')).toBeLessThan(sequence.indexOf('play:/audio/Not Check(Myanmar).mp3'))
    expect(audios[2].src).toBe('/audio/Not Check(Myanmar).mp3')
    audios[2].finish()

    await userEvent.click(await screen.findByRole('button', { name: 'မစစ်နဲ့ / စစ်ပြီးပြီ' }))
    await waitFor(() => expect(audios).toHaveLength(4))
    expect(audios[3].src).toBe('/audio/Done Check(Myanmar).mp3')
    audios[3].finish()

    await userEvent.click(await screen.findByRole('button', { name: 'English' }))
    await waitFor(() => expect(audios).toHaveLength(5))
    expect(audios[4].src).toBe('/audio/Greeting Night(English).mp3')
    audios[4].finish()
    await waitFor(() => expect(recognitions).toHaveLength(2))
    expect(recognitions[1].lang).toBe('en-US')

    recognitions[1].onresult({ results: [[{ transcript: 'Please check' }]] })
    await waitFor(() => expect(audios).toHaveLength(6))
    expect(audios[5].src).toBe('/audio/Not Check(English).mp3')
    audios[5].finish()
    await userEvent.click(await screen.findByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(recognitions).toHaveLength(3))
    recognitions[2].onresult({ results: [[{ transcript: 'I already checked' }]] })
    await waitFor(() => expect(audios).toHaveLength(7))
    expect(audios[6].src).toBe('/audio/Done Check(English).mp3')
    audios[6].finish()
    await userEvent.click(await screen.findByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(recognitions).toHaveLength(4))
    recognitions[3].onresult({ results: [[{ transcript: 'tell me something else' }]] })
    await waitFor(() => expect(audios).toHaveLength(8))
    expect(audios[7].src).toBe('/audio/For Unknown(English).mp3')
    expect(peakConcurrentAudio).toBe(1)

    unmount()
  })

  it('keeps fallback buttons mapped when speech recognition is unavailable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
    const audios = []
    class MockAudio {
      constructor(src) { this.src = src; audios.push(this) }
      play() { return Promise.resolve() }
      pause() {}
      finish() { this.onended?.() }
    }
    window.Audio = MockAudio
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
    const { unmount } = renderAssistant()
    await waitFor(() => expect(audios).toHaveLength(1))
    audios[0].finish()
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Please check' }))
    await waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[1].src).toBe('/audio/Not Check(English).mp3')
    audios[1].finish()
    await userEvent.click(await screen.findByRole('button', { name: 'Already checked / Don’t check' }))
    await waitFor(() => expect(audios).toHaveLength(3))
    expect(audios[2].src).toBe('/audio/Done Check(English).mp3')
    unmount()
  })
})
