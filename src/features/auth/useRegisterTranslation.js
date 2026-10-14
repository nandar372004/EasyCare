import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { registerKeys } from '../localization/registerTranslations.js'

export function useRegisterTranslation() {
  const localization = useOptionalLocalization()
  return (text, context) => localization && (context || registerKeys[text])
    ? localization.t(`register.${context || registerKeys[text]}`) : text
}
