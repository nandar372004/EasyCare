import { describe, expect, it, vi } from 'vitest'
import { createCarePlanBookingRepository } from './repositories/carePlanBookingRepository.js'
import { createCarePlanBookingService } from './carePlanBookingService.js'

const validInput = {
  recipientPatientId: 'ec900000-0000-4000-8000-000000000101',
  packageId: 'ec000000-0000-4000-8000-000000000001',
  serviceId: 'ec100000-0000-4000-8000-000000000001',
  durationDays: 3,
  preferredDate: '2026-10-20',
  preferredTime: '09:00',
  address: '  No. 10 Example Street  ',
  reasonSymptoms: '  Needs daily support  ',
  idempotencyKey: 'ec900000-0000-4000-8000-000000000501',
}

describe('Home Care booking repository', () => {
  it('calls only the secure RPC with recipient, catalog identifiers, schedule and request details', async () => {
    const result = { care_request_id: 'request-1', subtotal: '108000.00' }
    const client = { rpc: vi.fn().mockResolvedValue({ data: [result], error: null }) }
    const repository = createCarePlanBookingRepository(client)
    await expect(repository.createBooking({
      recipientPatientId: validInput.recipientPatientId,
      packageId: validInput.packageId,
      serviceId: validInput.serviceId,
      durationDays: validInput.durationDays,
      preferredDate: validInput.preferredDate,
      preferredTime: validInput.preferredTime,
      address: 'No. 10 Example Street',
      reasonSymptoms: validInput.reasonSymptoms,
      idempotencyKey: validInput.idempotencyKey,
    })).resolves.toBe(result)
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('create_home_care_booking', {
      p_recipient_patient_id: validInput.recipientPatientId,
      p_package_id: validInput.packageId,
      p_service_id: validInput.serviceId,
      p_duration_days: 3,
      p_preferred_date: '2026-10-20',
      p_preferred_time: '09:00',
      p_address: 'No. 10 Example Street',
      p_reason_symptoms: validInput.reasonSymptoms,
      p_idempotency_key: validInput.idempotencyKey,
    })
    expect(JSON.stringify(client.rpc.mock.calls)).not.toMatch(/price|subtotal|commission|requester_profile/i)
  })

  it('returns a clear family permission message from the booking RPC', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'You no longer have permission to book care for this family member.' } }) }
    await expect(createCarePlanBookingRepository(client).createBooking({})).rejects.toMatchObject({
      code: '42501', message: 'You no longer have permission to book care for this family member.',
    })
  })
})

describe('Home Care booking service', () => {
  it('validates request identifiers and required details without sending browser pricing', async () => {
    const repository = { createBooking: vi.fn().mockResolvedValue({ care_request_id: 'request-1' }) }
    const service = createCarePlanBookingService(repository)
    await service.createBooking(validInput)
    expect(repository.createBooking).toHaveBeenCalledExactlyOnceWith({
      ...validInput,
      address: 'No. 10 Example Street',
      reasonSymptoms: 'Needs daily support',
    })
    expect(() => service.createBooking({ ...validInput, recipientPatientId: 'someone-else' })).toThrow(/valid recipient/)
    expect(() => service.createBooking({ ...validInput, durationDays: 2.5 })).toThrow(/required Home Care/)
    expect(repository.createBooking).toHaveBeenCalledTimes(1)
  })
})
