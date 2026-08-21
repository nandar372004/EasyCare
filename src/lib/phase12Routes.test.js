import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('phase 12 route registration', () => {
  const app = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
  for (const route of ['/health-guardian', '/payments', '/messages', '/location', '/settings']) {
    it(`registers ${route}`, () => expect(app).toContain(`path="${route}"`))
  }
})
