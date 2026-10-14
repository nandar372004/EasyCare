import { useEffect, useState } from 'react'
import { Calendar, Clock, Plus, Trash2, Video, Home as HomeIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext.jsx'
import { providerAvailabilityService } from '../../services/providerAvailabilityService.js'
import { formatPresentationDateTime } from '../../lib/presentationFormatting.js'
import { ProviderPageHeader, ProviderEmptyState, ProviderStatusBadge } from './components/ProviderSharedComponents.jsx'

export function ProviderAvailabilityPage() {
  const { provider, providerSetup } = useAuth()
  const activeProvider = provider || providerSetup
  const doctorId = activeProvider?.id
  const isDoctor = activeProvider?.type === 'doctor'

  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // New slot form state
  const [showAddModal, setShowAddModal] = useState(false)
  const [slotDate, setSlotDate] = useState('')
  const [slotStartTime, setSlotStartTime] = useState('09:00')
  const [slotDurationMinutes, setSlotDurationMinutes] = useState('30')
  const [serviceType, setServiceType] = useState('teleconsultation')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setActionError('')
    if (!doctorId || !isDoctor) {
      setLoading(false)
      return
    }

    providerAvailabilityService
      .listMySlots(doctorId)
      .then(data => {
        if (active) setSlots(data)
      })
      .catch(err => {
        if (active) setError(err.message || 'Unable to load availability slots.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [doctorId, isDoctor, reloadKey])

  async function handleAddSlot(e) {
    e.preventDefault()
    if (!slotDate || !slotStartTime) return
    setBusy(true)
    setActionError('')

    try {
      const startIso = new Date(`${slotDate}T${slotStartTime}:00`).toISOString()
      const endTimestamp = new Date(`${slotDate}T${slotStartTime}:00`).getTime() + Number(slotDurationMinutes) * 60 * 1000
      const endIso = new Date(endTimestamp).toISOString()

      await providerAvailabilityService.addSlot({
        doctorId,
        serviceType,
        startsAt: startIso,
        endsAt: endIso,
      })

      setShowAddModal(false)
      setReloadKey(k => k + 1)
    } catch (err) {
      setActionError(err.message || 'Failed to add availability slot.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveSlot(slotId) {
    if (!confirm('Are you sure you want to remove this available slot?')) return
    setBusy(true)
    setActionError('')

    try {
      await providerAvailabilityService.removeAvailableSlot(slotId)
      setReloadKey(k => k + 1)
    } catch (err) {
      setActionError(err.message || 'Failed to remove slot.')
    } finally {
      setBusy(false)
    }
  }

  const availableCount = slots.filter(s => s.status === 'available').length
  const bookedCount = slots.filter(s => s.status === 'booked').length
  const heldCount = slots.filter(s => s.status === 'held').length
  const unavailableCount = slots.filter(s => s.status === 'unavailable').length

  return (
    <section className="provider-availability-page" aria-label="Availability Management">
      {!isDoctor ? <ProviderEmptyState title="Availability is for doctors" description="This scheduling workspace is available to doctor accounts only." /> : <>
      <ProviderPageHeader
        eyebrow="Clinical Schedule"
        title="Availability Management"
        description="Configure your bookable appointment slots for teleconsultations and home visits."
        actions={
          <button
            className="button button--primary"
            type="button"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add Slot</span>
          </button>
        }
      />

      <div className="provider-stat-grid availability-metrics">
        <div className="card provider-stat-mini">
          <span className="stat-label">Available</span>
          <strong className="stat-num color-emerald">{availableCount}</strong>
        </div>
        <div className="card provider-stat-mini">
          <span className="stat-label">Booked</span>
          <strong className="stat-num color-indigo">{bookedCount}</strong>
        </div>
        <div className="card provider-stat-mini">
          <span className="stat-label">Held</span>
          <strong className="stat-num color-amber">{heldCount}</strong>
        </div>
        <div className="card provider-stat-mini">
          <span className="stat-label">Unavailable</span>
          <strong className="stat-num color-slate">{unavailableCount}</strong>
        </div>
      </div>

      {actionError && (
        <div className="card provider-alert-box error" role="alert">
          <p>{actionError}</p>
        </div>
      )}

      {loading && <p role="status">Loading your availability schedule…</p>}

      {error && (
        <div className="card provider-empty-state-card" role="alert">
          <h2>Schedule Unavailable</h2>
          <p>{error}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setReloadKey(k => k + 1)}
          >
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <ProviderEmptyState
          title="No Availability Slots"
          description="You haven't added any schedule slots yet. Add slots so patients can book appointments with you."
          action={
            <button
              className="button button--primary"
              type="button"
              onClick={() => setShowAddModal(true)}
            >
              Add First Slot
            </button>
          }
        />
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="provider-slots-table-card card">
          <div className="provider-table-wrapper">
            <table className="provider-data-table" aria-label="Upcoming schedule slots">
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>Service Mode</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr key={slot.id} className={`slot-row status-${slot.status}`}>
                    <td>
                      <div className="slot-time-cell">
                        <Clock size={16} aria-hidden="true" className="muted-icon" />
                        <div>
                          <strong>{formatPresentationDateTime(slot.startsAt)}</strong>
                          <span className="sub-time">
                            to {new Date(slot.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="service-mode-chip">
                        {slot.serviceType === 'home_visit' ? (
                          <>
                            <HomeIcon size={14} aria-hidden="true" /> Home Visit
                          </>
                        ) : (
                          <>
                            <Video size={14} aria-hidden="true" /> Teleconsultation
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <ProviderStatusBadge status={slot.status} />
                    </td>
                    <td className="text-right">
                      {slot.status === 'available' ? (
                        <button
                          type="button"
                          className="button button--ghost danger-hover"
                          title="Remove this available slot"
                          disabled={busy}
                          onClick={() => handleRemoveSlot(slot.id)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                          <span className="sr-only">Remove slot</span>
                        </button>
                      ) : (
                        <span className="text-muted text-sm">Protected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="provider-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-add-slot-title">
          <div className="card provider-modal-card">
            <h2 id="modal-add-slot-title">Add Availability Slot</h2>
            <p>Define an open consultation slot for patients to schedule.</p>

            <form onSubmit={handleAddSlot} className="provider-modal-form">
              <label>
                Date
                <input
                  type="date"
                  required
                  value={slotDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setSlotDate(e.target.value)}
                />
              </label>

              <div className="form-row-2">
                <label>
                  Start Time
                  <input
                    type="time"
                    required
                    value={slotStartTime}
                    onChange={e => setSlotStartTime(e.target.value)}
                  />
                </label>

                <label>
                  Duration
                  <select
                    value={slotDurationMinutes}
                    onChange={e => setSlotDurationMinutes(e.target.value)}
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                  </select>
                </label>
              </div>

              <label>
                Consultation Mode
                <select
                  value={serviceType}
                  onChange={e => setServiceType(e.target.value)}
                >
                  <option value="teleconsultation">Teleconsultation (Video/Audio)</option>
                  <option value="home_visit">Home Visit</option>
                </select>
              </label>

              <div className="provider-modal-actions">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={busy || !slotDate}
                >
                  {busy ? 'Saving…' : 'Add Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </>}
    </section>
  )
}
