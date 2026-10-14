const SYNTHETIC_MEDICATION_MARKER = /\bsynthetic(?:\s+record\b|\s*:)|\bdemo\s+record\b/i

export function isSyntheticMedicationRecord(medication) {
  if (!medication || typeof medication !== 'object') return false
  if (medication.isSynthetic === true || medication.is_synthetic === true) return true

  const metadata = [
    medication.medication_name,
    medication.name,
    medication.dose,
    medication.dosage,
    medication.frequency,
    medication.instructions,
    medication.displayMetadata,
    medication.display_metadata,
    medication.reasonForMedication,
    medication.reason_for_medication,
    medication.source,
  ]

  return metadata.some(value => typeof value === 'string' && SYNTHETIC_MEDICATION_MARKER.test(value))
}

export function visibleMedicationRecords(records) {
  return (records || []).filter(record => !isSyntheticMedicationRecord(record))
}
