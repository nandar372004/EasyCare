import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getTranslation, translations } from './translations.js'

const LocalizationContext = createContext(null)
const STORAGE_KEY = 'easycare-language'

function initialLanguage() {
  try { const stored = sessionStorage.getItem(STORAGE_KEY); return stored === 'my' ? 'my' : 'en' } catch { return 'en' }
}

export function LocalizationProvider({ children }) {
  const [language, setLanguage] = useState(initialLanguage)
  useEffect(() => { try { sessionStorage.setItem(STORAGE_KEY, language) } catch { /* session storage unavailable */ } }, [language])
  useEffect(() => { document.documentElement.lang = language === 'my' ? 'my' : 'en' }, [language])
  const value = useMemo(() => ({ language, locale: language === 'my' ? 'my-MM' : 'en-MM', setLanguage, t: (key) => getTranslation(translations[language], key) ?? key }), [language])
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}

export function useLocalization() {
  const context = useContext(LocalizationContext)
  if (!context) throw new Error('useLocalization must be used within LocalizationProvider')
  return context
}
