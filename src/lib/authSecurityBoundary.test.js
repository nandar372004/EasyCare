import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readTree(directory) {
  return readdirSync(directory).filter((name) => !name.includes('.test.')).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? readTree(path) : [readFileSync(path, 'utf8')]
  }).join('\n')
}

describe('authentication security boundary', () => {
  it('keeps service-role credentials and admin Auth APIs out of browser source', () => {
    const browserSource = readTree(join(process.cwd(), 'src'))
    expect(browserSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(browserSource).not.toContain('auth.admin.createUser')
    expect(browserSource).not.toContain('auth.admin.deleteUser')
  })

  it('uses the service-role environment only inside the Edge Function', () => {
    const edgeSource = readFileSync(join(process.cwd(), 'supabase/functions/patient-register/index.ts'), 'utf8')
    expect(edgeSource).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")
    expect(edgeSource).toContain("console.error('patient-register:persistence_error', safeError(error))")
    expect(edgeSource).toContain("console.error('patient-register:unexpected_error', safeError(error))")
    expect(edgeSource).not.toMatch(/console\.(?:log|error)\s*\([^\n]*,\s*(?:password|phone|medicalProfile|payload|request)\b/i)
  })

  it('does not manually persist passwords in browser source', () => {
    const browserSource = readTree(join(process.cwd(), 'src'))
    expect(browserSource).not.toMatch(/localStorage\.setItem\([^)]*password/i)
    expect(browserSource).not.toMatch(/sessionStorage\.setItem\([^)]*password/i)
  })
})
