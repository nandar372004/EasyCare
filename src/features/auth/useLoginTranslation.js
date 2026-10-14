import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { loginKeys } from '../localization/loginTranslations.js'
import { GENERIC_AUTH_ERROR } from '../../services/authService.js'
import { DEMO_AUTH_ERROR } from '../../lib/prototypeMode.js'

export function useLoginTranslation() {
  const localization = useOptionalLocalization()
  return text => {
    if (!localization) return text
    if (text === GENERIC_AUTH_ERROR) return localization.t('login.genericError')
    if (text === DEMO_AUTH_ERROR) return localization.t('login.demoError')
    return loginKeys[text] ? localization.t(`login.${loginKeys[text]}`) : text
  }
}
