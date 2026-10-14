import { loadCarePlanMedications } from './carePlanMedicationService.js'
import { supabase } from '../lib/supabase.js'
import { createPatientDashboardRepository } from './repositories/patientDashboardRepository.js'

export function createDashboardPageTasks(patientId, repository, medicationLoader = loadCarePlanMedications, { patient, appointmentLoader, alertsLoader, medicationTask } = {}) {
  const repo = repository ?? createPatientDashboardRepository(supabase)
  const tasks = {
    // AuthContext already resolved this identity. The removed overview/vital
    // cards have no consumers; recent-update data below remains connected.
    ...(patient ? { overview: async () => ({ profile: { fullName: patient.full_name } }) } : {
      overview: () => repo.getDashboardOverview(patientId), vitals: () => repo.getLatestVitals(patientId),
    }),
    alerts: alertsLoader || (() => repo.getActiveAlerts(patientId)),
    records: () => repo.getRecentHealthRecords(patientId),
    labs: () => repo.getRecentLabResults(patientId),
    prescriptions: () => repo.getRecentPrescriptions(patientId),
    appointment: appointmentLoader || (async () => {
      const next = await repo.getNextAppointment(patientId)
      if (!next) return { next: null, doctor: null }
      try { return { next, doctor: await repo.getDashboardAppointmentProvider(next.providerId) } }
      catch { return { next, doctor: null, providerError: true } }
    }),
    medications: medicationTask || (() => medicationLoader(patientId)),
  }
  return patient ? Object.fromEntries(['overview', 'medications', 'appointment', 'alerts', 'records', 'labs', 'prescriptions'].map(name => [name, tasks[name]])) : tasks
}

// Retained for existing consumers. Dashboard observes the same tasks separately.
export async function loadDashboardPage(patientId, repository, onSection, medicationLoader = loadCarePlanMedications) {
  const tasks = createDashboardPageTasks(patientId, repository, medicationLoader)
  const results = {}
  await Promise.allSettled(Object.entries(tasks).map(async ([name, task]) => {
    try { results[name] = { status: 'ready', data: await task() } }
    catch { results[name] = { status: 'error', data: null } }
    onSection?.(name, results[name])
  }))
  return results
}
