import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'

export function HealthIntelligenceLanguageMode() {
  const localization = useOptionalLocalization()
  const healthIntelligenceMode = localization?.healthIntelligenceMode ?? 'en'
  const setHealthIntelligenceMode = localization?.setHealthIntelligenceMode ?? (() => {})
  return <fieldset className="health-intelligence-language-mode" aria-label="Health intelligence language">
    <legend>Explanation language</legend>
    {['en', 'my', 'both'].map(mode => <button key={mode} type="button" aria-pressed={healthIntelligenceMode === mode}
      className={healthIntelligenceMode === mode ? 'is-selected' : ''} onClick={() => setHealthIntelligenceMode(mode)}>
      {mode === 'en' ? 'English' : mode === 'my' ? 'မြန်မာ' : 'Both'}
    </button>)}
  </fieldset>
}

export function getHealthIntelligenceText(item, key, mode) {
  const en = item[`${key}_en`] ?? item[key]
  const my = item[`${key}_my`]
  if (mode === 'both') return { en, my, missingMyanmar: !my }
  if (mode === 'my' && my) return { my }
  return { en, missingMyanmar: mode === 'my' && !my }
}

export function HealthIntelligenceValue({ item, field, mode, as: Element = 'span' }) {
  const value = getHealthIntelligenceText(item, field, mode)
  return <Element className="health-intelligence-bilingual-value">
    {value.en && <span lang="en">{value.en}</span>}
    {value.my && <span lang="my">{mode === 'both' ? ' · ' : ''}{value.my}</span>}
    {value.missingMyanmar && <small className="health-intelligence-translation-fallback">Myanmar explanation unavailable; showing English.</small>}
  </Element>
}
