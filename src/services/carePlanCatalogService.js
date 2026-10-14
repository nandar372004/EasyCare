import { createCarePlanCatalogRepository } from './repositories/carePlanCatalogRepository.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createCarePlanCatalogService(repository = null) {
  const source = () => repository || (repository = createCarePlanCatalogRepository())
  return {
    listPackages() {
      return source().listPackages()
    },
    quote(packageId, serviceId, durationDays) {
      if (!UUID.test(packageId || '') || !UUID.test(serviceId || '')) throw new TypeError('Choose a valid Home Care package and care level.')
      if (!Number.isInteger(durationDays) || durationDays <= 0) throw new TypeError('Choose a valid Home Care duration.')
      return source().quote(packageId, serviceId, durationDays)
    },
  }
}

export const carePlanCatalogService = createCarePlanCatalogService()
