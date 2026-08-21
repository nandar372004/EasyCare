import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocalizationProvider, useLocalization } from './LocalizationContext.jsx'
import { translations } from './translations.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'

function flatten(value, prefix = '', output = {}) {
  Object.entries(value).forEach(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (item && typeof item === 'object') flatten(item, path, output)
    else output[path] = item
  })
  return output
}

function Harness() {
  const { language, setLanguage, t } = useLocalization()
  return <><span data-testid="language">{language}</span><span>{t('guardian.limitation')}</span><button onClick={() => setLanguage('my')}>မြန်မာ</button></>
}

describe('localization contract', () => {
  it('has exactly matching, non-empty English and Burmese keys', () => {
    const english = flatten(translations.en); const burmese = flatten(translations.my)
    expect(Object.keys(burmese).sort()).toEqual(Object.keys(english).sort())
    expect(new Set(Object.keys(english)).size).toBe(Object.keys(english).length)
    expect(Object.values(burmese).every(value => typeof value === 'string' && value.trim())).toBe(true)
  })

  it('uses valid Burmese Unicode text', () => {
    expect(flatten(translations.my)['nav.dashboard']).toMatch(/[\u1000-\u109F]/u)
    expect(JSON.stringify(translations.my)).not.toContain('\uFFFD')
  })

  it('changes language through React state and persists it for the session', () => {
    sessionStorage.clear(); render(<LocalizationProvider><Harness /></LocalizationProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'မြန်မာ' }))
    expect(screen.getByTestId('language')).toHaveTextContent('my')
    expect(sessionStorage.getItem('easycare-language')).toBe('my')
    expect(document.documentElement.lang).toBe('my')
  })

  it('formats dates in Asia/Yangon and currency as integer MMK', () => {
    expect(formatPresentationDateTime('2026-08-13T18:30:00.000Z', 'en-MM')).toContain('Aug 14')
    expect(formatMmk(25000, 'en-MM')).toBe('25,000 MMK')
  })
})
