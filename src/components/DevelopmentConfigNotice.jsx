import { Info } from 'lucide-react'
import { supabaseConfiguration } from '../lib/supabase.js'

export function DevelopmentConfigNotice() {
  if (!import.meta.env.DEV || supabaseConfiguration.isConfigured) return null

  return (
    <div className="development-config-notice" role="status">
      <Info aria-hidden="true" />
      <span>{supabaseConfiguration.message}</span>
    </div>
  )
}
