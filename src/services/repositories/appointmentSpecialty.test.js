import { describe, expect, it, vi } from 'vitest'
import { createSupabaseRepository } from './supabaseRepository.js'
describe('appointment provider specialty mapping', () => {
  it.each([true, false])('uses primary specialty or neutral fallback, available=%s', available => {
    const row = { id: 'appointment', provider: { id: 'provider', display_name: 'Actual Provider', provider_specialties: available ? [{ is_primary: false, specialties: { name: 'Other' } }, { is_primary: true, specialties: { name: 'Cardiology' } }] : [] } }
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query)
    const repo = createSupabaseRepository({ from: vi.fn().mockReturnValue(query) })
    return repo.getAppointment('appointment', { patientId: 'self' }).then(result => {
      expect(query.select.mock.calls[0][0]).toContain('provider_specialties(is_primary, specialties(name))')
      expect(result.doctor.specialty).toBe(available ? 'Cardiology' : 'Provider')
      expect(query.eq).toHaveBeenCalledWith('patient_id', 'self')
    })
  })
})
