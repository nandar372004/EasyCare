import { describe, expect, it, vi } from 'vitest'
import { createPatientLifestylePlanService, validateLifestyleResourceUrl } from './patientLifestylePlanService.js'

const id = '91000000-0000-4000-8000-000000000001'

describe('patient lifestyle plan service', () => {
  it('accepts valid HTTPS and HTTP website and YouTube URLs', () => {
    expect(validateLifestyleResourceUrl('https://youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
    expect(validateLifestyleResourceUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(validateLifestyleResourceUrl('http://example.org/article')).toBe('http://example.org/article')
  })

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///etc/passwd', 'ftp://example.com', '//example.com/path', 'https://', 'https://user:pass@example.com', 'https://example.com/a b'])('rejects unsafe or malformed URL %s', url => {
    expect(() => validateLifestyleResourceUrl(url)).toThrow()
  })

  it('trims plan details and forwards no browser-selected patient identity', async () => {
    const repository = { saveMyPlan: vi.fn(async value => value) }
    const service = createPatientLifestylePlanService(repository)
    await service.saveMyPlan({ title: '  Better Sleep  ', description: '  Regular bedtime  ', category: 'sleep' })
    expect(repository.saveMyPlan).toHaveBeenCalledWith({ id: null, title: 'Better Sleep', description: 'Regular bedtime', category: 'sleep' })
  })

  it('validates URL before resource storage is called', async () => {
    const repository = { saveMyResource: vi.fn() }
    const service = createPatientLifestylePlanService(repository)
    expect(() => service.saveMyResource(id, { url: 'data:text/html,hello' })).toThrow(/website link/)
    expect(repository.saveMyResource).not.toHaveBeenCalled()
    await service.saveMyResource(id, { url: 'https://example.com', title: 'Guide' })
    expect(repository.saveMyResource).toHaveBeenCalledWith(id, { id: null, title: 'Guide', url: 'https://example.com/' })
  })
})
