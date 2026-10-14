import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { HealthGuardianPage, LocationSosPage, MessagesPage, PaymentsPage } from './SecondaryPages.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'
import { facilities, googleMapsEmbedUrl, nearbyMandalayFacilities } from './secondaryFixtures.js'

const { supportService } = vi.hoisted(() => ({ supportService: {
  getOrCreatePatientConversation: vi.fn(), listPatientMessages: vi.fn(), sendPatientMessage: vi.fn(),
  subscribePatientConversation: vi.fn(() => () => {}),
} }))
vi.mock('../../services/supportMessagingService.js', () => ({ supportMessagingService: supportService }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'patient-profile' } }) }))

const renderRoute = (node) => render(<LocalizationProvider><MemoryRouter>{node}</MemoryRouter></LocalizationProvider>)

describe('secondary presentation pages', () => {
  it('overrides booking with an emergency call action', async () => {
    renderRoute(<HealthGuardianPage />)
    fireEvent.change(screen.getByLabelText('Describe symptoms'), { target: { value: 'chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check scenario' }))
    expect(await screen.findByText('Emergency red flags override routine booking.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Book Appointment' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call Emergency' })).toHaveAttribute('href', 'tel:192')
  })

  it('uses neutral payment wording and keeps payment processing disabled', () => {
    renderRoute(<PaymentsPage />)
    expect(screen.getByText('Payment Overview')).toBeInTheDocument()
    expect(screen.getByText('Current Plan')).toBeInTheDocument()
    expect(screen.getByText('Payment method')).toBeInTheDocument()
    expect(screen.getByText('Payment History')).toBeInTheDocument()
    expect(screen.getByText('INV-2045')).toBeInTheDocument()
    expect(screen.getByText('INV-2019')).toBeInTheDocument()
    expect(screen.getByText('INV-1988')).toBeInTheDocument()
    expect(screen.getAllByText('Paid')).toHaveLength(2)
    expect(screen.getByText('Refunded')).toBeInTheDocument()
    expect(screen.getByText('Payment processing is not enabled in this version.')).toBeInTheDocument()
    expect(screen.getByText('Card ending 4242')).toBeInTheDocument()
    expect(screen.queryByText(/demo|synthetic|presentation|simulated/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('refreshes from private realtime hints and sends persisted Care Coordinator messages', async () => {
    let realtimeMessage
    const unsubscribe = vi.fn()
    supportService.subscribePatientConversation.mockImplementation((_id, onMessage) => { realtimeMessage = onMessage; return unsubscribe })
    supportService.getOrCreatePatientConversation.mockResolvedValue([{ conversation_id: 'conversation-1' }])
    const adminMessage = { message_id: 'message-1', body: 'Hello patient', sender_is_patient: false, created_at: '2026-10-12T00:00:00Z' }
    const patientMessage = { message_id: 'message-2', body: 'Thanks', sender_is_patient: true, created_at: '2026-10-12T00:01:00Z' }
    supportService.listPatientMessages.mockResolvedValueOnce([]).mockResolvedValueOnce([adminMessage]).mockResolvedValueOnce([adminMessage]).mockResolvedValueOnce([adminMessage, patientMessage])
    supportService.sendPatientMessage.mockResolvedValue([{ message_id: 'message-1' }])
    renderRoute(<MessagesPage />)
    expect(await screen.findByText('Chat with your Care Coordinator')).toBeInTheDocument()
    expect(screen.getAllByText('EasyCare Care Support')).toHaveLength(2)
    expect(screen.getByText('Messages').closest('header')).toHaveClass('messages-page-header')
    expect(screen.queryByText(/synthetic|presentation|local/i)).not.toBeInTheDocument()
    expect(supportService.subscribePatientConversation).toHaveBeenCalledWith('conversation-1', expect.any(Function), expect.any(Function))
    realtimeMessage({ conversation_id: 'conversation-1' })
    expect(await screen.findByText('Hello patient')).toBeInTheDocument()
    realtimeMessage({ conversation_id: 'conversation-1' })
    expect(await screen.findByText('Hello patient')).toBeInTheDocument()
    expect(screen.getAllByText('Hello patient')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Message your Care Coordinator'), { target: { value: '  Thanks  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Thanks')).toBeInTheDocument()
    expect(supportService.sendPatientMessage).toHaveBeenCalledWith('conversation-1', 'Thanks')
    expect(supportService.getOrCreatePatientConversation).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('requires deliberate SOS confirmation and allows ending simulation', () => {
    renderRoute(<LocationSosPage />)
    expect(screen.getByText('No real dispatch or live location sharing is connected.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start SOS simulation' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This will not dispatch help')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm simulation' }))
    expect(screen.getByRole('status')).toHaveTextContent('Simulated SOS active')
    fireEvent.click(screen.getByRole('button', { name: 'End simulated SOS' }))
    expect(screen.queryByText('Simulated SOS active')).not.toBeInTheDocument()
  })

  it('defaults the map to Mandalay and lists only Mandalay care', () => {
    renderRoute(<LocationSosPage />)
    const map = screen.getByTitle('Google map showing nearby care around Mandalay')
    expect(map).toHaveAttribute('src', googleMapsEmbedUrl(nearbyMandalayFacilities(facilities), 'All'))
    expect(decodeURIComponent(map.getAttribute('src'))).toMatch(/Mandalay/)
    expect(decodeURIComponent(map.getAttribute('src'))).not.toMatch(/Yangon/)
    expect(screen.getByRole('heading', { name: 'Nearby Care in Mandalay' })).toBeInTheDocument()
    expect(screen.queryByText('Yangon General Hospital')).not.toBeInTheDocument()
    const listed = nearbyMandalayFacilities(facilities)
    expect(listed.length).toBeGreaterThan(0)
    listed.forEach((facility) => {
      expect(screen.getByText(facility.name)).toBeInTheDocument()
      expect(screen.getByLabelText(`Map marker for ${facility.name}`)).toBeInTheDocument()
      expect(screen.getByLabelText(`Directions to ${facility.name}`)).toHaveAttribute('href', expect.stringContaining('Mandalay'))
    })
    expect(screen.getAllByLabelText(/Map marker for /)).toHaveLength(listed.length)
  })

  it.each([
    ['Hospitals', 'Hospital'],
    ['Clinics', 'Clinic'],
    ['Pharmacies', 'Pharmacy'],
    ['Labs', 'Lab'],
  ])('keeps the %s filter, list, and map in Mandalay', (label, type) => {
    renderRoute(<LocationSosPage />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    const listed = nearbyMandalayFacilities(facilities, { type })
    const hidden = nearbyMandalayFacilities(facilities).filter((facility) => facility.type !== type)
    listed.forEach((facility) => {
      expect(screen.getByText(facility.name)).toBeInTheDocument()
      expect(screen.getByLabelText(`Map marker for ${facility.name}`)).toBeInTheDocument()
    })
    hidden.forEach((facility) => {
      expect(screen.queryByText(facility.name)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(`Map marker for ${facility.name}`)).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Yangon General Hospital')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/Map marker for /)).toHaveLength(listed.length)
    const map = screen.getByTitle('Google map showing nearby care around Mandalay')
    expect(map).toHaveAttribute('src', googleMapsEmbedUrl(listed, type))
    expect(decodeURIComponent(map.getAttribute('src'))).toMatch(/Mandalay/)
    expect(decodeURIComponent(map.getAttribute('src'))).not.toMatch(/Yangon/)
  })

  it('searches only Mandalay facilities and keeps markers in sync', () => {
    renderRoute(<LocationSosPage />)
    fireEvent.change(screen.getByLabelText('Search nearby care in Mandalay'), { target: { value: 'Pharmacy' } })
    expect(screen.getByText('AA Pharmacy Mandalay')).toBeInTheDocument()
    expect(screen.getByText('City Mart Pharmacy Mandalay')).toBeInTheDocument()
    expect(screen.queryByText('Mandalay General Hospital')).not.toBeInTheDocument()
    expect(screen.queryByText('Yangon General Hospital')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText(/Map marker for /)).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Search nearby care in Mandalay'), { target: { value: 'Yangon' } })
    expect(screen.getByText('No nearby care of this type in Mandalay.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Map marker for /)).not.toBeInTheDocument()
    expect(decodeURIComponent(screen.getByTitle('Google map showing nearby care around Mandalay').getAttribute('src'))).toMatch(/Mandalay/)
  })
})
