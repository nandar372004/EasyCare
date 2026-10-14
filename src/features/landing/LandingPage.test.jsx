import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingPage } from './LandingPage.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { landingCopy } from '../localization/landingTranslations.js'
import { LandingNavbar } from './LandingNavbar.jsx'
import englishGreeting from '../../../EasyCare Greeting(English).mp3'
import myanmarGreeting from '../../../EasyCare Greeting(Myanmar).mp3'

beforeEach(() => sessionStorage.clear())
afterEach(() => cleanup())
const localizedPage = () => <MemoryRouter><LocalizationProvider><LandingPage /></LocalizationProvider></MemoryRouter>
function CurrentPath() { return <output data-testid="current-path">{useLocation().pathname}</output> }

describe('Landing navigation translations', () => {
  it.each([
    ['Services', 'ဝန်ဆောင်မှုများ', '/services'],
    ['How It Works', 'ဘယ်လိုအလုပ်လုပ်သလဲ', '/how-it-works'],
    ['About EasyCare', 'EasyCare အကြောင်း', '/about'],
    ['For Families', 'မိသားစုများအတွက်', '/families'],
    ['Contact Us', 'ဆက်သွယ်ရန်', '/contact'],
  ])('preserves %s labels and destination in both languages', (en, my, path) => {
    render(<MemoryRouter><LocalizationProvider><LandingNavbar localized /><CurrentPath /></LocalizationProvider></MemoryRouter>)
    const englishNav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(englishNav.getAllByRole('button')).toHaveLength(6)
    fireEvent.click(englishNav.getByRole('button', { name: en, exact: true }))
    expect(screen.getByTestId('current-path')).toHaveTextContent(path)
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    const myanmarNav = within(screen.getByRole('navigation', { name: 'အဓိက လမ်းညွှန်' }))
    expect(myanmarNav.getAllByRole('button')).toHaveLength(6)
    fireEvent.click(myanmarNav.getByRole('button', { name: my, exact: true }))
    expect(screen.getByTestId('current-path')).toHaveTextContent(path)
    fireEvent.click(screen.getByRole('button', { name: 'မီနူး ဖွင့်ရန်' }))
    const mobileNav = within(screen.getByRole('navigation', { name: 'မိုဘိုင်း လမ်းညွှန်' }))
    expect(mobileNav.getAllByRole('button')).toHaveLength(6)
    fireEvent.click(mobileNav.getByRole('button', { name: my, exact: true }))
    expect(screen.getByTestId('current-path')).toHaveTextContent(path)
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: en, exact: true })).toBeInTheDocument()
  })
})

describe('Landing localization', () => {
  beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('switches all copy immediately, preserves English and saves the existing session preference', () => {
    const view = render(localizedPage())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Smarter Care,')
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ပိုမိုကျန်းမာသော ဘဝများ')
    expect(sessionStorage.getItem('easycare-language')).toBe('my')
    expect(screen.getByText('အိမ်တိုင်ရာရောက် ဆရာဝန်')).toBeInTheDocument()
    expect(screen.getByText('ကျွန်ုပ်တို့၏ ဝန်ဆောင်မှုများ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EasyCare မိတ်ဆက်အသံ ဖွင့်ရန်' })).toBeInTheDocument()
    expect(view.container.textContent).not.toMatch(/landing\.undefined|Smarter Care|Learn more|Sign In/)
    view.unmount()
    const refreshed = render(localizedPage())
    expect(screen.getByRole('button', { name: 'Myanmar' })).toHaveAttribute('aria-pressed', 'true')
    expect(refreshed.container.querySelector('.ec-landing-page')).toHaveAttribute('lang', 'my')
    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Smarter Care,')
    expect(screen.getByText('Doctor Home Visits')).toBeInTheDocument()
    expect(sessionStorage.getItem('easycare-language')).toBe('en')
  })
  it('localizes the mobile menu and keeps destination links unchanged', () => {
    render(localizedPage())
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar' }))
    fireEvent.click(screen.getByRole('button', { name: 'မီနူး ဖွင့်ရန်' }))
    expect(screen.getByRole('navigation', { name: 'မိုဘိုင်း လမ်းညွှန်' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'အကောင့်ဝင်ရန်' }).every(link => link.getAttribute('href') === '/login')).toBe(true)
    expect(screen.getByRole('link', { name: 'ဆရာဝန်နှင့် ချိန်းရန်' })).toHaveAttribute('href', '/doctors')
  })
  it('provides nonempty Myanmar copy for every landing translation', () => {
    for (const [en, my] of landingCopy) {
      expect(en).toBeTruthy()
      expect(my).toMatch(/[\u1000-\u109f]/)
    }
  })
  it('does not localize the shared navbar on unrelated public pages', () => {
    sessionStorage.setItem('easycare-language', 'my')
    render(<MemoryRouter><LocalizationProvider><LandingNavbar activePage="contact" /></LocalizationProvider></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Contact Us' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Myanmar' })).not.toBeInTheDocument()
  })
})

describe('Landing Page introduction audio', () => {
  afterEach(() => vi.restoreAllMocks())

  it('plays only after interaction, pauses, resumes, resets at end, and cleans up', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const page = render(<MemoryRouter><LandingPage /></MemoryRouter>)
    const audio = page.container.querySelector('audio')
    const playButton = screen.getByRole('button', { name: 'Play EasyCare introduction' })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Smarter Care,')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Healthier Lives')
    expect(screen.getByText('Healthcare Without Boundaries')).toBeInTheDocument()
    expect(playButton).toHaveClass('is-attention')
    expect(audio).toHaveAttribute('src', englishGreeting)
    expect(audio).not.toHaveAttribute('autoplay')
    expect(audio).toHaveAttribute('preload', 'none')
    expect(play).not.toHaveBeenCalled()

    fireEvent.click(playButton)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause EasyCare introduction' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: 'Pause EasyCare introduction' })).toHaveClass('is-playing')
    expect(screen.getByRole('button', { name: 'Pause EasyCare introduction' })).not.toHaveClass('is-attention')
    expect(play).toHaveBeenCalledTimes(1)

    audio.currentTime = 4
    fireEvent.click(screen.getByRole('button', { name: 'Pause EasyCare introduction' }))
    expect(pause).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Play EasyCare introduction' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Play EasyCare introduction' }))
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    expect(audio.currentTime).toBe(4)
    fireEvent.ended(audio)
    expect(screen.getByRole('button', { name: 'Play EasyCare introduction' })).toHaveAttribute('aria-pressed', 'false')
    expect(audio.currentTime).toBe(0)

    page.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('selects the greeting audio for the current language and stops playback when language changes', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const page = render(<MemoryRouter><LocalizationProvider><LandingPage /></LocalizationProvider></MemoryRouter>)
    const audio = page.container.querySelector('audio')
    expect(audio).toHaveAttribute('src', englishGreeting)

    fireEvent.click(screen.getByRole('button', { name: 'Play EasyCare introduction' }))
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
    await waitFor(() => expect(audio).toHaveAttribute('src', myanmarGreeting))
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBe(0)
    expect(screen.getByRole('button', { name: 'EasyCare မိတ်ဆက်အသံ ဖွင့်ရန်' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
    await waitFor(() => expect(audio).toHaveAttribute('src', englishGreeting))
    page.unmount()
  })
})
