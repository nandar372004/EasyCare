import { supabase } from '../../lib/supabase.js'

// All writes use intent-specific database RPCs. The client never writes plan
// tables directly and actor identity is always derived by the database.
export function createCarePlanRepository(client = supabase) {
  const call = async (name, args = {}) => {
    if (!client) throw new Error('Clinical care plans are unavailable. Sign in with a configured EasyCare account.')
    const { data, error } = await client.rpc(name, args)
    if (error) {
      const messages = {
        '42501': 'Provider eligibility or patient relationship is unavailable. Refresh your patient list and try again.',
        '23503': 'A linked clinical source is no longer valid for this patient. Refresh the source selector and choose again.',
        '22023': 'The Care Plan changed or this action is invalid for its current state. Reload the plan and try again.',
        '40001': 'The Care Plan changed while you were editing it. Reload the plan and try again.',
        '40P01': 'Another Care Plan update is in progress. Reload the plan and try again.',
      }
      throw new Error(messages[error.code] ?? 'The Care Plan could not be saved. Check your connection and retry.')
    }
    return data
  }
  return {
    createDraft: input => call('create_care_plan_draft', {
      p_patient: input.patientId, p_source_encounter: input.sourceEncounterId ?? null,
      p_title: input.title, p_summary: input.summary ?? null, p_instructions: input.instructions ?? null,
      p_timezone: input.timezone, p_starts_at: input.startsAt ?? null, p_target_end_at: input.targetEndAt ?? null,
    }),
    createVersion: input => call('create_care_plan_version', {
      p_plan: input.planId, p_title: input.title, p_summary: input.summary ?? null,
      p_instructions: input.instructions ?? null, p_change_reason: input.changeReason,
      p_source_encounter: input.sourceEncounterId ?? null,
    }),
    addGoal: input => call('add_care_plan_goal', {
      p_plan: input.planId, p_title: input.title, p_description: input.description ?? null,
      p_target: input.target ?? null, p_review_at: input.reviewAt ?? null, p_sort: input.sortOrder ?? 0,
    }),
    addTask: input => call('add_care_plan_task', {
      p_plan: input.planId, p_type: input.type, p_title: input.title, p_instructions: input.instructions ?? null,
      p_required: input.required ?? true, p_manual_ack: input.manualAcknowledgement ?? false,
      p_recurrence: input.recurrence ?? 'one_time', p_starts_on: input.startsOn,
      p_ends_on: input.endsOn ?? null, p_weekdays: input.weekdays ?? null, p_local_times: input.localTimes ?? ['09:00'],
      p_timezone: input.timezone, p_vital_type: input.vitalType ?? null, p_medication: input.medicationId ?? null,
      p_schedule: input.medicationScheduleId ?? null, p_appointment: input.appointmentId ?? null,
      p_follow_up: input.followUpId ?? null, p_goal: input.goalId ?? null,
    }),
    approveVersion: (planId, changeReason = null) => call('approve_care_plan_version', { p_plan: planId, p_change_reason: changeReason }),
    approveProviderVersion: (planId, changeReason = null) => call('approve_provider_care_plan_version', { p_plan: planId, p_change_reason: changeReason }),
    transition: (planId, intent, reason = null) => call('transition_care_plan', { p_plan: planId, p_intent: intent, p_reason: reason }),
    extendOccurrences: (planId, through = null) => call('extend_care_plan_occurrences', { p_plan: planId, p_through: through }),
    reconcileOccurrences: planId => call('reconcile_care_plan_occurrences', { p_plan: planId }),
    acknowledgeOccurrence: (occurrenceId, note = null) => call('acknowledge_care_plan_occurrence', { p_occurrence: occurrenceId, p_note: note }),
    listMyPlans: () => call('list_my_care_plan_summaries'),
    listProviderPlans: () => call('list_my_provider_care_plans'),
    getProviderPlan: planId => call('get_my_provider_care_plan', { p_plan: planId }),
    listProviderSources: (patientId, kind) => call('list_provider_care_plan_sources', { p_patient: patientId, p_kind: kind }),
    getDetail: planId => call('get_care_plan_detail', { p_plan: planId }),
    getOccurrences: planId => call('get_care_plan_occurrences', { p_plan: planId }),
    getEvents: planId => call('get_care_plan_events', { p_plan: planId }),
    getProgress: (planId, asOf = null) => call('get_care_plan_progress', { p_plan: planId, p_as_of: asOf }),
  }
}
