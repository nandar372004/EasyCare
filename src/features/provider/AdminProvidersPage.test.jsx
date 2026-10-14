import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const service = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }))
vi.mock('../../services/adminProviderManagementService.js', () => ({ adminProviderManagementService: service }))
vi.mock('../auth/WorkspaceSwitcher.jsx', () => ({ WorkspaceSwitcher: () => <div /> }))

import { AdminProvidersPage } from './AdminProvidersPage.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Admin provider management', () => {
  it('offers only the four approved types and creates an email/password account', async () => {
    service.list.mockResolvedValue([])
    service.create.mockResolvedValue({ provider_id: 'provider-1' })
    render(<MemoryRouter><AdminProvidersPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }))
    const options = [...screen.getByLabelText('Provider type').options].map(option => option.textContent)
    expect(options).toEqual(['Doctor', 'Nurse Aide', 'Skilled Nurse Aide', 'Special Nurse'])

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'provider@example.test' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Provider' } })
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'SecureStart123' } })
    fireEvent.change(screen.getByLabelText('Confirm initial password'), { target: { value: 'SecureStart123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Provider' }))
    await waitFor(() => expect(service.create).toHaveBeenCalledWith({
      email: 'provider@example.test', displayName: 'Test Provider', providerType: 'doctor',
      initialPassword: 'SecureStart123', confirmInitialPassword: 'SecureStart123',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent(/account created/i)
  })
})
