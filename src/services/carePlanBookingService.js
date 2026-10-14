import { createCarePlanBookingRepository } from './repositories/carePlanBookingRepository.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

export function createCarePlanBookingService(repository = null) {
  const source = () => repository || (repository = createCarePlanBookingRepository())
  return {
    createBooking(input) {
      if (!UUID.test(input?.recipientPatientId || '') || !UUID.test(input?.packageId || '')
        || !UUID.test(input?.serviceId || '') || !UUID.test(input?.idempotencyKey || '')) {
        throw new TypeError('Choose a valid recipient and Home Care selection.')
      }
      if (!Number.isInteger(input?.durationDays) || input.durationDays <= 0
        || !DATE.test(input?.preferredDate || '') || !TIME.test(input?.preferredTime || '')
        || typeof input?.address !== 'string' || !input.address.trim()) {
        throw new TypeError('Complete the required Home Care booking details.')
      }
      // Only identifiers and request details cross the browser boundary. Prices,
      // requester identity and commission are resolved by the booking RPC.
      return source().createBooking({
        recipientPatientId: input.recipientPatientId,
        packageId: input.packageId,
        serviceId: input.serviceId,
        durationDays: input.durationDays,
        preferredDate: input.preferredDate,
        preferredTime: input.preferredTime,
        address: input.address.trim(),
        reasonSymptoms: typeof input.reasonSymptoms === 'string' ? input.reasonSymptoms.trim() : '',
        idempotencyKey: input.idempotencyKey,
      })
    },
  }
}

export const carePlanBookingService = createCarePlanBookingService()
