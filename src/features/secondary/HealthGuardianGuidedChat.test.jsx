import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { HealthGuardianGuidedChat, WHO_HEAT_HEALTH_URL } from './HealthGuardianGuidedChat.jsx'
import askMedicineEnglish from '../../../Ask Medicine(English).mp3'
import askMedicineMyanmar from '../../../Ask Medicine(Myanmar).mp3'
import aboutMedicineEnglish from '../../../About Medicine(English).mp3'
import aboutMedicineMyanmar from '../../../About Medicine(Myanmar).mp3'
import heatProtectionEnglish from '../../../Heat Protection(English).mp3'
import heatProtectionMyanmar from '../../../Heat Protection(Myanmar).mp3'

const audioInstances = []
let maxConcurrentAudio = 0

class MockAudio {
  constructor(src) { this.src = src; this.currentTime = 0; this.playing = false; this.onended = null; this.onerror = null; audioInstances.push(this) }
  play() { this.playing = true; maxConcurrentAudio = Math.max(maxConcurrentAudio, audioInstances.filter(audio => audio.playing).length); return Promise.resolve() }
  pause() { this.playing = false }
  finish() { this.playing = false; this.onended?.() }
  fail() { this.playing = false; this.onerror?.() }
}

class MockRecognition {
  static instances = []
  constructor() { MockRecognition.instances.push(this) }
  start() { this.started = true; this.onstart?.() }
  stop() { this.onend?.() }
  abort() { this.aborted = true; this.onend?.() }
  result(text) { this.onresult?.({ results: [[{ transcript: text }]] }) }
  finish() { this.onend?.() }
  fail(error = 'not-allowed') { this.onerror?.({ error }) }
}

const clipView = language => <LocalizationProvider><HealthGuardianGuidedChat language={language} /></LocalizationProvider>
const chooseCategory = label => fireEvent.click(within(screen.getByRole('group')).getByText(label, { exact: true }).closest('button'))

beforeEach(() => {
  sessionStorage.clear()
  audioInstances.length = 0
  MockRecognition.instances = []
  maxConcurrentAudio = 0
  vi.stubGlobal('Audio', MockAudio)
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, writable: true, value: MockRecognition })
  delete window.webkitSpeechRecognition
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
})

