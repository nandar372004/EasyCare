import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getTranslation, translations } from './translations.js'

const LocalizationContext = createContext(null)
const STORAGE_KEY = 'easycare-language'
const HEALTH_INTELLIGENCE_MODE_KEY = 'easycare-health-intelligence-language-mode'

function initialLanguage() {
  try { const stored = sessionStorage.getItem(STORAGE_KEY); return stored === 'my' ? 'my' : 'en' } catch { return 'en' }
}

export function LocalizationProvider({ children }) {
  const [language, setLanguage] = useState(initialLanguage)
  const [healthIntelligenceMode, setHealthIntelligenceMode] = useState(() => {
    try { const stored = sessionStorage.getItem(HEALTH_INTELLIGENCE_MODE_KEY); return ['en', 'my', 'both'].includes(stored) ? stored : initialLanguage() } catch { return 'en' }
  })
  useEffect(() => { try { sessionStorage.setItem(STORAGE_KEY, language) } catch { /* session storage unavailable */ } }, [language])
  useEffect(() => { try { sessionStorage.setItem(HEALTH_INTELLIGENCE_MODE_KEY, healthIntelligenceMode) } catch { /* session storage unavailable */ } }, [healthIntelligenceMode])
  useEffect(() => { document.documentElement.lang = language === 'my' ? 'my' : 'en' }, [language])
  const value = useMemo(() => ({ language, locale: language === 'my' ? 'my-MM' : 'en-MM', setLanguage, healthIntelligenceMode, setHealthIntelligenceMode, t: (key) => getTranslation(translations[language], key) ?? key }), [language, healthIntelligenceMode])
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}

export function useLocalization() {
  const context = useContext(LocalizationContext)
  if (!context) throw new Error('useLocalization must be used within LocalizationProvider')
  return context
}

export function useOptionalLocalization() {
  return useContext(LocalizationContext)
}
