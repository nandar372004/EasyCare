import { Info } from 'lucide-react'
import { supabaseConfiguration } from '../lib/supabase.js'
import { HACKATHON_PROTOTYPE } from '../lib/prototypeMode.js'

export function DevelopmentConfigNotice() {
  if (HACKATHON_PROTOTYPE) return <div className="development-config-notice" role="status"><Info aria-hidden="true" /><span>Hackathon Prototype · Demo data only</span></div>
  if (!import.meta.env.DEV || supabaseConfiguration.isConfigured) return null

  return (
    <div className="development-config-notice" role="status">
      <Info aria-hidden="true" />
      <span>{supabaseConfiguration.message}</span>
    </div>
  )
}
