import { presentationRepository } from './repositories/index.js'
import { getTodayMedications, getTodayMedicationCheckIns } from './patientDashboardService.js'
import { getMyReportedHealthIntake } from './patientReportedHealthService.js'
import { visibleMedicationRecords } from './medicationVisibility.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const carePlanMedicationQueryKey = (viewerId, patientId, today) => ['my-care-plan', viewerId || patientId, patientId, today, 'medications']
export function loadCarePlanClinicalSource(patientId, { queryClient, viewerId, today, repository = presentationRepository }) {
  return queryClient.fetchQuery({ queryKey: ['my-care-plan', viewerId || patientId, patientId, today, 'clinical-medications-source'],
    staleTime: 30_000, gcTime: 5 * 60_000, retry: false, queryFn: async () => {
      let originalRecords
      const records = await repository.listMedications(patientId, { onRecords: rows => { originalRecords = rows } })
      return { records, originalRecords }
    } })
}
export const dailyMedicationOccurrenceCount = frequency => {
  const value = String(frequency || '').trim().toLowerCase()
  if (/\b(as needed|prn)\b/.test(value)) return null
  if (/\b(twice daily|2 times daily|2x daily)\b/.test(value)) return 2
  if (/\b(three times daily|3 times daily|3x daily)\b/.test(value)) return 3
  if (/\b(once daily|once a day|daily)\b/.test(value)) return 1
  return null
}
export const isMedicationAsNeeded = frequency => /\b(as needed|prn)\b/i.test(String(frequency || ''))
export const eligibleForMedicationCheckin = medication => !medication.schedules?.length && !medication.isPatientReported && UUID.test(medication.id || '')
export function medicationDoseTime({ schedule, event }) {
  const timezone = schedule?.timezone || 'Asia/Yangon'
  if (event?.scheduledAt && Number.isFinite(Date.parse(event.scheduledAt))) {
    return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(event.scheduledAt))
  }
  const match = String(schedule?.timeOfDay || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1]); const minute = match[2]
  if (hour > 23 || Number(minute) > 59) return null
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}
export const medicationDoseStatus = (event, schedule, now = new Date()) => {
  if (event?.status === 'taken') return 'Taken'
  if (event?.status === 'missed') return 'Missed'
  if (event?.status === 'skipped') return 'Skipped'
  if (event?.scheduledAt && Date.parse(event.scheduledAt) > +now) return 'Upcoming'
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: schedule?.timezone || 'Asia/Yangon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  if (!event && schedule?.timeOfDay && schedule.timeOfDay.slice(0, 5) > clock) return 'Upcoming'
  return 'Not taken yet'
}

// Extracted from My Care Plan's My Medications loader, including its optional
// enrichment failure behavior. The standalone tab's combined loader is unused.
export async function loadCarePlanMedications(patientId, {
  repository = presentationRepository,
  clinicalLoader = id => repository.listMedications(id),
  todayLoader = (id, clinical) => getTodayMedications(id, clinical),
  checkInsLoader = getTodayMedicationCheckIns,
  reportedLoader = getMyReportedHealthIntake,
} = {}) {
  const clinical = visibleMedicationRecords(await clinicalLoader(patientId))
  if (repository.metadata.isSynthetic) return { medications: clinical.filter(item => item.status === 'active').map(item => ({ ...item, todaySchedules: [] })), checkIns: [], checkInsAvailable: false }
  const active = clinical.filter(item => item.status === 'active')
  const [today, checkIns, reported] = await Promise.all([
    todayLoader(patientId, active).catch(() => []),
    checkInsLoader(patientId).then(rows => ({ rows, available: true })).catch(() => ({ rows: [], available: false })),
    reportedLoader().catch(() => ({ items: [] })),
  ])
  const patientReported = (reported.items || []).filter(item => item.itemType === 'medication' && item.entryKind === 'item' && item.source === 'patient_reported').map(item => ({
    id: `reported:${item.id}`, patientId, name: item.name, dosage: item.details?.dose || '', frequency: item.details?.frequency || '',
    status: 'active', isPatientReported: true, schedules: [],
  }))
  return { medications: visibleMedicationRecords([...clinical, ...patientReported]).filter(item => item.status === 'active').map(item => ({ ...item, todaySchedules: today.filter(row => row.medication.id === item.id) })),
    checkIns: checkIns.rows, checkInsAvailable: checkIns.available }
}

export function medicationCheckinOccurrences(medication, checkIns = []) {
  const count = dailyMedicationOccurrenceCount(medication.frequency)
  const prn = isMedicationAsNeeded(medication.frequency)
  const entries = checkIns.filter(row => row.patientMedicationId === medication.id && Boolean(row.isPrn) === prn)
  const done = new Set(entries.map(row => row.occurrenceIndex))
  const indexes = prn ? [null] : count ? Array.from({ length: count }, (_, index) => index + 1) : []
  return { count, prn, entries, occurrences: indexes.map(index => ({ index, completed: index === null ? done.size > 0 : done.has(index) })) }
}
export function buildCarePlanMedicationRows(data = {}, now = new Date()) {
  return (data.medications || []).flatMap(medication => {
    if (!medication.todaySchedules?.length) return [{ medication, schedule: null, event: null, status: null, sortStatus: 3, time: '99:99',
      eligibleForDailyCheckin: eligibleForMedicationCheckin(medication), checkin: medicationCheckinOccurrences(medication, data.checkIns) }]
    let occurrenceIndex = 0
    return medication.todaySchedules.flatMap(({ schedule, events }) => (events.length ? events : [null]).map(event => {
      const status = medicationDoseStatus(event, schedule, now)
      return { medication, schedule, event, status, occurrenceIndex: ++occurrenceIndex, sortStatus: ({ Missed: 0, Upcoming: 2, 'Not taken yet': 3, Skipped: 3, Taken: 4 })[status] ?? 3, time: schedule.timeOfDay || '99:99', eligibleForDailyCheckin: false }
    }))
  }).sort((a,b) => a.sortStatus - b.sortStatus || a.time.localeCompare(b.time))
}
export function summarizeCarePlanMedicationActions(data = {}, now = new Date()) {
  const rows = buildCarePlanMedicationRows(data, now)
  const actions = rows.flatMap(row => {
    const prn = isMedicationAsNeeded(row.medication.frequency)
    if (row.schedule) return [{ ...row, prn, required: !prn, completed: row.event?.status === 'taken', trackingAvailable: true }]
    if (!row.eligibleForDailyCheckin) return [{ ...row, prn, required: false, completed: false, trackingAvailable: false, readOnly: true }]
    if (!row.checkin.occurrences.length) return [{ ...row, prn, required: false, completed: false, trackingAvailable: false, readOnly: true }]
    return row.checkin.occurrences.map(occurrence => ({ ...row, prn, occurrenceIndex: occurrence.index, required: !prn,
      completed: occurrence.completed, trackingAvailable: Boolean(data.checkInsAvailable) }))
  })
  const trackedActions = actions.filter(row => !row.readOnly)
  const trackedRows = rows.filter(row => row.schedule || row.eligibleForDailyCheckin && row.checkin.occurrences.length)
  return { rows: trackedRows, actions: trackedActions, required: actions.filter(row => row.required).length,
    done: actions.filter(row => row.required && row.trackingAvailable && row.completed).length,
    incompleteTracking: actions.some(row => row.required && !row.trackingAvailable) }
}
