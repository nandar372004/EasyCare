import { useDashboardTranslation } from './useDashboardTranslation.js'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CalendarDays, ChevronRight, Clock3, Gauge, Info, ListChecks } from 'lucide-react'
import { analyzeMonitoringReadings } from '../../services/patientMonitoringService.js'
import { RecordedTime } from './PatientHealthSections.jsx'
import { DashboardSkeleton } from './DashboardSkeleton.jsx'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const names = { blood_pressure: 'Blood Pressure', weight: 'Weight', heart_rate: 'Heart Rate', blood_glucose: 'Blood Sugar', temperature: 'Temperature' }
const readingTime = row => row.recordedAt ? <RecordedTime value={row.recordedAt} /> : <time dateTime={row.date || row.localDate}>{row.date || row.localDate}</time>
const PRESENTATION_PATIENT = 'nandar kyaw'
const RECORDED_DATA_START = '2026-10-12'
const placeholderBloodPressure = [
  { date: '2026-10-06', systolicValue: 116, diastolicValue: 74 },
  { date: '2026-10-07', systolicValue: 114, diastolicValue: 73 },
  { date: '2026-10-08', systolicValue: 117, diastolicValue: 75 },
  { date: '2026-10-09', systolicValue: 115, diastolicValue: 72 },
  { date: '2026-10-10', systolicValue: 118, diastolicValue: 76 },
  { date: '2026-10-11', systolicValue: 115, diastolicValue: 74 },
].map(row => ({ ...row, presentationOnly: true }))

export function getHealthTrendPresentationSeries({ patientName, measurementType, period, asOfDate, recordedSeries }) {
  const isPresentationCase = String(patientName || '').trim().toLocaleLowerCase('en') === PRESENTATION_PATIENT
  if (!isPresentationCase || measurementType !== 'blood_pressure') return []
  const start = new Date(`${asOfDate}T12:00:00Z`)
  start.setUTCDate(start.getUTCDate() - Number(period) + 1)
  const firstVisibleDate = start.toISOString().slice(0, 10)
  const recordedDates = new Set(recordedSeries.map(row => row.date))
  return placeholderBloodPressure.filter(row => row.date >= firstVisibleDate && row.date <= asOfDate && row.date < RECORDED_DATA_START && !recordedDates.has(row.date))
}