describe('AI Health Guardian guided voice categories', () => {
  it.each([
    ['en', askMedicineEnglish, aboutMedicineEnglish, 'Medicine', 'Medicine name', 'A medicine name alone is not enough to provide safe advice.'],
    ['my', askMedicineMyanmar, aboutMedicineMyanmar, 'ဆေးဝါး', 'ဆေးအမည်', 'ဆေးအမည်တစ်ခုတည်းဖြင့် လုံခြုံသော အကြံပြုချက်ပေးရန် မလုံလောက်ပါ။'],
  ])('runs the Medicine voice flow in %s without overlapping audio', async (language, askClip, aboutClip, categoryLabel, inputLabel, safetyText) => {
    sessionStorage.setItem('easycare-language', language)
    render(clipView(language))
    chooseCategory(categoryLabel)
    fireEvent.click(screen.getByRole('button', { name: language === 'my' ? 'အသံဖြင့် ပြောရန်' : 'Start voice message' }))
    const recognition = MockRecognition.instances[0]
    expect(recognition.lang).toBe(language === 'my' ? 'my-MM' : 'en-US')
    act(() => { recognition.result('Can I ask about a medicine?'); recognition.finish() })
    await waitFor(() => expect(audioInstances).toHaveLength(1))
    expect(audioInstances[0].src).toBe(askClip)
    expect(screen.getByRole('button', { name: language === 'my' ? 'အသံဖြင့် ပြောရန်' : 'Start voice message' })).toBeDisabled()
    act(() => audioInstances[0].finish())

    const medicineInput = await screen.findByRole('textbox', { name: inputLabel })
    fireEvent.change(medicineInput, { target: { value: 'Amlodipine' } })
    fireEvent.click(screen.getByRole('button', { name: language === 'my' ? 'ပို့ရန်' : 'Send' }))
    expect(screen.getByText('Can I ask about a medicine?')).toBeInTheDocument()
    expect(screen.getByText('Amlodipine')).toBeInTheDocument()
    await waitFor(() => expect(audioInstances).toHaveLength(2))
    expect(audioInstances[1].src).toBe(aboutClip)
    act(() => audioInstances[1].finish())
    expect(await screen.findByText(new RegExp(safetyText))).toBeInTheDocument()
    expect(maxConcurrentAudio).toBe(1)
  })

  it.each([
    ['en', heatProtectionEnglish, 'Health General', 'Read WHO Guidance'],
    ['my', heatProtectionMyanmar, 'အထွေထွေ ကျန်းမာရေး', 'WHO လမ်းညွှန်ချက် ဖတ်ရန်'],
  ])('plays Health General guidance and shows the official WHO link in %s', async (language, clip, categoryLabel, linkLabel) => {
    sessionStorage.setItem('easycare-language', language)
    render(clipView(language))
    chooseCategory(categoryLabel)
    fireEvent.click(screen.getByRole('button', { name: language === 'my' ? 'အသံဖြင့် ပြောရန်' : 'Start voice message' }))
    const recognition = MockRecognition.instances[0]
    act(() => { recognition.result('How can I stay safe in hot weather?'); recognition.finish() })
    await waitFor(() => expect(audioInstances).toHaveLength(1))
    expect(audioInstances[0].src).toBe(clip)
    act(() => audioInstances[0].finish())
    const whoLink = await screen.findByRole('link', { name: linkLabel })
    expect(whoLink).toHaveAttribute('href', WHO_HEAT_HEALTH_URL)
    expect(whoLink).toHaveAttribute('target', '_blank')
    expect(whoLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('provides direct text and heat guidance fallbacks when speech recognition is unavailable', async () => {
    delete window.SpeechRecognition
    const page = render(clipView('en'))
    fireEvent.click(screen.getByRole('button', { name: 'Start voice message' }))
    expect(await screen.findByRole('textbox', { name: 'Medicine name' })).toBeInTheDocument()
    chooseCategory('Health General')
    fireEvent.click(screen.getByRole('button', { name: 'Start voice message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Heat Protection Guidance' }))
    await waitFor(() => expect(audioInstances).toHaveLength(1))
    expect(audioInstances[0].src).toBe(heatProtectionEnglish)
    act(() => audioInstances[0].finish())
    expect(await screen.findByRole('link', { name: 'Read WHO Guidance' })).toHaveAttribute('href', WHO_HEAT_HEALTH_URL)
    page.unmount()
  })

  it('stops microphone and audio on category switch while preserving guided chat history', async () => {
    render(clipView('en'))
    fireEvent.click(screen.getByRole('button', { name: 'Start voice message' }))
    const recognition = MockRecognition.instances[0]
    act(() => { recognition.result('Can I ask about a medicine?'); recognition.finish() })
    await waitFor(() => expect(audioInstances).toHaveLength(1))
    chooseCategory('Health General')
    expect(audioInstances[0].playing).toBe(false)
    expect(audioInstances[0].currentTime).toBe(0)
    expect(screen.getByText('Can I ask about a medicine?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start voice message' }))
    const activeRecognition = MockRecognition.instances[1]
    chooseCategory('Medicine')
    expect(activeRecognition.aborted).toBe(true)
  })

  it('falls back after a microphone permission error without playing guided audio', async () => {
    render(clipView('en'))
    fireEvent.click(screen.getByRole('button', { name: 'Start voice message' }))
    act(() => MockRecognition.instances[0].fail())
    expect(await screen.findByRole('textbox', { name: 'Medicine name' })).toBeInTheDocument()
    expect(audioInstances).toHaveLength(0)
    expect(screen.getByText(/Voice recognition is unavailable/)).toBeInTheDocument()
  })
})
