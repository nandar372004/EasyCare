import { createCarePlanRepository } from './repositories/carePlanRepository.js'

const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')
const requiredText = (value, label, max = 180) => {
  const text = value?.trim()
  if (!text || text.length > max) throw new Error(`Enter ${label} using 1–${max} characters.`)
  return text
}

export function createCarePlanService(repository = createCarePlanRepository()) {
  return {
    createDraft(input) {
      if (!uuid(input?.patientId)) throw new Error('Choose a valid patient record.')
      return repository.createDraft({ ...input, title: requiredText(input.title, 'a plan title', 160), timezone: requiredText(input.timezone, 'a timezone', 100) })
    },
    createVersion(input) {
      if (!uuid(input?.planId)) throw new Error('Choose a valid care plan.')
      return repository.createVersion({ ...input, title: requiredText(input.title, 'a version title', 160), changeReason: requiredText(input.changeReason, 'a reason for this version', 500) })
    },
    addGoal(input) {
      if (!uuid(input?.planId)) throw new Error('Choose a valid care plan.')
      return repository.addGoal({ ...input, title: requiredText(input.title, 'a goal', 180) })
    },
    addTask(input) {
      if (!uuid(input?.planId)) throw new Error('Choose a valid care plan.')
      if (!['medication', 'vital_check', 'appointment', 'follow_up', 'activity', 'instruction', 'custom'].includes(input?.type)) throw new Error('Choose a supported clinical task type.')
      return repository.addTask({ ...input, title: requiredText(input.title, 'a task title', 180) })
    },
    approveVersion: (...args) => repository.approveVersion(...args),
    approveProviderVersion: (...args) => repository.approveProviderVersion(...args),
    transition: (planId, intent, reason) => {
      if (!uuid(planId) || !['activate', 'pause', 'resume', 'complete', 'discontinue', 'cancel'].includes(intent)) throw new Error('Choose a valid care plan action.')
      return repository.transition(planId, intent, reason)
    },
    extendOccurrences: (...args) => repository.extendOccurrences(...args),
    reconcileOccurrences: planId => {
      if (!uuid(planId)) throw new Error('Choose a valid care plan.')
      return repository.reconcileOccurrences(planId)
    },
    acknowledgeOccurrence: (...args) => repository.acknowledgeOccurrence(...args),
    listMyPlans: () => repository.listMyPlans(),
    listProviderPlans: () => repository.listProviderPlans(),
    getProviderPlan: planId => {
      if (!uuid(planId)) throw new Error('Choose a valid care plan.')
      return repository.getProviderPlan(planId)
    },
    listProviderSources: (patientId, kind) => {
      if (!uuid(patientId) || !['medication', 'appointment', 'follow_up'].includes(kind)) throw new Error('Choose a valid patient and source type.')
      return repository.listProviderSources(patientId, kind)
    },
    getDetail: (...args) => repository.getDetail(...args),
    getOccurrences: (...args) => repository.getOccurrences(...args),
    getEvents: (...args) => repository.getEvents(...args),
    getProgress: (...args) => repository.getProgress(...args),
  }
}

export const carePlanService = createCarePlanService()
