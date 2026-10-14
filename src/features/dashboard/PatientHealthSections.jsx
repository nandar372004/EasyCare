import { useDashboardTranslation } from './useDashboardTranslation.js'
import { DashboardSkeleton } from './DashboardSkeleton.jsx'

export const label = value => value ? value.replaceAll('_', ' ') : 'Not recorded'
export function RecordedTime({ value, localized = false }) {
  const t = useDashboardTranslation()
  if (!value || !Number.isFinite(Date.parse(value))) return <span>{localized ? t('Not recorded') : 'Not recorded'}</span>
  return <time dateTime={value}>{/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : `${new Date(value).toLocaleString('en-US', { timeZone: 'Asia/Yangon' })} (Asia/Yangon)`}</time>
}
export function HealthSection({ title, section, empty, hasData = !!section?.data?.length, children }) {
  const t = useDashboardTranslation()
  return <article className="card patient-health-section" aria-label={t(title)}>
    <div className="section-title"><h2>{t(title)}</h2></div>
    {section?.status === 'loading' ? <DashboardSkeleton /> : section?.status !== 'ready' ? <p className="dashboard-compact-state" role="alert">{t("Temporarily unavailable.")}</p> : !hasData ? <p className="dashboard-empty">{t(empty)}</p> : children}
    {section?.refreshing && <small className="dashboard-refresh-indicator" role="status">{t("Refreshing…")}</small>}
  </article>
}
export const vitalMetrics = {
  heart_rate: { name: 'Heart Rate', fields: ['heartRate'], unit: 'bpm' },
  blood_pressure: { name: 'Blood Pressure', fields: ['systolicBp', 'diastolicBp'], unit: 'mmHg' },
  oxygen_saturation: { name: 'SpO2', fields: ['spo2'], unit: '%' },
  temperature: { name: 'Temperature', fields: ['temperatureC'], unit: '°C' },
  blood_glucose: { name: 'Blood Glucose', fields: ['glucoseMgDl'], unit: 'mg/dL' },
  weight_kg: { name: 'Weight', fields: ['weightKg'], unit: 'kg' },
}
export function HealthAtAGlance({ section }) {
  const vitals = section?.data
  return <HealthSection title="Health at a Glance" section={section} hasData empty="No recent readings.">
    {!Object.values(vitals || {}).some(Boolean) && <p>No recent readings.</p>}
    <dl className="patient-vitals-grid">{Object.entries(vitalMetrics).map(([key, metric]) => {
      const row = vitals?.[key]
      const values = metric.fields.map(field => row?.[field])
      const recorded = values.every(value => value != null)
      return <div className="patient-vital" key={key}><dt>{metric.name}</dt><dd><strong>{recorded ? `${values.join('/')} ${metric.unit}` : 'Not recorded'}</strong></dd>
        {recorded && <><dd><RecordedTime value={row.recordedAt} /></dd>{row.sourceType && <dd>Source: {label(row.sourceType)}</dd>}</>}
      </div>
    })}</dl>
  </HealthSection>
}
