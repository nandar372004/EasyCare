import { useEffect, useRef, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, CalendarDays, ClipboardList, HeartPulse, Pill, Search, Stethoscope, Video, X } from 'lucide-react'
import { presentationRepository } from '../services/repositories/index.js'
import { useAuth } from '../features/auth/AuthContext.jsx'

const PAGES = [
  { to: '/doctors', label: 'Doctors', icon: Stethoscope, description: 'Find and consult with doctors' },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays, description: 'View and manage appointments' },
  { to: '/care-plan', label: 'Care Plan', icon: ClipboardList, description: 'Manage your healthcare plan' },
  { to: '/health-guardian', label: 'AI Health Guardian', icon: Bot, description: 'AI-assisted health guidance' },
  { to: '/health-records', label: 'Health Records', icon: HeartPulse, description: 'View health records' },
  { to: '/prescriptions', label: 'Prescriptions', icon: ClipboardList, description: 'View prescriptions' },
  { to: '/medications', label: 'Medications', icon: Pill, description: 'View medications' },
]

const MAX_RESULTS = 8

export function GlobalSearch() {
  const { patient } = useAuth()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [doctors, setDoctors] = useState([])
  const [appointments, setAppointments] = useState([])
  const [medications, setMedications] = useState([])
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    if (!patient?.id) { setMedications([]); return undefined }
    setLoading(true)
    Promise.all([
      presentationRepository.listDoctors(),
      presentationRepository.listAppointments(),
      presentationRepository.listMedications(patient.id),
    ])
      .then(([doctorsData, appointmentsData, medicationsData]) => {
        if (!cancelled) {
          setDoctors(doctorsData)
          setAppointments(appointmentsData)
          setMedications(medicationsData)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [patient?.id])

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    const matched = []

    for (const doctor of doctors) {
      const nameMatch = doctor.displayName?.toLowerCase().includes(q)
      const specialtyMatch = doctor.specialty?.toLowerCase().includes(q)
      if (nameMatch || specialtyMatch) {
        matched.push({
          type: 'Doctor',
          label: doctor.displayName,
          description: doctor.specialty,
          to: `/doctors/${doctor.id}`,
          icon: Stethoscope,
        })
      }
    }

    for (const appointment of appointments) {
      const doctor = doctors.find((d) => d.id === appointment.doctorId)
      const doctorName = doctor?.displayName?.toLowerCase() ?? ''
      const typeMatch = appointment.consultationType?.toLowerCase().includes(q)
      const statusMatch = appointment.status?.toLowerCase().includes(q)
      const doctorMatch = doctorName.includes(q)
      if (typeMatch || statusMatch || doctorMatch) {
        matched.push({
          type: 'Appointment',
          label: doctor?.displayName ?? 'Appointment',
          description: `${appointment.consultationType ?? ''} ${appointment.status ?? ''}`.trim() || 'Appointment',
          to: `/appointments/${appointment.id}`,
          icon: CalendarDays,
        })
      }
    }

    for (const medication of medications) {
      if (medication.name?.toLowerCase().includes(q)) {
        matched.push({
          type: 'Medication',
          label: medication.name,
          description: medication.status === 'active' ? 'Active' : medication.status,
          to: '/medications',
          icon: Pill,
        })
      }
    }

    for (const page of PAGES) {
      if (page.label.toLowerCase().includes(q) || page.description.toLowerCase().includes(q)) {
        matched.push({
          type: 'Page',
          label: page.label,
          description: page.description,
          to: page.to,
          icon: page.icon,
        })
      }
    }

    return matched.slice(0, MAX_RESULTS)
  }, [query, doctors, appointments, medications])

  const handleSelect = (to) => {
    setOpen(false)
    setQuery('')
    navigate(to)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="global-search" ref={containerRef}>
      <label className="global-search-input" htmlFor="global-search">
        <Search aria-hidden="true" />
        <input
          id="global-search"
          ref={inputRef}
          type="search"
          placeholder="Search doctors, appointments, medications..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {query && (
          <button type="button" className="global-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
            <X aria-hidden="true" />
          </button>
        )}
      </label>
      {open && (
        <div className="global-search-dropdown" role="listbox">
          {loading && <div className="global-search-status">Loading...</div>}
          {!loading && query.trim() && results.length === 0 && (
            <div className="global-search-empty">
              <strong>No results found</strong>
              <span>Try searching for a doctor, appointment, medication, or feature.</span>
            </div>
          )}
          {!loading && !query.trim() && (
            <div className="global-search-quick">
              <div className="global-search-quick-label">Quick Links</div>
              {PAGES.slice(0, 5).map((page) => (
                <button type="button" key={page.to} className="global-search-result" onClick={() => handleSelect(page.to)}>
                  <span className="global-search-result-icon"><page.icon aria-hidden="true" /></span>
                  <div>
                    <strong>{page.label}</strong>
                    <span>{page.description}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!loading && results.length > 0 && (
            <div className="global-search-results">
              {results.map((item, idx) => (
                <button type="button" key={`${item.type}-${item.to}-${idx}`} className="global-search-result" onClick={() => handleSelect(item.to)}>
                  <span className="global-search-result-icon"><item.icon aria-hidden="true" /></span>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </div>
                  <span className="global-search-result-type">{item.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
