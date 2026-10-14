import { describe, expect, it, vi } from 'vitest'
import { createCarePlanCatalogService } from './carePlanCatalogService.js'

describe('Home Care catalog service', () => {
  it('uses package, care-level, and duration identifiers for server quotes', async () => {
    const quote = { subtotal: '144000.00', currency: 'MMK' }
    const repository = { listPackages: vi.fn().mockResolvedValue([]), quote: vi.fn().mockResolvedValue(quote) }
    const service = createCarePlanCatalogService(repository)
    await expect(service.quote('ec000000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000002', 3)).resolves.toBe(quote)
    expect(repository.quote).toHaveBeenCalledExactlyOnceWith('ec000000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000002', 3)
  })

  it('rejects invalid identifiers or duration before making a quote request', async () => {
    const repository = { listPackages: vi.fn(), quote: vi.fn() }
    const service = createCarePlanCatalogService(repository)
    expect(() => service.quote('frontend-slug', 'ec100000-0000-4000-8000-000000000001', 3)).toThrow(/valid Home Care package/)
    expect(() => service.quote('ec000000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', 2.5)).toThrow(/valid Home Care duration/)
    expect(repository.quote).not.toHaveBeenCalled()
  })
})
