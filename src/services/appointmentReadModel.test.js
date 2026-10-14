import { describe, expect, it } from 'vitest'
import { ACTIVE_APPOINTMENT_STATUSES, canJoinWaitingRoom, isFutureEligibleAppointment, selectAppointments } from './bookingService.js'
import { translations } from '../features/localization/translations.js'
import { bookingReason, composeBookingReason } from '../features/care/OneTapCare.jsx'
const now = new Date('2026-10-09T00:00:00Z')
const row = (id, status, scheduledAt = '2026-10-10T00:00:00Z') => ({ id, status, scheduledAt, consultationType: 'video' })
describe('appointment read model refinements', () => {
  it.each(['pending', 'confirmed', 'rescheduled'])('includes only future %s in Upcoming', status => {
    expect(selectAppointments([row('future', status), row('past', status, '2026-10-08T00:00:00Z'), row('now', status, now.toISOString())], 'upcoming', now).map(item => item.id)).toEqual(['future'])
  })
  it.each(['cancelled', 'completed', 'no_show', 'checked_in', 'in_progress'])('excludes %s from Upcoming', status => {
    expect(selectAppointments([row('x', status)], 'upcoming', now)).toEqual([])
  })
  it('orders Upcoming nearest first with deterministic ID ties', () => {
    expect(selectAppointments([row('later', 'pending', '2026-10-12T00:00:00Z'), row('b', 'rescheduled'), row('a', 'confirmed')], 'upcoming', now).map(item => item.id)).toEqual(['a', 'b', 'later'])
  })
  it('includes completed/no-show and past active records in History newest first', () => {
    const rows = [row('past', 'pending', '2026-10-07T00:00:00Z'), row('no-show', 'no_show', '2026-10-08T00:00:00Z'), row('completed', 'completed'), row('cancelled', 'cancelled')]
    expect(selectAppointments(rows, 'history', now).map(item => item.id)).toEqual(['completed', 'no-show', 'past'])
    expect(selectAppointments(rows, 'cancelled', now).map(item => item.id)).toEqual(['cancelled'])
  })
  it('supports rescheduled eligibility without unsupported statuses', () => {
    expect(ACTIVE_APPOINTMENT_STATUSES).toEqual(['pending', 'confirmed', 'rescheduled'])
    expect(isFutureEligibleAppointment(row('x', 'rescheduled'), now)).toBe(true)
    expect(canJoinWaitingRoom(row('x', 'rescheduled', '2099-01-01T00:00:00Z'))).toBe(true)
  })
  it.each(['en', 'my'])('has labels for all supported statuses in %s', language => {
    for (const status of ['pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled']) expect(translations[language].status[status]).toBeTruthy()
    expect(translations[language].status.checked_in).toBeUndefined()
  })
  it('preserves all content at 2000 characters and rejects overflow without truncating', () => {
    const draft = { intent: 'Medication question', note: 'My note' }
    const overhead = composeBookingReason(draft, 'x').length - 1
    const text = 'x'.repeat(2000 - overhead)
    expect(bookingReason(draft, text)).toHaveLength(2000)
    expect(composeBookingReason(draft, text + 'x')).toMatchObject({ length: 2001, valid: false })
    expect(() => bookingReason(draft, text + 'x')).toThrow(/2,000/)
    expect(bookingReason(null, ' x ')).toBe('x')
  })
})
