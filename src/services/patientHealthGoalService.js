import { createPatientHealthGoalRepository, sortPatientHealthGoals } from './repositories/patientHealthGoalRepository.js'
export { sortPatientHealthGoals } from './repositories/patientHealthGoalRepository.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const requiredTitle = value => {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || title.length > 200) throw new Error('Enter a goal using 1–200 characters.')
  return title
}

export function createPatientHealthGoalService(repository = createPatientHealthGoalRepository()) {
  return {
    async listMyGoals() { return sortPatientHealthGoals(await repository.listMyGoals()) },
    createMyGoal(title) { return repository.createMyGoal(requiredTitle(title)) },
    setGoalCompletion(goalId, isCompleted) {
      if (!UUID.test(goalId || '') || typeof isCompleted !== 'boolean') throw new Error('Choose a valid goal state.')
      return repository.setGoalCompletion(goalId, isCompleted)
    },
    deleteMyGoal(goalId) {
      if (!UUID.test(goalId || '')) throw new Error('Choose a valid goal.')
      return repository.deleteMyGoal(goalId)
    },
  }
}

export const patientHealthGoalService = createPatientHealthGoalService()