export function HealthTrends({ monitoring, asOfDate = today(), patientName = '' }) {
  const t = useDashboardTranslation()
  const [metric, setMetric] = useState('')
  const [period, setPeriod] = useState('7')
  const result = useMemo(() => {
    if (monitoring?.status !== 'ready') return { analyses: [] }
    try {
      const analyses = (monitoring.data?.plans || []).filter(plan => plan.measurementType && plan.measurementUnit)
        .map(plan => analyzeMonitoringReadings({ plan, checkIns: monitoring.data?.checkIns || [], asOfDate }))
        .filter(analysis => analysis.latest)
      return { analyses }
    } catch { return { analyses: [], error: true } }
  }, [monitoring?.status, monitoring?.data, asOfDate])
  const analysis = result.analyses.find(item => item.planId === metric)
    || result.analyses.find(item => item.measurementType === 'blood_pressure') || result.analyses[0]
  const bp = analysis?.measurementType === 'blood_pressure'
  const unit = analysis?.measurementUnit
  const series = analysis?.[`series${period}Days`] || []
  const presentationSeries = getHealthTrendPresentationSeries({ patientName, measurementType: analysis?.measurementType, period, asOfDate, recordedSeries: series })
  const average = analysis?.[`average${period}Days`]
  const valueLabel = row => bp ? `${row.systolicValue} / ${row.diastolicValue} ${unit}` : `${row.value} ${row.measurementUnit || unit}`
  const error = monitoring?.status === 'error' || result.error
  const metricName = names[analysis?.measurementType] ? t(names[analysis.measurementType]) : analysis?.title || t('Monitoring')
  const trendTitle = t('{name} Trend', { name: metricName })
  const enoughReadings = series.length >= 2 || (bp && presentationSeries.length + series.length >= 2)
  const infoMessage = series.length === 1 ? t('One reading recorded. More readings are needed to show a trend.') : series.length === 0 ? t('No readings in this period.') : ''
  return <article className="card patient-health-section health-trends-card" aria-label={t("Health Trends")}>
    <header className="health-trends-header">
      <div className="health-trends-heading"><span className="health-trends-heading-icon"><Activity aria-hidden="true" /></span><div><h2>{t("Health Trends")}</h2><small>{t("From My Care Plan monitoring")}</small></div></div>
      <div className="patient-trend-controls">
        <label><span className="sr-only">{t("Measurement")}</span><select aria-label={t("Measurement")} value={analysis?.planId || ''} onChange={event => setMetric(event.target.value)} disabled={!analysis}>{result.analyses.map(item => <option key={item.planId} value={item.planId}>{names[item.measurementType] ? t(names[item.measurementType]) : item.title}{result.analyses.filter(other => other.measurementType === item.measurementType).length > 1 ? ` · ${item.title}` : ''}</option>)}</select></label>
        <label className="patient-trend-period-label"><CalendarDays aria-hidden="true" /><span className="sr-only">{t("Period")}</span><select aria-label={t("Period")} value={period} onChange={event => setPeriod(event.target.value)}><option value="7">{t("7 Days")}</option><option value="30">{t("30 Days")}</option></select></label>
      </div>
    </header>
    {error ? <p role="alert" className="dashboard-compact-state">{t("Health trends are temporarily unavailable.")}</p>
      : monitoring?.status !== 'ready' ? <DashboardSkeleton label="Loading health trends…" />
      : !analysis ? <><p>{t("No monitoring measurements yet.")}</p><Link to="/my-care-plan">{t("Add a measurement in My Care Plan")}</Link></>
      : <>
        <div className="health-trends-layout">
          <section className="health-trends-chart-panel" aria-label={t('{name} chart', { name: trendTitle })}>
            <h3>{trendTitle}</h3>
            {enoughReadings ? <MonitoringTrendChart series={series} presentationSeries={presentationSeries} bp={bp} unit={unit} name={names[analysis.measurementType] || analysis.title} /> : <div className="health-trends-chart-empty"><Activity aria-hidden="true" /><span>{t("Chart will appear as readings are recorded.")}</span></div>}
          </section>
          <aside className="health-trends-side" aria-label={t("Trend summary")}>
            <div className="dashboard-bp-summary" aria-label={`${names[analysis.measurementType] || analysis.title} summary`}>
              <div><Activity aria-hidden="true" /><span>{t("Latest")}</span><strong>{valueLabel(analysis.latest)}</strong></div>
              <div><Gauge aria-hidden="true" /><span>{t('{days}-day Average', { days: period })}</span><strong>{series.length ? bp ? `${average.systolic} / ${average.diastolic} ${unit}` : `${average.value} ${unit}` : t("Not available")}</strong></div>
              <div><ListChecks aria-hidden="true" /><span>{t("Readings")}</span><strong>{analysis[`count${period}Days`]}</strong></div>
              <div><Clock3 aria-hidden="true" /><span>{t("Last recorded")}</span><strong>{readingTime(analysis.latest)}</strong></div>
            </div>
            {infoMessage && <p className="health-trends-info"><Info aria-hidden="true" />{infoMessage}</p>}
          </aside>
        </div>
      </>}
    <Link className="health-trends-link" to="/my-care-plan">{t("View Monitoring")} <ChevronRight aria-hidden="true" /></Link>
    {monitoring?.refreshing && <small className="dashboard-refresh-indicator" role="status">{t("Refreshing…")}</small>}
  </article>
}

