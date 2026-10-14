import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { landingCopy } from '../localization/landingTranslations.js'
import { ServicesPage } from './ServicesPage.jsx'
import { HowItWorksPage } from './HowItWorksPage.jsx'
import { AboutPage } from './AboutPage.jsx'
import { FamiliesPage } from './FamiliesPage.jsx'
import { ContactPage } from './ContactPage.jsx'

beforeEach(() => sessionStorage.clear())
afterEach(() => { cleanup(); vi.useRealTimers() })
const app = Page => <MemoryRouter><LocalizationProvider><Page /></LocalizationProvider></MemoryRouter>
const textNodes = root => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts = []; let node
  while ((node = walker.nextNode())) if (node.textContent.trim()) texts.push(node.textContent.trim())
  return texts
}
it.each([
  ['Services', ServicesPage, 'ဝန်ဆောင်မှုများ'],
  ['How It Works', HowItWorksPage, 'အသုံးပြုပုံ'],
  ['About EasyCare', AboutPage, 'EasyCare အကြောင်း'],
  ['For Families', FamiliesPage, 'မိသားစုများအတွက်'],
  ['Contact Us', ContactPage, 'ဆက်သွယ်ရန်'],
])('translates full %s content and restores the original English text', (name, Page, my) => {
  const view = render(app(Page))
  const original = textNodes(view.container)
  const copy = original.filter(text => landingCopy.some(([en]) => en === text))
  expect(copy.length).toBeGreaterThan(20)
  const links = [...view.container.querySelectorAll('a')].map(a => a.getAttribute('href'))
  const images = [...view.container.querySelectorAll('img')].map(img => img.getAttribute('src'))
  fireEvent.click(screen.getByRole('button', { name: 'Myanmar', exact: true }))
  expect(view.container.textContent).toContain(my)
  const translated = textNodes(view.container)
  for (const en of copy) expect(translated).not.toContain(en)
  expect(translated.join(' ')).not.toMatch(/landing\.undefined|copy\d+/)
  expect([...view.container.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(links)
  expect([...view.container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual(images)
  fireEvent.click(screen.getByRole('button', { name: 'English', exact: true }))
  expect(textNodes(view.container)).toEqual(original)
})
it.each(['en', 'my'])('preserves contact validation and demo submission in %s', language => {
  vi.useFakeTimers()
  sessionStorage.setItem('easycare-language', language)
  const view = render(app(ContactPage))
  const form = view.container.querySelector('form')
  fireEvent.submit(form)
  expect(screen.getAllByRole('alert')).toHaveLength(4)
  expect(view.container.querySelector('[name="email"]')).toHaveAttribute('aria-invalid', 'true')
  const input = (name, value) => fireEvent.change(form.querySelector(`[name="${name}"]`), { target: { value } })
  input('name', 'Example family'); input('email', 'family@example.com'); input('subject', 'Care services'); input('message', 'Please explain your care options.')
  expect(form.querySelector('[name="subject"]')).toHaveValue('Care services')
  fireEvent.click(screen.getByRole('button', { name: language === 'my' ? 'English' : 'Myanmar', exact: true }))
  expect(form.querySelector('[name="name"]')).toHaveValue('Example family')
  expect(form.querySelector('[name="subject"]')).toHaveValue('Care services')
  expect(form.querySelector('[name="message"]')).toHaveValue('Please explain your care options.')
  fireEvent.click(screen.getByRole('button', { name: language === 'my' ? 'Myanmar' : 'English', exact: true }))
  fireEvent.submit(form)
  expect(form.querySelector('[type="submit"]')).toBeDisabled()
  act(() => vi.advanceTimersByTime(699))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status')).toHaveTextContent(language === 'my' ? 'သရုပ်ပြစနစ်ဖြစ်၍' : 'Demo mode did not send or store it.')
  expect(form.querySelector('[name="name"]')).toHaveValue('')
  expect(form.querySelector('[name="subject"]')).toHaveValue('')
  expect(form.querySelector('[type="submit"]')).toBeEnabled()
})
