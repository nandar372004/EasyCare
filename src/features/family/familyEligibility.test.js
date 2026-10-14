import { describe, expect, it } from 'vitest'
import { isFamilyAdult } from './familyEligibility.js'

describe('family adult eligibility UX', () => {
  it('accepts the exact 18th birthday boundary', () => {
    expect(isFamilyAdult('2008-10-03', '2026-10-03')).toBe(true)
  })

  it('rejects a DOB one day short of 18', () => {
    expect(isFamilyAdult('2008-10-04', '2026-10-03')).toBe(false)
  })

  it('accepts DOBs older than 18', () => {
    expect(isFamilyAdult('1990-02-15', '2026-10-03')).toBe(true)
  })

  it('matches date-only leap-year subtraction by clamping the cutoff to February 28', () => {
    expect(isFamilyAdult('2008-02-28', '2026-02-28')).toBe(true)
    expect(isFamilyAdult('2008-02-29', '2026-02-28')).toBe(false)
    expect(isFamilyAdult('2008-02-29', '2026-03-01')).toBe(true)
  })

  it('rejects missing or invalid DOB values', () => {
    expect(isFamilyAdult(null, '2026-10-03')).toBe(false)
    expect(isFamilyAdult('2000-02-30', '2026-10-03')).toBe(false)
  })
})
