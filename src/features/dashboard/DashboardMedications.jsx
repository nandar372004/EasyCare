import { useDashboardTranslation } from './useDashboardTranslation.js'
import { Link } from 'react-router-dom'
import { DashboardSkeleton } from './DashboardSkeleton.jsx'
import { medicationDoseTime } from '../../services/carePlanMedicationService.js'

export function DashboardMedications({ section, summary }) {
  const t = useDashboardTranslation()
  const rows = summary.rows
  return <article className="card patient-health-section" aria-label={t("Today's Medications")}><div className="section-title"><h2>{t("Today's Medications")}</h2></div>
    {section?.status === 'loading' ? <DashboardSkeleton label="Loading medication actions…" /> : section?.status !== 'ready' ? <p className="dashboard-compact-state" role="alert">{t("Medication summary is temporarily unavailable.")}</p>
      : !rows.length ? <p className="dashboard-empty">{t("No medication actions for today.")}</p>
        : <>
          <p>{t('{done} of {total} required doses completed', { done: summary.done, total: summary.required })}{summary.incompleteTracking ? t(" · Tracking unavailable for some medications") : ''}</p>
          <ul className="patient-health-list">{rows.map((row, index) => {
            const time = medicationDoseTime(row)
            const actions = summary.actions.filter(action => action.medication.id === row.medication.id && (row.schedule ? action.schedule?.id === row.schedule.id && action.event?.id === row.event?.id : !action.schedule))
            return <li key={`${row.medication.id}-${row.schedule?.id || 'checkin'}-${row.event?.id || index}`}><strong>{row.medication.name}{row.medication.dosage ? ` · ${row.medication.dosage}` : ''}</strong><span>{row.checkin?.prn ? t("As needed") : row.medication.frequency || t('Frequency not recorded')}</span>
              {row.medication.instructions && <span>{row.medication.instructions}</span>}
              {row.checkin?.prn ? <span className="dashboard-medication-status">{t("As needed")}</span> : <details className="dashboard-medication-details"><summary>{t('{done} of {total} doses done · View details', { done: actions.filter(action => action.completed && action.trackingAvailable).length, total: actions.filter(action => !action.prn && action.trackingAvailable).length || actions.length })}</summary><ul aria-label={t("Today's doses for {name}", { name: row.medication.name })}>{actions.map((action, position) => <li key={position}>
                <span>{action.prn ? t("As needed") : action.occurrenceIndex && row.checkin?.count > 1 ? t('Dose {number}', { number: action.occurrenceIndex }) : row.schedule ? t('Dose {number}', { number: row.occurrenceIndex }) : t("Today")}{time ? ` · ${time}${row.schedule?.timezone ? ` · ${row.schedule.timezone}` : ''}` : ''}</span>
                <span>{action.prn ? t("As needed") : action.readOnly ? row.eligibleForDailyCheckin ? t("No daily occurrence rule") : t("Active") : !action.trackingAvailable ? t("Tracking unavailable") : action.completed ? t("Done") : t("Not done")}</span>
                {row.schedule && row.status !== 'Taken' && <small>{t(row.status)}</small>}
              </li>)}</ul></details>}
            </li>
          })}</ul>
        </>}
    <Link to="/my-care-plan#care-my-medications">{t("View Medications")}</Link>
    {section?.refreshing && <small className="dashboard-refresh-indicator" role="status">{t("Refreshing…")}</small>}
  </article>
}
