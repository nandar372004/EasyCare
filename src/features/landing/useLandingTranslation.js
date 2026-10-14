import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { landingKeys } from '../localization/landingTranslations.js'

// Landing copy uses the app provider and its existing preference storage.
export function useLandingTranslation() {
  const localization = useOptionalLocalization()
  return (text, context) => localization && (context || landingKeys[text]) ? localization.t(`landing.${context || landingKeys[text]}`) : text
}
