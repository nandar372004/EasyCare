import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage } from './ForgotPasswordPage.jsx'
import { VerifyResetCodePage } from './VerifyResetCodePage.jsx'
import { ResetPasswordPage } from './ResetPasswordPage.jsx'
import { PASSWORD_RESET_DEMO_CONFIG, resetPasswordDemoForTests } from '../../services/passwordResetDemoService.js'

function renderFlow(initialEntry = '/forgot-password') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-reset-code" element={<VerifyResetCodePage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<h1>Login</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('forgot-password presentation flow', () => {
  beforeEach(resetPasswordDemoForTests)

  it('runs the labeled simulation and returns to Login without changing a real password', async () => {
    const user = userEvent.setup()
    renderFlow()

    expect(screen.getByText('Presentation Demo — No real SMS is sent.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Phone Number'), PASSWORD_RESET_DEMO_CONFIG.phoneNumber)
    await user.click(screen.getByRole('button', { name: 'Continue Demo' }))

    expect(await screen.findByRole('heading', { name: 'Verify Reset Code' })).toBeInTheDocument()
    expect(screen.getByText(/Demo verification code:/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verify Demo Code' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid, expired, or already used/i)
    await user.type(screen.getByLabelText('Demo Verification Code'), PASSWORD_RESET_DEMO_CONFIG.verificationCode)
    await user.click(screen.getByRole('button', { name: 'Verify Demo Code' }))

    expect(await screen.findByRole('heading', { name: 'Reset Password' })).toBeInTheDocument()
    expect(screen.getByText('No Supabase password will be changed.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('New Password'), 'StrongPass1')
    await user.type(screen.getByLabelText('Confirm Password'), 'StrongPass1')
    await user.click(screen.getByRole('button', { name: 'Demonstrate Password Reset' }))
    expect(screen.getByRole('status')).toHaveTextContent('Password reset demonstrated successfully. No production SMS verification occurred.')
    await user.click(screen.getByRole('link', { name: 'Return to Login' }))
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })

  it('redirects an out-of-order reset-code route to the start', async () => {
    renderFlow('/verify-reset-code')
    expect(await screen.findByRole('heading', { name: 'Forgot Password' })).toBeInTheDocument()
  })
})
