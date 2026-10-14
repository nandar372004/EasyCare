import { supabase } from '../../lib/supabase.js'

const GOAL_COLUMNS = 'id, title, is_completed, completed_at, created_at, updated_at'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const rowModel = row => row == null ? null : ({
  id: row.id,
  title: row.title,
  isCompleted: row.is_completed,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function sortPatientHealthGoals(goals) {
  return [...(goals || [])].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.id).localeCompare(String(b.id)))
}

export function createPatientHealthGoalRepository(client = supabase) {
  const requireClient = () => {
    if (!client) throw new Error('Health goals are unavailable. Sign in with a configured EasyCare account.')
    return client
  }
  const rpc = async (name, args) => {
    const { data, error } = await requireClient().rpc(name, args)
    if (error) {
      const failure = new Error('Health goal could not be saved. Please try again.')
      failure.code = error.code
      throw failure
    }
    return data
  }
  return {
    async listMyGoals() {
      const { data, error } = await requireClient().from('patient_health_goals').select(GOAL_COLUMNS).order('created_at').order('id')
      if (error) throw new Error('Health goals could not be loaded. Please try again.')
      return sortPatientHealthGoals((data || []).map(rowModel))
    },
    async createMyGoal(title) { return rowModel(await rpc('create_my_patient_health_goal', { p_title: title })) },
    async setGoalCompletion(goalId, isCompleted) {
      if (!UUID.test(goalId || '') || typeof isCompleted !== 'boolean') throw new TypeError('A valid goal and completion state are required.')
      return rowModel(await rpc('set_my_patient_health_goal_completion', { p_goal_id: goalId, p_is_completed: isCompleted }))
    },
    async deleteMyGoal(goalId) {
      if (!UUID.test(goalId || '')) throw new TypeError('A valid goal is required.')
      await rpc('delete_my_patient_health_goal', { p_goal_id: goalId })
    },
  }
}
