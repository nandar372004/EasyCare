import { createPatientLifestylePlanRepository } from './repositories/patientLifestylePlanRepository.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = new Set(['nutrition', 'exercise', 'sleep', 'posture', 'stress', 'general_wellness', 'other'])

export function validateLifestyleResourceUrl(value) {
  const input = typeof value === 'string' ? value.trim() : ''
  if (!input || input.length > 2048 || /\s/.test(input)) throw new TypeError('Enter a valid HTTP or HTTPS URL.')
  let parsed
  try { parsed = new URL(input) } catch { throw new TypeError('Enter a valid HTTP or HTTPS URL.') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new TypeError('Use a website link beginning with http:// or https://.')
  }
  return parsed.href
}

export function createPatientLifestylePlanService(repository = createPatientLifestylePlanRepository()) {
  return {
    listMyPlans: () => repository.listMyPlans(),
    saveMyPlan(input) {
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      const description = typeof input?.description === 'string' ? input.description.trim() : ''
      const category = input?.category || null
      if (!title || title.length > 200 || description.length > 4000 || (category && !CATEGORIES.has(category))) throw new TypeError('Enter a title and keep plan details within the allowed limits.')
      if (input?.id && !UUID.test(input.id)) throw new TypeError('Choose a valid lifestyle plan.')
      return repository.saveMyPlan({ id: input?.id || null, title, description, category })
    },
    deactivateMyPlan(planId) {
      if (!UUID.test(planId || '')) throw new TypeError('Choose a valid lifestyle plan.')
      return repository.deactivateMyPlan(planId)
    },
    saveMyResource(planId, input) {
      if (!UUID.test(planId || '') || (input?.id && !UUID.test(input.id))) throw new TypeError('Choose a valid lifestyle plan and resource.')
      const title = typeof input?.title === 'string' ? input.title.trim() : ''
      if (title.length > 200) throw new TypeError('Resource titles can be up to 200 characters.')
      return repository.saveMyResource(planId, { id: input?.id || null, title, url: validateLifestyleResourceUrl(input?.url) })
    },
    deleteMyResource(planId, resourceId) {
      if (!UUID.test(planId || '') || !UUID.test(resourceId || '')) throw new TypeError('Choose a valid lifestyle resource.')
      return repository.deleteMyResource(planId, resourceId)
    },
  }
}

export const patientLifestylePlanService = createPatientLifestylePlanService()
