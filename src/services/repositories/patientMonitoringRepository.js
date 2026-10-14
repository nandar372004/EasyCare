import { supabase } from '../../lib/supabase.js'

const PLAN_COLUMNS = 'id, title, related_context, notes, recurrence_type, days_of_week, start_date, end_date, is_active, measurement_type, measurement_unit, created_at, updated_at'
const TIME_COLUMNS = 'id, monitoring_plan_id, time_of_day, created_at'
const CHECKIN_COLUMNS = 'id, monitoring_plan_id, patient_id, local_date, occurrence_key, occurrence_label, status, completed_at, measurement_value, measurement_unit, systolic_value, diastolic_value, notes, created_at, updated_at'

const planModel = row => ({
  id: row.id, title: row.title, relatedContext: row.related_context, notes: row.notes,
  recurrenceType: row.recurrence_type, daysOfWeek: row.days_of_week || [],
  startDate: row.start_date, endDate: row.end_date, isActive: row.is_active,
  measurementType: row.measurement_type || null, measurementUnit: row.measurement_unit || null,
  createdAt: row.created_at, updatedAt: row.updated_at,
})
const timeModel = row => ({ id: row.id, monitoringPlanId: row.monitoring_plan_id, timeOfDay: row.time_of_day, createdAt: row.created_at })
const checkInModel = row => ({
  id: row.id, monitoringPlanId: row.monitoring_plan_id, localDate: row.local_date,
  occurrenceKey: row.occurrence_key, occurrenceLabel: row.occurrence_label, status: row.status, completedAt: row.completed_at,
  measurementValue: row.measurement_value, measurementUnit: row.measurement_unit,
  systolicValue: row.systolic_value == null ? null : Number(row.systolic_value),
  diastolicValue: row.diastolic_value == null ? null : Number(row.diastolic_value),
  notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
})

export function createPatientMonitoringRepository(client = supabase) {
  const requireClient = () => {
    if (!client) throw new Error('Monitoring routines are unavailable. Sign in with a configured EasyCare account.')
    return client
  }
  const rpc = async (name, args) => {
    const { data, error } = await requireClient().rpc(name, args)
    if (error) {
      const failure = new Error('Monitoring routine could not be saved. Please try again.')
      failure.code = error.code
      throw failure
    }
    return Array.isArray(data) ? data[0] : data
  }
  return {
    async listMyPlans() {
      const [{ data: plans, error }, { data: times, error: timeError }] = await Promise.all([
        requireClient().from('patient_monitoring_plans').select(PLAN_COLUMNS).order('created_at').order('id'),
        requireClient().from('patient_monitoring_plan_times').select(TIME_COLUMNS).order('time_of_day').order('id'),
      ])
      if (error) throw new Error('Monitoring routines could not be loaded. Please try again.')
      if (timeError) throw new Error('Monitoring schedule could not be loaded. Please try again.')
      const byPlan = new Map()
      for (const time of times || []) byPlan.set(time.monitoring_plan_id, [...(byPlan.get(time.monitoring_plan_id) || []), timeModel(time)])
      return (plans || []).map(row => ({ ...planModel(row), times: byPlan.get(row.id) || [] }))
    },
    async listMyCheckIns() {
      const { data, error } = await requireClient().from('patient_monitoring_check_ins')
        .select(CHECKIN_COLUMNS).order('local_date', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw new Error('Monitoring history could not be loaded. Please try again.')
      return (data || []).map(checkInModel)
    },
    async saveMyPlan(plan) {
      const row = await rpc('save_my_patient_monitoring_plan_v2', {
        p_plan_id: plan.id || null, p_title: plan.title, p_related_context: plan.relatedContext || null,
        p_notes: plan.notes || null, p_recurrence_type: plan.recurrenceType,
        p_days_of_week: plan.daysOfWeek || [], p_start_date: plan.startDate,
        p_end_date: plan.endDate || null, p_times: (plan.times || []).map(time => `${time}:00`),
        p_measurement_type: plan.measurementType || null, p_measurement_unit: plan.measurementUnit || null,
      })
      return row ? planModel(row) : null
    },
    async deactivateMyPlan(planId) {
      const row = await rpc('deactivate_my_patient_monitoring_plan', { p_plan_id: planId })
      return row ? planModel(row) : null
    },
    async recordMyCheckIn(checkIn) {
      const row = await rpc('record_my_patient_monitoring_check_in', {
        p_plan_id: checkIn.planId, p_local_date: checkIn.localDate,
        p_occurrence_key: checkIn.occurrenceKey, p_is_done: checkIn.isDone,
        p_measurement_value: checkIn.measurementValue || null,
        p_measurement_unit: checkIn.measurementUnit || null, p_notes: checkIn.notes || null,
      })
      return row ? checkInModel(row) : null
    },
    async recordMyMeasurement(input) {
      const row = await rpc('record_my_patient_monitoring_measurement', {
        p_plan_id: input.planId, p_local_date: input.localDate,
        p_occurrence_key: input.occurrenceKey,
        p_systolic_value: input.systolicValue ?? null,
        p_diastolic_value: input.diastolicValue ?? null,
        p_measurement_value: input.measurementValue ?? null,
        p_measurement_unit: input.measurementUnit,
        p_notes: input.notes || null,
      })
      return row ? checkInModel(row) : null
    },
  }
}

