import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HealthRecordsPage, LabResultsPage, MedicationsPage, PrescriptionsPage } from './HealthPages.jsx'

describe('read-only health presentation pages', () => {
  it('filters health records and opens read-only details', () => {
    render(<HealthRecordsPage />)
    expect(screen.getByRole('heading', { name: 'Health Records' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allergy' }))
    expect(screen.getByText('Synthetic pollen sensitivity')).toBeInTheDocument()
    expect(screen.queryByText('Example immunization record')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    expect(screen.getByRole('dialog', { name: 'Synthetic pollen sensitivity' })).toBeInTheDocument()
  })

  it('blocks false prescription downloads', () => {
    render(<PrescriptionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /Download unavailable/ }))
    expect(screen.getByRole('status')).toHaveTextContent('No document was generated')
  })

  it('states that lab results require clinician interpretation', () => {
    render(<LabResultsPage />)
    expect(screen.getByText(/Lab results require interpretation by a qualified clinician/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('cannot be used for medical decisions')
  })

  it('keeps medication taken state local and reversible', () => {
    render(<MedicationsPage />)
    const pending = screen.getAllByRole('button', { name: 'Pending' })[0]
    fireEvent.click(pending)
    expect(screen.getAllByRole('button', { name: /Taken/ })[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getAllByRole('button', { name: /Taken/ })[0])
    expect(screen.getAllByRole('button', { name: 'Pending' })[0]).toHaveAttribute('aria-pressed', 'false')
  })
})
