import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')
const health = readFileSync(join(process.cwd(), 'src/features/health/HealthPages.jsx'), 'utf8')

describe('phase 13 responsive and accessibility contracts', () => {
  it('prevents page overflow and provides practical touch targets', () => {
    expect(css).toContain('overflow-x:hidden')
    expect(css).toContain('min-height:44px')
  })
  it('provides visible keyboard focus', () => expect(css).toContain(':focus-visible'))
  it('provides Myanmar-capable font fallbacks', () => {
    expect(css).toContain('Noto Sans Myanmar')
    expect(css).toContain('Myanmar Text')
  })
  it('uses modal semantics and Escape handling for health detail dialogs', () => {
    expect(health).toContain('aria-modal="true"')
    expect(health).toContain("event.key === 'Escape'")
    expect(health).toContain('aria-labelledby')
  })
})
