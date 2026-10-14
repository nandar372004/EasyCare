import { describe, expect, it, vi } from 'vitest'
import { createSupabaseRepository } from './supabaseRepository.js'

describe('appointment pricing payload', () => {
  it('omits browser pricing and returns the database price', async () => {
    const query = { insert: vi.fn(), select: vi.fn(), single: vi.fn().mockResolvedValue({
      data: { id: 'appointment', fee_amount: 30000, currency: 'MMK' }, error: null,
    }) }
    query.insert.mockReturnValue(query)
    query.select.mockReturnValue(query)
    const repository = createSupabaseRepository({ from: vi.fn().mockReturnValue(query) })
    const appointment = await repository.createAppointment({
      patientId: 'patient', doctorId: 'doctor', slotId: 'slot', consultationType: 'video',
      bookingCode: 'CODE', startsAt: '2030-01-01T09:00Z', endsAt: '2030-01-01T09:30Z',
      feeMmk: 0, currency: 'USD',
    })
    expect(query.insert.mock.calls[0][0]).not.toHaveProperty('fee_amount')
    expect(query.insert.mock.calls[0][0]).not.toHaveProperty('currency')
    expect(appointment.feeMmk).toBe(30000)
  })
})
