import { useEffect, useRef, useState } from 'react'
import { Calendar, CheckCircle2, ChevronRight, Clock, User, Video, Home as HomeIcon, AlertCircle } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.jsx'
import { providerAppointmentService } from '../../services/providerAppointmentService.js'
import { formatMmk, formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { ProviderPageHeader, ProviderTabs, ProviderEmptyState, ProviderStatusBadge } from './components/ProviderSharedComponents.jsx'

const statuses = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
}

const modes = {
  video: 'Video consultation',
  voice: 'Voice call',
  home_visit: 'Home visit',
}

export function ProviderAppointmentsPage() {
  const { provider, providerSetup } = useAuth()
  const activeProvider = provider || providerSetup
  if (activeProvider?.type && activeProvider.type !== 'doctor') {
    return <section><h1>Appointments</h1><p>Appointment management is available to doctor accounts only.</p></section>
  }
  return <ProviderAppointmentsContent key={activeProvider?.id ?? 'none'} enabled={Boolean(activeProvider?.id)} />
}

function ProviderAppointmentsContent({ enabled }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [reload, setReload] = useState(0)

  const generation = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    const request = ++generation.current
    setRows([])
    setSelected(null)
    setLoading(true)
    setError('')
    if (!enabled) {
      setLoading(false)
      return undefined
    }

    providerAppointmentService
      .list()
      .then(data => {
        if (request === generation.current) {
          setRows(data)
          // If there are pending appointments, default tab can stay all or pending,
          // but having all or keeping pending works smoothly.
        }
      })
      .catch(() => {
        if (request === generation.current) setError('Unable to load your appointments. Please try again.')
      })
      .finally(() => {
        if (request === generation.current) setLoading(false)
      })

    return () => {
      generation.current++
    }
  }, [enabled, reload])

  async function transition(id, status) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const request = generation.current
    try {
      await providerAppointmentService.transition(id, status)
      // Lifecycle actions never optimistically change an appointment. Keep the
      // row disabled until the server's canonical read confirms its new state.
      const canonicalRows = await providerAppointmentService.list()
      if (request === generation.current) setRows(canonicalRows)
    } catch (failure) {
      // An uncertain outcome must be re-read before another write is offered.
      if (request === generation.current) {
        setError(failure.message)
        setRows([])
        setSelected(null)
      }
    } finally {
      inFlight.current = false
      if (request === generation.current) setBusy(false)
    }
  }

  // Filter rows by tabs:
  // Prompt requirement: Add clear tabs: Pending, Confirmed, History, No-show
  const pendingRows = rows.filter(r => r.status === 'pending')
  const confirmedRows = rows.filter(r => r.status === 'confirmed')
  const historyRows = rows.filter(r => ['completed', 'cancelled', 'rescheduled'].includes(r.status))
  const noShowRows = rows.filter(r => r.status === 'no_show')

  const tabCounts = {
    pending: pendingRows.length,
    confirmed: confirmedRows.length,
    history: historyRows.length,
    no_show: noShowRows.length,
  }

  const tabs = [
    { id: 'pending', label: 'Pending', count: tabCounts.pending },
    { id: 'confirmed', label: 'Confirmed', count: tabCounts.confirmed },
    { id: 'history', label: 'History', count: tabCounts.history },
    { id: 'no_show', label: 'No-show', count: tabCounts.no_show },
  ]

  // When activeTab is 'all', show all rows; otherwise filter by specific tab.
  // If activeTab is set to a tab with 0 rows, but another tab has rows on initial load,
  // we can let users switch freely.
  const activeRows =
    activeTab === 'all'
      ? rows
      : activeTab === 'pending'
      ? pendingRows
      : activeTab === 'confirmed'
      ? confirmedRows
      : activeTab === 'history'
      ? historyRows
      : noShowRows

  return (
    <section className="provider-appointments-section" aria-label="Appointments Management">
      <ProviderPageHeader
        eyebrow="Clinical Workspace"
        title="Appointments"
        description="Review appointments assigned to you."
      />

      <div className="provider-appointments-tabs-bar">
        <ProviderTabs
          tabs={[
            { id: 'all', label: 'All', count: rows.length },
            ...tabs,
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {loading && <p role="status">Loading your appointments…</p>}

      {error && (
        <div className="card provider-empty-state-card" role="alert">
          <p>{error}</p>
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => setReload(value => value + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && !rows.length && (
        <p>No appointments assigned to you.</p>
      )}

      {!loading && !error && rows.length > 0 && activeRows.length === 0 && (
        <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
          <ProviderEmptyState
            title={`No ${tabs.find(t => t.id === activeTab)?.label || ''} Appointments`}
            description="There are currently no appointments under the selected view."
          />
        </div>
      )}

      {!loading && !error && activeRows.length > 0 && (
        <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="provider-patient-list provider-appointments-list">
          {activeRows.map(row => {
            const isSelected = selected === row.id
            return (
              <article className={`card provider-appointment-card${isSelected ? ' is-selected' : ''}`} key={row.id}>
                <div className="provider-appointment-card-head">
                  <div>
                    <h2>{row.patient_display_name || 'Patient'}</h2>
                    <p className="appointment-datetime-meta">
                      {formatPresentationDateTime(row.scheduled_start)} – {formatPresentationDateTime(row.scheduled_end)}
                    </p>
                    <p className="appointment-channel-meta">
                      {modes[row.consultation_channel] || 'Consultation'} · {statuses[row.status] || 'Unknown status'}
                    </p>
                    <p className="appointment-reference-meta">Reference: {row.booking_code}</p>
                  </div>
                  <ProviderStatusBadge status={row.status} label={statuses[row.status]} />
                </div>

                <div className="provider-appointment-card-actions">
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected(row.id)}
                  >
                    Open appointment
                  </button>
                </div>

                {isSelected && (
                  <div className="provider-appointment-details-expanded">
                    <p>
                      Fee:{' '}
                      {row.currency?.trim() === 'MMK' && Number.isInteger(Number(row.fee_amount))
                        ? formatMmk(Number(row.fee_amount))
                        : `${row.fee_amount} ${row.currency}`}
                    </p>
                    {row.reason_symptoms && (
                      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        Reason / symptoms: {row.reason_symptoms}
                      </p>
                    )}

                    {row.status === 'pending' && (
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void transition(row.id, 'confirmed')}
                      >
                        Confirm
                      </button>
                    )}

                    {row.status === 'confirmed' && (
                      <div className="provider-header-actions">
                        <button
                          className="button button--primary"
                          type="button"
                          disabled={busy}
                          onClick={() => void transition(row.id, 'completed')}
                        >
                          Mark Completed
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => void transition(row.id, 'no_show')}
                        >
                          Mark No-show
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
