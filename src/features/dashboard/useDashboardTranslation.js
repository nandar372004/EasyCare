import { useOptionalLocalization } from '../localization/LocalizationContext.jsx'
import { dashboardKeys } from '../localization/dashboardTranslations.js'

// Translate UI literals only. Callers pass fetched values as interpolation data.
export function useDashboardTranslation() {
 const localization = useOptionalLocalization()
 return (text, values = {}) => {
   const copy = localization && dashboardKeys[text] ? localization.t(`dashboard.${dashboardKeys[text]}`) : text
   return copy?.replace(/\{(\w+)\}/g, (match, key) => values[key] == null ? match : String(values[key]))
 }
}
