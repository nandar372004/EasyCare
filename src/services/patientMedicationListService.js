import { presentationRepository } from './repositories/index.js'
import { getMyReportedHealthIntake } from './patientReportedHealthService.js'
import { visibleMedicationRecords } from './medicationVisibility.js'

// The Medications tab's existing combined contract, shared with Dashboard.
export async function loadPatientMedicationList(patientId, repository = presentationRepository, reportedLoader = getMyReportedHealthIntake) {
  if (repository.metadata.isSynthetic) return visibleMedicationRecords(await repository.listMedications(patientId))
  const [clinical, reported] = await Promise.all([repository.listMedications(patientId), reportedLoader()])
  const reportedMedications = (reported.items || []).filter(item => item.itemType === 'medication' && item.entryKind === 'item' && item.source === 'patient_reported').map(item => ({
    id: `reported:${item.id}`, name: item.name, dosage: item.details?.dose || '', frequency: item.details?.frequency || '',
    instructions: '', reasonForMedication: item.details?.reason || '', status: 'active', source: 'Patient-reported', isPatientReported: true,
  }))
  return visibleMedicationRecords([...clinical, ...reportedMedications])
}
export const activePatientMedications = records => records.filter(item => item.status === 'active')
