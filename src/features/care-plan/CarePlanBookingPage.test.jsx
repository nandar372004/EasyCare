import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CarePlanPage } from './CarePlanPage.jsx'

const { auth, familyMocks, catalogMocks, bookingMocks } = vi.hoisted(() => ({
  auth: { status: 'authenticated', patient: { id: 'ec900000-0000-4000-8000-000000000101', full_name: 'Nandar Kyaw' }, user: { id: 'ec900000-0000-4000-8000-000000000001' } },
  familyMocks: { getGroups: vi.fn(), getMembers: vi.fn() },
  catalogMocks: { listPackages: vi.fn(), quote: vi.fn() },
  bookingMocks: { createBooking: vi.fn() },
}))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/familyHealthService.js', () => ({ familyHealthService: familyMocks }))
vi.mock('../../services/carePlanCatalogService.js', () => ({ carePlanCatalogService: catalogMocks }))
vi.mock('../../services/carePlanBookingService.js', () => ({ carePlanBookingService: bookingMocks }))

const packageId = 'ec000000-0000-4000-8000-000000000001'
const serviceId = 'ec100000-0000-4000-8000-000000000001'
const recipientId = 'ec900000-0000-4000-8000-000000000101'
const familyRecipient = {
  member_id: 'ec900000-0000-4000-8000-000000000211',
  patient_id: 'ec900000-0000-4000-8000-000000000103',
  display_name: 'U Kyaw Aung Moe', relationshipLabel: 'Father', is_self: false,
  authorization: { status: 'active', expires_at: '2099-01-01T00:00:00Z', appointments: true, payments: true },
}

beforeEach(() => {
  auth.patient = { id: recipientId, full_name: 'Nandar Kyaw' }
  auth.user = { id: 'ec900000-0000-4000-8000-000000000001' }
  familyMocks.getGroups.mockReset().mockResolvedValue([])
  familyMocks.getMembers.mockReset().mockResolvedValue([])
  catalogMocks.listPackages.mockReset().mockResolvedValue([{
    id: packageId, code: 'basic-elderly', name: 'Basic Elderly Care', allowedDurationDays: [1, 3, 7, 14, 30],
    levels: [{ id: serviceId, code: 'nurse-aide', name: 'Nurse Aide', unitPrice: 36000, currency: 'MMK' }],
  }])
  catalogMocks.quote.mockReset().mockImplementation(async (_package, _service, days) => ({
    package_id: packageId, package_name: 'Basic Elderly Care', service_id: serviceId,
    care_level_name: 'Nurse Aide', duration_days: days, unit_price: '36000.00',
    subtotal: String(36000 * days), commission_percent: '17', provider_amount: String(Math.round(36000 * days * .83)),
    commission_amount: String(36000 * days - Math.round(36000 * days * .83)), currency: 'MMK',
  }))
  bookingMocks.createBooking.mockReset().mockResolvedValue({ care_request_id: 'ec900000-0000-4000-8000-000000000901', subtotal: '108000.00' })
})
afterEach(() => cleanup())

async function reviewSelfBooking() {
  render(<MemoryRouter><CarePlanPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('radio', { name: /Basic Elderly Care/ }))
  await screen.findByText('Choose your care level')
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Choose duration')
  fireEvent.click(screen.getByRole('radio', { name: /3 Days/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Preferred schedule')
  fireEvent.change(screen.getByLabelText('Preferred start date'), { target: { value: '2026-10-20' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(await screen.findByRole('radio', { name: /Nandar Kyaw.*Myself/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Home address'), { target: { value: 'No. 10 Example Street' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByText('Requested by')).toBeInTheDocument()
  expect(screen.getByText('Nandar Kyaw — Myself')).toBeInTheDocument()
}

describe('real Home Care booking flow', () => {
  it('submits a self booking using only recipient, catalog IDs, duration and request details', async () => {
    await reviewSelfBooking()
    expect(screen.getAllByText('Basic Elderly Care').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Nurse Aide').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3 Days').length).toBeGreaterThan(0)
    expect(screen.getAllByText('108,000 MMK').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Request Home Care' }))
    expect(await screen.findByText('Your Home Care request has been sent.')).toBeInTheDocument()
    expect(bookingMocks.createBooking).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      recipientPatientId: recipientId, packageId, serviceId, durationDays: 3,
      preferredDate: '2026-10-20', preferredTime: '09:00',
      address: 'No. 10 Example Street', reasonSymptoms: '',
    }))
    const submitted = bookingMocks.createBooking.mock.calls[0][0]
    expect(submitted.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(submitted).not.toHaveProperty('requestedByProfileId')
    expect(submitted).not.toHaveProperty('price')
    expect(submitted).not.toHaveProperty('subtotal')
    expect(submitted).not.toHaveProperty('commission')
    expect(screen.getByRole('button', { name: 'Request sent' })).toBeDisabled()
  })

  it('returns to recipient selection when the backend says family permission has expired or been revoked', async () => {
    familyMocks.getGroups.mockResolvedValue([{ id: 'group-a' }])
    familyMocks.getMembers
      .mockResolvedValueOnce([familyRecipient])
      .mockResolvedValueOnce([familyRecipient])
      .mockResolvedValueOnce([familyRecipient])
      .mockResolvedValueOnce([])
    bookingMocks.createBooking.mockRejectedValue(Object.assign(
      new Error('You no longer have permission to book care for this family member.'), { code: '42501' },
    ))

    render(<MemoryRouter><CarePlanPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('radio', { name: /Basic Elderly Care/ }))
    await screen.findByText('Choose your care level')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Choose duration')
    fireEvent.click(screen.getByRole('radio', { name: /3 Days/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Preferred schedule')
    fireEvent.change(screen.getByLabelText('Preferred start date'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('radio', { name: /U Kyaw Aung Moe.*Father/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Home address'), { target: { value: 'No. 10 Example Street' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Request Home Care' }))

    expect(await screen.findByText('You no longer have permission to book care for this family member.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Nandar Kyaw.*Myself/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('radio', { name: /U Kyaw Aung Moe.*Father/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Request Professional Home Care' })).toBeInTheDocument()
  })

  it('disables the confirmation button while the RPC is pending', async () => {
    let finish
    bookingMocks.createBooking.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await reviewSelfBooking()
    const button = screen.getByRole('button', { name: 'Request Home Care' })
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sending request…' })).toBeDisabled())
    expect(bookingMocks.createBooking).toHaveBeenCalledTimes(1)
    finish({ care_request_id: 'ec900000-0000-4000-8000-000000000901', subtotal: '108000.00' })
    expect(await screen.findByText('Your Home Care request has been sent.')).toBeInTheDocument()
  })
})
