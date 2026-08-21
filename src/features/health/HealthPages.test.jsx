import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HealthRecordsPage, LabResultsPage, MedicationsPage, PrescriptionsPage } from './HealthPages.jsx'

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ patient: { id: '51000000-0000-4000-8000-000000000001' }, status: 'authenticated' }) }))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: { listMedications: vi.fn().mockResolvedValue([
  { id: 'med-1', name: 'Demo Paracetamol', dosage: '500 mg', frequency: 'Twice daily', instructions: 'Synthetic record', status: 'active', schedules: [] },
  { id: 'med-2', name: 'Demo Vitamin B Complex', dosage: '1 tablet', frequency: 'Once daily', instructions: 'Synthetic record', status: 'completed', schedules: [] },
]) } }))

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
    fireEvent.click(screen.getByRole('button', { name: /Download Prescription/ }))
    expect(screen.getByRole('status')).toHaveTextContent('No document was generated')
  })

  it('states that lab results require clinician interpretation', () => {
    render(<LabResultsPage />)
    expect(screen.getByText(/Lab results require interpretation by a qualified clinician/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'View Details' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('cannot be used for medical decisions')
  })

  it('loads authenticated read-only medication records', async () => {
    render(<MedicationsPage />)
    expect(await screen.findByText('Demo Paracetamol')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Taken|Pending/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Medication History' }))
    expect(screen.getByText('Demo Vitamin B Complex')).toBeInTheDocument()
  })
})
