import { supabase } from '../lib/supabase.js'
import { createPatientDashboardRepository } from './repositories/patientDashboardRepository.js'

// Intentionally uses the real client, never the presentation fixture fallback.
export function createPatientDashboardService(repository) {
  const methods=['getPatientDashboard','getLatestVitals','getVitalHistory','getTodayMedications','getMedicationDashboardData','getTodayMedicationCheckIns','recordPatientMedicationCheckIn','getNextAppointment','getDashboardAppointmentProvider','getUpcomingAppointments','getCarePlanConditions','getActiveMedications','getActiveAlerts','getRecentHealthRecords','getRecentLabResults','getLatestAIHealthSummary']
  return Object.fromEntries(methods.map(name=>[name,(...args)=>repository[name](...args)]))
}
let service
const current = () => service ??= createPatientDashboardService(createPatientDashboardRepository(supabase))
export const getPatientDashboard = (...args) => current().getPatientDashboard(...args)
export const getLatestVitals = (...args) => current().getLatestVitals(...args)
export const getVitalHistory = (...args) => current().getVitalHistory(...args)
export const getTodayMedications = (...args) => current().getTodayMedications(...args)
export const getMedicationDashboardData = (...args) => current().getMedicationDashboardData(...args)
export const getTodayMedicationCheckIns = (...args) => current().getTodayMedicationCheckIns(...args)
export const recordPatientMedicationCheckIn = (...args) => current().recordPatientMedicationCheckIn(...args)
export const getNextAppointment = (...args) => current().getNextAppointment(...args)
export const getUpcomingAppointments = (...args) => current().getUpcomingAppointments(...args)
export const getDashboardAppointmentProvider = (...args) => current().getDashboardAppointmentProvider(...args)
export const getCarePlanConditions = (...args) => current().getCarePlanConditions(...args)
export const getActiveMedications = (...args) => current().getActiveMedications(...args)
export const getActiveAlerts = (...args) => current().getActiveAlerts(...args)
export const getRecentHealthRecords = (...args) => current().getRecentHealthRecords(...args)
export const getRecentLabResults = (...args) => current().getRecentLabResults(...args)
export const getLatestAIHealthSummary = (...args) => current().getLatestAIHealthSummary(...args)

export async function recordMedicationEventStatus(eventId, status = 'taken') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId || '') || !['taken', 'skipped'].includes(status)) {
    throw new TypeError('A valid medication event and status are required.')
  }
  if (!supabase) throw new Error('Medication adherence is unavailable.')
  const { data, error } = await supabase.rpc('record_medication_event_status', { target_event_id: eventId, new_status: status })
  if (error || !data) throw new Error('Medication status could not be updated.')
  return data
}