function MonitoringTrendChart({ series, presentationSeries = [], bp, unit, name }) {
  const t = useDashboardTranslation()
  const fields = bp ? ['systolicValue', 'diastolicValue'] : ['value']
  const plotRows = [...presentationSeries, ...series].sort((a, b) => a.date.localeCompare(b.date))
  const values = plotRows.flatMap(row => fields.map(field => row[field]))
  const low = Math.min(...values), high = Math.max(...values)
  const time = row => Date.parse(`${row.date}T12:00:00Z`)
  const start = time(plotRows[0]), end = time(plotRows.at(-1))
  const x = row => 65 + (time(row) - start) / (end - start || 1) * 340
  const y = value => 135 - (value - low) / (high - low || 1) * 90
  const plotGroup = (rows, field, color, placeholder = false) => <g key={`${placeholder ? 'placeholder' : 'recorded'}-${field}`} aria-label={placeholder ? t("Placeholder") : t("Recorded")}>
    {rows.length > 1 && <polyline fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={placeholder ? '6 5' : undefined} opacity={placeholder ? .42 : 1} points={rows.map(row => `${x(row)},${y(row[field])}`).join(' ')} />}
    {rows.map((row, position) => <circle key={`${field}-${row.date}-${position}`} cx={x(row)} cy={y(row[field])} r={placeholder ? 4 : 4.5} fill={placeholder ? 'white' : color} stroke={color} strokeWidth="2" opacity={placeholder ? .55 : 1}><title>{placeholder ? t("Placeholder history") : t("Recorded")} · {row.date}: {row[field]} {unit}</title></circle>)}
  </g>
  return <>
    <svg className="patient-trend-chart" viewBox="0 0 480 190" role="img" aria-label={t('{name} chart. Placeholder history is distinct from recorded monitoring readings.', { name })}>
      <text x="5" y="20">{unit}</text>
      {[45, 75, 105, 135].map(yValue => <line key={yValue} x1="55" y1={yValue} x2="450" y2={yValue} className="health-trend-gridline" />)}
      <text x="5" y="48">{Math.round(high)}</text><text x="5" y="138">{Math.round(low)}</text>
      {presentationSeries.length > 0 && series.some(row => row.date >= RECORDED_DATA_START) && <><line x1={x({ date: RECORDED_DATA_START })} y1="30" x2={x({ date: RECORDED_DATA_START })} y2="145" stroke="#8da7bb" strokeDasharray="3 4" /><text x={x({ date: RECORDED_DATA_START })} y="24" textAnchor="middle" fontSize="8">{t("Recorded data begins")}</text></>}
      {fields.map((field, index) => {
        const color = index ? 'var(--navy)' : 'var(--primary)'
        const placeholders = presentationSeries.filter(row => !series.some(recorded => recorded.date === row.date))
        const recorded = series.filter(row => row.date >= RECORDED_DATA_START || !presentationSeries.some(placeholder => placeholder.date === row.date))
        return <g key={field} aria-label={bp ? index ? t("Diastolic") : t("Systolic") : name}>{plotGroup(placeholders, field, color, true)}{plotGroup(recorded, field, color)}</g>
      })}
      {[...new Set(plotRows.map(row => row.date))].map(date => <text key={date} x={x({ date })} y="165" textAnchor="middle" fontSize="8">{date.slice(5)}</text>)}
    </svg>
    <div className="patient-trend-legend" aria-label={t("Chart legend")}>
      {bp ? <><span><i className="is-systolic" />Systolic ({unit})</span><span><i className="is-diastolic" />Diastolic ({unit})</span></> : <span><i className="is-systolic" />{name} ({unit})</span>}
      {presentationSeries.length > 0 && <><span><i className="is-placeholder" />{t("Placeholder")}</span><span><i className="is-recorded" />{t("Recorded")}</span></>}
    </div>
    {presentationSeries.length > 0 && <p className="patient-trend-presentation-note">{t("Recorded monitoring data begins Oct 12. Earlier points are shown only as presentation placeholders.")}</p>}
    <div className="patient-trend-table"><table><caption>{t("Recorded")} {name.toLowerCase()} readings ({unit})</caption><thead><tr><th scope="col">{t("Scheduled date")}</th><th scope="col">{t("Recorded time")}</th>{fields.map((field, index) => <th key={field} scope="col">{bp ? index ? t("Diastolic") : t("Systolic") : t("Value")}</th>)}</tr></thead><tbody>{series.map((row, index) => <tr key={index}><td>{row.date}</td><td>{readingTime(row)}</td>{fields.map(field => <td key={field}>{row[field]}</td>)}</tr>)}</tbody></table></div>
  </>
}
export function VitalTrendChart({ rows, config }) {
  const t = useDashboardTranslation()
  const values = rows.flatMap(row => config.fields.map(field => Number(row[field])))
  const low = Math.min(...values), high = Math.max(...values)
  const start = Date.parse(rows[0].recordedAt), end = Date.parse(rows.at(-1).recordedAt)
  const x = row => 40 + (Date.parse(row.recordedAt) - start) / (end - start || 1) * 400
  const y = value => 140 - (Number(value) - low) / (high - low || 1) * 110
  return <>
    <svg className="patient-trend-chart" viewBox="0 0 480 175" role="img" aria-label={t('Recorded {name} readings in {unit}; details in the table below', { name: t(config.name), unit: config.unit })}>
      <text x="0" y="24">{high}</text><text x="0" y="144">{low}</text>
      {config.fields.map((field, index) => <g key={field}><polyline fill="none" stroke={index ? 'var(--navy)' : 'var(--primary)'} strokeWidth="2" strokeDasharray={index ? '5 3' : undefined} points={rows.map(row => `${x(row)},${y(row[field])}`).join(' ')} />{rows.map(row => <circle key={row.id} cx={x(row)} cy={y(row[field])} r="3" fill={index ? 'var(--navy)' : 'var(--primary)'} />)}</g>)}
    </svg>
    {config.fields.length > 1 && <p>{t('Systolic: solid blue · Diastolic: dashed navy')}</p>}
    <div className="patient-trend-table"><table><caption>{t('Recorded {name} readings ({unit})', { name: t(config.name).toLowerCase(), unit: config.unit })}</caption><thead><tr><th scope="col">{t('Recorded time')}</th><th scope="col">{t(config.fields.length > 1 ? 'Value (systolic/diastolic)' : 'Value')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><RecordedTime value={row.recordedAt} /></td><td>{config.fields.map(field => row[field]).join('/')}</td></tr>)}</tbody></table></div>
  </>
}

