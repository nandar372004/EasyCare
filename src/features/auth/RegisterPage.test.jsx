import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App.jsx'

function renderAt(route) {
  return render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
}

describe('patient registration route', () => {
  beforeEach(() => localStorage.clear())
  it('renders directly at /register', () => {
    renderAt('/register')
    expect(screen.getByRole('heading', { name: 'Create your patient profile' })).toBeInTheDocument()
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument()
  })

  it('opens registration from the Login Create Account link', async () => {
    const user = userEvent.setup()
    renderAt('/login')
    await user.click(screen.getByRole('link', { name: 'Create Account' }))
    expect(screen.getByRole('heading', { name: 'Create your patient profile' })).toBeInTheDocument()
  })

  it('shows field errors and remains on registration when validation fails', async () => {
    const user = userEvent.setup()
    renderAt('/register')
    await user.click(screen.getByRole('button', { name: 'Create Patient Account' }))
    await waitFor(() => expect(screen.getByLabelText('Phone Number')).toHaveFocus())
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Create your patient profile' })).toBeInTheDocument()
  })

  it('provides accessible show and hide password controls', async () => {
    const user = userEvent.setup()
    renderAt('/register')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })

  it('keeps the landing route working', () => {
    const route = '/'
    renderAt(route)
    expect(screen.getByRole('heading', { name: 'Welcome to MediBridge AI' })).toBeInTheDocument()
  })

  it.each(['/doctors', '/appointments', '/appointments/test-id', '/consultations/test-id', '/settings'])(
    'protects unauthenticated route %s',
    (route) => {
      renderAt(route)
      expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument()
    },
  )

  it('retains mobile overflow protections for the registration form', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')
    expect(css).toMatch(/body\s*\{[^}]*overflow-x:\s*hidden/)
    expect(css).toMatch(/\.registration-card\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.form-grid\s*\{[^}]*min-width:\s*0/)
  })
})
