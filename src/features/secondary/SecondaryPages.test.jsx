import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { HealthGuardianPage, LocationSosPage, MessagesPage, PaymentsPage } from './SecondaryPages.jsx'
import { LocalizationProvider } from '../localization/LocalizationContext.jsx'

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

  it('shows truthful payment presentation labels and no card input', () => {
    renderRoute(<PaymentsPage />)
    expect(screen.getByText('Presentation Demo — No Real Payment')).toBeInTheDocument()
    expect(screen.getByText('Card ending 4242')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('searches conversations and sends only a local presentation message', () => {
    renderRoute(<MessagesPage />)
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'coordinator' } })
    expect(screen.getByRole('button', { name: /EasyCare Care Coordinator/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /EasyCare Care Coordinator/ }))
    fireEvent.change(screen.getByLabelText('Presentation message'), { target: { value: 'Hello demo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send locally' }))
    expect(screen.getByText('Local presentation message — not delivered')).toBeInTheDocument()
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

  it('filters the synthetic facility list', () => {
    renderRoute(<LocationSosPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Pharmacy' }))
    expect(screen.getByText('HealthPlus Pharmacy')).toBeInTheDocument()
    expect(screen.queryByText('City Care Hospital')).not.toBeInTheDocument()
  })
})
