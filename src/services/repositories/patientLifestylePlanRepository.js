import { supabase } from '../../lib/supabase.js'

const PLAN_COLUMNS = 'id, title, description, category, is_active, created_at, updated_at'
const RESOURCE_COLUMNS = 'id, lifestyle_plan_id, title, url, resource_type, created_at, updated_at'
const planModel = row => ({ id: row.id, title: row.title, description: row.description, category: row.category, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at })
const resourceModel = row => ({ id: row.id, planId: row.lifestyle_plan_id, title: row.title, url: row.url, resourceType: row.resource_type, createdAt: row.created_at, updatedAt: row.updated_at })

export function createPatientLifestylePlanRepository(client = supabase) {
  const requireClient = () => {
    if (!client) throw new Error('Lifestyle plans are unavailable. Sign in with a configured EasyCare account.')
    return client
  }
  const rpc = async (name, args) => {
    const { data, error } = await requireClient().rpc(name, args)
    if (error) {
      const failure = new Error('Lifestyle plan could not be saved. Please try again.')
      failure.code = error.code
      throw failure
    }
    return Array.isArray(data) ? data[0] : data
  }
  return {
    async listMyPlans() {
      const db = requireClient()
      const { data: plans, error } = await db.from('patient_lifestyle_plans').select(PLAN_COLUMNS).eq('is_active', true).order('created_at').order('id')
      if (error) throw new Error('Lifestyle plans could not be loaded. Please try again.')
      const { data: resources, error: resourceError } = await db.from('patient_lifestyle_resources').select(RESOURCE_COLUMNS).order('created_at').order('id')
      if (resourceError) throw new Error('Lifestyle resources could not be loaded. Please try again.')
      const byPlan = new Map()
      for (const row of resources || []) byPlan.set(row.lifestyle_plan_id, [...(byPlan.get(row.lifestyle_plan_id) || []), resourceModel(row)])
      return (plans || []).map(row => ({ ...planModel(row), resources: byPlan.get(row.id) || [] }))
    },
    async saveMyPlan(plan) { return planModel(await rpc('save_my_patient_lifestyle_plan', { p_plan_id: plan.id || null, p_title: plan.title, p_description: plan.description || null, p_category: plan.category || null })) },
    async deactivateMyPlan(planId) { return planModel(await rpc('deactivate_my_patient_lifestyle_plan', { p_plan_id: planId })) },
    async saveMyResource(planId, resource) {
      return resourceModel(await rpc('save_my_patient_lifestyle_resource', { p_plan_id: planId, p_resource_id: resource.id || null, p_title: resource.title || null, p_url: resource.url }))
    },
    async deleteMyResource(planId, resourceId) { await rpc('delete_my_patient_lifestyle_resource', { p_plan_id: planId, p_resource_id: resourceId }) },
  }
}
