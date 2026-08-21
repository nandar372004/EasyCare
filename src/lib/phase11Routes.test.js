import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8')
const navigation = readFileSync(join(process.cwd(), 'src/data/navigation.js'), 'utf8')

describe('Phase 11 route contract', () => {
  it.each(['/health-records', '/prescriptions', '/medications'])('registers and navigates to %s', (route) => {
    expect(app).toContain(`path="${route}"`)
    expect(navigation).toContain(`to: '${route}'`)
  })
})
