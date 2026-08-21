import { describe, expect, it } from 'vitest'
import { getConsultationEligibility, getCountdown, getDeterministicQueue, SYNTHETIC_CONSULTATION_SUMMARIES } from './consultationDemo.js'

const now = new Date('2026-08-13T00:00:00.000Z')
const eligible = { id: 'appointment-owned-1', status: 'confirmed', consultationType: 'video', scheduledAt: '2026-08-14T01:02:03.000Z' }

describe('consultation waiting-room demo state', () => {
  it('admits only an owned, future, remote, eligible appointment', () => {
    expect(getConsultationEligibility(eligible, now)).toEqual({ eligible: true, reason: null })
    expect(getConsultationEligibility(null, now)).toMatchObject({ eligible: false })
    expect(getConsultationEligibility({ ...eligible, consultationType: 'home_visit' }, now).reason).toMatch(/Home visits/)
    expect(getConsultationEligibility({ ...eligible, status: 'cancelled' }, now).reason).toMatch(/Cancelled/)
    expect(getConsultationEligibility({ ...eligible, status: 'completed' }, now).reason).toMatch(/Completed/)
    expect(getConsultationEligibility({ ...eligible, scheduledAt: '2026-08-12T00:00:00.000Z' }, now).reason).toMatch(/passed/)
  })

  it('produces deterministic countdown, queue, and wait values', () => {
    expect(getCountdown(eligible.scheduledAt, now)).toEqual({ days: 1, hours: 1, minutes: 2, seconds: 3, totalSeconds: 90123 })
    expect(getDeterministicQueue(eligible.id)).toEqual(getDeterministicQueue(eligible.id))
    expect(getDeterministicQueue(eligible.id).queueNumber).toBeGreaterThanOrEqual(1)
  })

  it('labels all simulated content and summaries clearly', () => {
    expect(SYNTHETIC_CONSULTATION_SUMMARIES.every(({ status }) => status === 'completed')).toBe(true)
  })
})
