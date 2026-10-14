import { createPatientMonitoringRepository } from './repositories/patientMonitoringRepository.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEASUREMENT_UNITS = {
  blood_pressure: ['mmHg'], weight: ['kg', 'lb'], blood_glucose: ['mg/dL', 'mmol/L'],
  heart_rate: ['bpm'], temperature: ['°C', '°F'], custom: null,
}

const numericMeasurement = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0

export function isScheduledOn(plan, date) {
  if (!plan?.isActive || !date || date < plan.startDate || (plan.endDate && date > plan.endDate)) return false
  if (plan.recurrenceType === 'once') return date === plan.startDate
  if (plan.recurrenceType === 'daily') return true
  if (plan.recurrenceType !== 'selected_days') return false
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return (plan.daysOfWeek || []).includes(day)
}

const validateDate = (value, label) => {
  if (!DAY.test(value || '') || Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} is required.`)
  }
}

export function createPatientMonitoringService(repository = createPatientMonitoringRepository()) {
  return {
    listMyPlans: () => repository.listMyPlans(),
    listMyCheckIns: () => repository.listMyCheckIns(),
    saveMyPlan(input) {
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      const recurrenceType = input?.recurrenceType
      const daysOfWeek = [...new Set(input?.daysOfWeek || [])].sort((a, b) => a - b)
      const times = [...new Set(input?.times || [])].sort()
      const measurementType = input?.measurementType || null
      const measurementUnit = input?.measurementUnit || null
      validateDate(input?.startDate, 'A start date')
      if (input.endDate) validateDate(input.endDate, 'A valid end date')
      if (!title || title.length > 200 || (input.relatedContext || '').length > 200 || (input.notes || '').length > 1000) throw new TypeError('Enter a routine title and keep its text within the limits.')
      if (input.endDate && input.endDate < input.startDate) throw new TypeError('End date must be on or after the start date.')
      const invalidDays = recurrenceType === 'selected_days'
        ? daysOfWeek.length === 0 || daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6)
        : daysOfWeek.length > 0
      if (!['daily', 'selected_days', 'once'].includes(recurrenceType) || invalidDays) throw new TypeError(`Choose a valid routine schedule. (${recurrenceType}: ${daysOfWeek.join(',')})`)
      if (times.length > 12 || times.some(time => !CLOCK.test(time))) throw new TypeError('Enter valid times.')
      if (measurementType && !Object.hasOwn(MEASUREMENT_UNITS, measurementType)) throw new TypeError('Choose a supported measurement type.')
      if (measurementType && (!measurementUnit || measurementUnit.length > 40
        || (MEASUREMENT_UNITS[measurementType] && !MEASUREMENT_UNITS[measurementType].includes(measurementUnit)))) throw new TypeError('Choose a unit supported for this measurement.')
      if (!measurementType && measurementUnit) throw new TypeError('Choose a measurement type for this unit.')
      if (input.id && !UUID.test(input.id)) throw new TypeError('Choose a valid routine.')
      return repository.saveMyPlan({ ...input, id: input.id || null, title, daysOfWeek, times, measurementType, measurementUnit })
    },
    deactivateMyPlan(planId) {
      if (!UUID.test(planId || '')) throw new TypeError('Choose a valid routine.')
      return repository.deactivateMyPlan(planId)
    },
    recordMyCheckIn(input) {
      if (!UUID.test(input?.planId || '') || typeof input.localDate !== 'string' || !DAY.test(input.localDate)
        || !(input.occurrenceKey === 'any' || UUID.test(input.occurrenceKey || '')) || typeof input.isDone !== 'boolean') {
        throw new TypeError('Choose a valid routine occurrence.')
      }
      if ((input.measurementValue || '').length > 100 || (input.measurementUnit || '').length > 40 || (input.notes || '').length > 1000) throw new TypeError('Check-in details are too long.')
      return repository.recordMyCheckIn(input)
    },
    recordMyMeasurement(input) {
      if (!UUID.test(input?.planId || '') || typeof input.localDate !== 'string' || !DAY.test(input.localDate)
        || !(input.occurrenceKey === 'any' || UUID.test(input.occurrenceKey || ''))) throw new TypeError('Choose a valid routine occurrence.')
      if (!input.measurementUnit || input.measurementUnit.length > 40 || (input.notes || '').length > 1000) throw new TypeError('Check-in details are invalid.')
      if (input.measurementType === 'blood_pressure') {
        if (!numericMeasurement(input.systolicValue) || !numericMeasurement(input.diastolicValue) || input.measurementValue != null) throw new TypeError('Enter systolic and diastolic values.')
      } else if (!numericMeasurement(input.measurementValue) || input.systolicValue != null || input.diastolicValue != null) {
        throw new TypeError('Enter a numeric measurement value.')
      }
      return repository.recordMyMeasurement(input)
    },
  }
}

export const patientMonitoringService = createPatientMonitoringService()

const toDay = value => new Date(`${value}T12:00:00Z`)
const dayString = value => value.toISOString().slice(0, 10)
const round = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null

/** Descriptive, patient-owned monitoring analysis for later Dashboard Health Trends use. */
export function analyzeMonitoringReadings({ plan, checkIns = [], asOfDate = new Date().toISOString().slice(0, 10) }) {
  if (!plan || !DAY.test(asOfDate)) throw new TypeError('A routine and valid analysis date are required.')
  const end = toDay(asOfDate)
  const start7 = new Date(end); start7.setUTCDate(start7.getUTCDate() - 6)
  const start30 = new Date(end); start30.setUTCDate(start30.getUTCDate() - 29)
  const bloodPressure = plan.measurementType === 'blood_pressure'
  const readings = checkIns.filter(row => row.monitoringPlanId === plan.id && row.status === 'done'
    && DAY.test(row.localDate || '') && row.localDate <= asOfDate
    && (!row.measurementUnit || row.measurementUnit === plan.measurementUnit)
    && (bloodPressure ? numericMeasurement(row.systolicValue) && numericMeasurement(row.diastolicValue)
      : numericMeasurement(row.measurementValue) && row.systolicValue == null && row.diastolicValue == null))
    .map(row => ({ ...row, value: row.measurementValue == null ? null : Number(row.measurementValue),
      systolicValue: row.systolicValue == null ? null : Number(row.systolicValue),
      diastolicValue: row.diastolicValue == null ? null : Number(row.diastolicValue) }))
    .sort((a,b) => a.localDate.localeCompare(b.localDate) || String(a.completedAt || '').localeCompare(String(b.completedAt || '')))
  const inRange = since => readings.filter(row => row.localDate >= dayString(since))
  const last7 = inRange(start7); const last30 = inRange(start30)
  const average = (rows, key) => rows.length ? round(rows.reduce((sum,row) => sum + row[key], 0) / rows.length) : null
  const latest = readings.at(-1) || null
  return {
    planId: plan.id, title: plan.title, measurementType: plan.measurementType || null,
    measurementUnit: plan.measurementUnit || null, asOfDate,
    latest: latest ? { localDate: latest.localDate, recordedAt: latest.completedAt,
      value: latest.value, measurementUnit: latest.measurementUnit,
      systolicValue: latest.systolicValue, diastolicValue: latest.diastolicValue } : null,
    readings7Days: last7, readings30Days: last30,
    count7Days: last7.length, count30Days: last30.length,
    series7Days: last7.map(row => ({ date: row.localDate, recordedAt: row.completedAt,
      value: row.value, systolicValue: row.systolicValue, diastolicValue: row.diastolicValue,
      measurementUnit: row.measurementUnit })),
    series30Days: last30.map(row => ({ date: row.localDate, recordedAt: row.completedAt,
      value: row.value, systolicValue: row.systolicValue, diastolicValue: row.diastolicValue,
      measurementUnit: row.measurementUnit })),
    average7Days: bloodPressure ? { systolic: average(last7, 'systolicValue'), diastolic: average(last7, 'diastolicValue'), unit: plan.measurementUnit }
      : { value: average(last7, 'value'), unit: plan.measurementUnit },
    average30Days: bloodPressure ? { systolic: average(last30, 'systolicValue'), diastolic: average(last30, 'diastolicValue'), unit: plan.measurementUnit }
      : { value: average(last30, 'value'), unit: plan.measurementUnit },
  }
}

export function buildMonitoringWeeklySummaries({ plans = [], checkIns = [], asOfDate = new Date().toISOString().slice(0, 10) }) {
  return plans.filter(plan => plan.measurementType).flatMap(plan => {
    const planRows = checkIns.filter(row => row.monitoringPlanId === plan.id && row.status === 'done'
      && (row.measurementValue != null || row.systolicValue != null && row.diastolicValue != null)
      && row.localDate <= asOfDate)
    if (!planRows.length) return []
    const first = toDay(planRows.reduce((min, row) => row.localDate < min ? row.localDate : min, planRows[0].localDate))
    const end = toDay(asOfDate)
    const summaries = []
    for (let thisEnd = new Date(end); thisEnd >= first; thisEnd.setUTCDate(thisEnd.getUTCDate() - 7)) {
      const thisStart = new Date(thisEnd); thisStart.setUTCDate(thisStart.getUTCDate() - 6)
      const startText = dayString(thisStart); const endText = dayString(thisEnd)
      const readings = planRows.filter(row => row.localDate >= startText && row.localDate <= endText)
      if (!readings.length) continue
      const analysis = analyzeMonitoringReadings({ plan, checkIns: readings, asOfDate: endText })
      const scheduledDates = []
      for (let cursor = new Date(thisStart); cursor <= thisEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = dayString(cursor)
        if (isScheduledOn({ ...plan, isActive: true }, date)) scheduledDates.push(date)
      }
      const expectedOccurrences = scheduledDates.length * Math.max(1, plan.times?.length || 0)
      const completedKeys = new Set(checkIns.filter(row => row.monitoringPlanId === plan.id && row.status === 'done'
        && scheduledDates.includes(row.localDate)).map(row => `${row.localDate}:${row.occurrenceKey}`))
      summaries.push({ planId: plan.id, title: plan.title, measurementType: plan.measurementType,
        measurementUnit: plan.measurementUnit, weekStart: startText, weekEnd: endText,
        readingCount: analysis.count7Days, average7Days: analysis.average7Days,
        completedOccurrences: completedKeys.size, scheduledOccurrences: expectedOccurrences,
        latest: analysis.latest, readings: analysis.readings7Days })
    }
    return summaries
  }).sort((a,b) => b.weekStart.localeCompare(a.weekStart) || a.title.localeCompare(b.title))
}

