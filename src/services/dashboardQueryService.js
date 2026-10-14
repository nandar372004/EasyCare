import { carePlanMedicationQueryKey, loadCarePlanClinicalSource, loadCarePlanMedications } from './carePlanMedicationService.js'
import { presentationRepository } from './repositories/index.js'
import { supabase } from '../lib/supabase.js'
import { createPatientDashboardRepository } from './repositories/patientDashboardRepository.js'
import { createFamilyHealthRepository } from './repositories/familyHealthRepository.js'
import { createDashboardPageTasks } from './dashboardPageService.js'

export const DASHBOARD_STALE_MS = 30_000
export const dashboardKey = (viewerId, patientId, day, resource) => ['patient-dashboard', viewerId || patientId, patientId, day, resource]
export async function measureDashboardLoad(resource, load) {
  if (!import.meta.env.DEV || typeof globalThis.performance?.measure !== 'function') return load()
  const started = performance.now()
  try { return await load() }
  finally {
    const label = `easycare:dashboard:${resource}`
    performance.clearMeasures(label)
    performance.measure(label, { start: started, end: performance.now() })
  }
}
const rawSchedule = row => ({ id: row.id, time_of_day: row.timeOfDay, days_of_week: row.daysOfWeek, timezone: row.timezone, valid_from: row.validFrom, valid_until: row.validUntil })

export function projectFamilyOwnMedications(rows, originalRecords) {
  // Match the command-center's existing clinical-only, active, latest 20 list.
  const clinical = originalRecords ? originalRecords.map(row => ({ id: row.id, name: row.medication_name,
    dosage: row.dose, instructions: row.instructions, status: row.status, startDate: row.start_date, endDate: row.end_date,
    schedules: (row.medication_schedules || []).map(schedule => ({ id: schedule.id, timeOfDay: schedule.time_of_day,
      daysOfWeek: schedule.days_of_week, timezone: schedule.timezone, validFrom: schedule.valid_from, validUntil: schedule.valid_until })) })) : rows
  return clinical.filter(row => row.status === 'active').slice().sort((a, b) => {
    if (!a.startDate && b.startDate) return -1
    if (a.startDate && !b.startDate) return 1
    return String(b.startDate || '').localeCompare(String(a.startDate || ''))
  }).slice(0, 20).map(row => ({ id: row.id, medication_name: row.name, dose: row.dosage,
    instructions: row.instructions, start_date: row.startDate, end_date: row.endDate, status: row.status,
    medication_schedules: (row.schedules || []).map(rawSchedule) }))
}
export function projectFamilyOwnAlerts(rows) {
  return rows.slice(0, 10).map(row => ({ id: row.id, alert_type: row.alertType, severity: row.severity, status: row.status,
    title: row.title, message: row.message, detected_at: row.detectedAt, created_at: row.createdAt }))
}

export function createDashboardQueryResources({ queryClient, patient, viewerId, day, repository, familyRepository, medicationRepository = presentationRepository }) {
  const repo = repository || createPatientDashboardRepository(supabase)
  const familyRepo = familyRepository || createFamilyHealthRepository(supabase)
  const key = resource => resource === 'medications' ? carePlanMedicationQueryKey(viewerId, patient.id, day) : dashboardKey(viewerId, patient.id, day, resource)
  const cached = (resource, queryFn) => queryClient.fetchQuery({ queryKey: key(resource), queryFn: () => measureDashboardLoad(resource, queryFn),
    staleTime: DASHBOARD_STALE_MS, gcTime: 5 * 60_000, retry: false })
  const clinicalSource = () => loadCarePlanClinicalSource(patient.id, { queryClient, viewerId, today: day, repository: medicationRepository })
  const clinical = async () => (await clinicalSource()).records
  const commandAppointments = () => cached('command-appointments', () => familyRepo.getCommandAppointments(patient.id, new Date(), { includeDashboardFields: true }))
  const alerts = () => cached('alerts-source', () => repo.getActiveAlerts(patient.id))
  const medications = () => loadCarePlanMedications(patient.id, { repository: medicationRepository, clinicalLoader: clinical,
    todayLoader: (id, active) => repo.getTodayMedications(id, active), checkInsLoader: id => repo.getTodayMedicationCheckIns(id) })
  const appointment = async () => {
    const rows = await commandAppointments()
    const next = rows.filter(row => ['pending','confirmed'].includes(row.status) && Date.parse(row.scheduledStart) >= Date.now())
      .sort((a,b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) || a.id.localeCompare(b.id))[0] || null
    if (!next) return { next: null, doctor: null }
    try { return { next, doctor: await repo.getDashboardAppointmentProvider(next.providerId) } }
    catch { return { next, doctor: null, providerError: true } }
  }
  return {
    key,
    tasks: createDashboardPageTasks(patient.id, repo, undefined, { patient, appointmentLoader: appointment, alertsLoader: alerts, medicationTask: medications }),
    sharedOwnSections: { appointments: commandAppointments, medications: async () => {
      const { records, originalRecords } = await clinicalSource()
      return projectFamilyOwnMedications(records, originalRecords)
    }, alerts: async () => projectFamilyOwnAlerts(await alerts()) },
  }
}
