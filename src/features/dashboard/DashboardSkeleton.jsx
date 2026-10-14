import { useDashboardTranslation } from './useDashboardTranslation.js'
export function DashboardSkeleton({ label = 'Loading…' }) {
  const t = useDashboardTranslation()
  return <div className="dashboard-section-skeleton" role="status" aria-label={t(label)}><span className="sr-only">{t(label)}</span><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div>
}
