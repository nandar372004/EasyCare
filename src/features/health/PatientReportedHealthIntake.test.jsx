import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PatientReportedHealthIntake } from './PatientReportedHealthIntake.jsx'

const api = vi.hoisted(() => ({
  record: { bloodType: 'Unknown', bloodTypeSource: 'legacy_patient_profile', bloodTypeVerificationStatus: 'unverified', items: [] },
  get: vi.fn(), add: vi.fn(), update: vi.fn(), archive: vi.fn(), saveBlood: vi.fn(), addVaccination: vi.fn(), updateVaccination: vi.fn(),
}))
vi.mock('../../services/patientReportedHealthService.js', () => ({
  getMyReportedHealthIntake: (...args) => api.get(...args),
  addMyReportedHealthItem: (...args) => api.add(...args),
  updateMyReportedHealthItem: (...args) => api.update(...args),
  addMyReportedVaccination: (...args) => api.addVaccination(...args),
  updateMyReportedVaccination: (...args) => api.updateVaccination(...args),
  archiveMyReportedHealthItem: (...args) => api.archive(...args),
  saveMyReportedBloodType: (...args) => api.saveBlood(...args),
}))

beforeEach(() => {
  api.record = { bloodType: 'Unknown', bloodTypeSource: 'legacy_patient_profile', bloodTypeVerificationStatus: 'unverified', items: [] }
  api.get.mockReset().mockImplementation(async () => api.record)
  api.add.mockReset().mockImplementation(async input => {
    api.record = { ...api.record, items: [...api.record.items, { id: 'reported-1', itemType: input.itemType, entryKind: input.entryKind, name: input.name, details: input.details, source: 'patient_reported', verificationStatus: 'unverified' }] }
    return api.record
  })
  api.update.mockReset().mockImplementation(async input => {
    api.record = { ...api.record, items: api.record.items.map(item => item.id === input.id ? { ...item, name: input.name, details: input.details } : item) }
    return api.record
  })
  api.archive.mockReset().mockImplementation(async id => {
    api.record = { ...api.record, items: api.record.items.filter(item => item.id !== id) }
    return api.record
  })
  api.saveBlood.mockReset().mockImplementation(async bloodType => {
    api.record = { ...api.record, bloodType, bloodTypeSource: 'patient_reported' }
    return api.record
  })
  api.addVaccination.mockReset().mockImplementation(async input => {
    api.record = { ...api.record, items: [...api.record.items, { id: 'vaccination-1', itemType: 'vaccination', entryKind: 'item', name: input.name, details: { dateGiven: input.dateGiven, doseNumber: input.doseNumber, location: input.location, notes: input.notes }, source: 'patient_reported', verificationStatus: 'unverified' }] }
    return api.record
  })
  api.updateVaccination.mockReset().mockImplementation(async input => {
    api.record = { ...api.record, items: api.record.items.map(item => item.id === input.id ? { ...item, name: input.name, details: { dateGiven: input.dateGiven, doseNumber: input.doseNumber, location: input.location, notes: input.notes } } : item) }
    return api.record
  })
})

describe('patient-reported health intake', () => {
  it('adds, edits, and removes an explicitly unverified patient allergy', async () => {
    const user = userEvent.setup()
    render(<PatientReportedHealthIntake />)
    await screen.findByRole('heading', { name: 'Health Information' })
    await user.type(screen.getByLabelText('Allergen'), 'Penicillin')
    await user.type(screen.getByLabelText('Reaction'), 'Rash')
    await user.click(screen.getByRole('button', { name: 'Add allergy' }))
    expect(await screen.findByText('Penicillin')).toBeInTheDocument()
    expect(screen.getByText('Reported by you · not reviewed')).toBeInTheDocument()
    expect(api.add).toHaveBeenCalledWith({ itemType: 'allergy', entryKind: 'item', name: 'Penicillin', details: { reaction: 'Rash' } })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const nameInput = screen.getAllByLabelText('Allergen')[0]
    await user.clear(nameInput); await user.type(nameInput, 'Penicillin (updated)')
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(await screen.findByText('Penicillin (updated)')).toBeInTheDocument()
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'reported-1', name: 'Penicillin (updated)' }))

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Penicillin (updated)')).not.toBeInTheDocument())
    expect(api.archive).toHaveBeenCalledWith('reported-1')
  })

  it('supports unknown blood type and none-known markers without implying confirmation', async () => {
    const user = userEvent.setup()
    render(<PatientReportedHealthIntake />)
    await screen.findByRole('heading', { name: 'Health Information' })
    await user.selectOptions(screen.getByLabelText('Blood type'), 'Unknown')
    await user.click(screen.getByRole('button', { name: 'Save blood type' }))
    expect(api.saveBlood).toHaveBeenCalledWith('Unknown')
    const noneKnown = screen.getAllByRole('button', { name: 'None known', exact: true })[0]
    expect(noneKnown).toHaveClass('health-intake-action')
    noneKnown.focus()
    expect(noneKnown).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.add).toHaveBeenCalledWith({ itemType: 'allergy', entryKind: 'none_known', name: null, details: {} })
    expect(await screen.findByText('You reported none known.')).toBeInTheDocument()
    expect(screen.getByText('Patient-reported · not verified')).toBeInTheDocument()
  })

  it('shows confirmed reports as read-only and exposes no edit/remove controls', async () => {
    api.record.items = [{ id: 'reviewed-1', itemType: 'condition', entryKind: 'item', name: 'Hypertension', details: {}, source: 'patient_reported', verificationStatus: 'confirmed' }]
    render(<PatientReportedHealthIntake />)
    await screen.findByText('Hypertension')
    expect(screen.getByText('Reported by you · reviewed: confirmed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('adds, edits, and removes patient-reported vaccinations with date and optional details', async () => {
    const user = userEvent.setup()
    render(<PatientReportedHealthIntake />)
    await screen.findByRole('heading', { name: 'Health Information' })
    await user.type(screen.getByLabelText('Vaccine Name'), 'Seasonal influenza')
    await user.type(screen.getByLabelText('Dose / Dose Number'), 'Dose 1')
    await user.type(screen.getByLabelText('Date Given'), '2026-10-01')
    await user.type(screen.getByLabelText('Location / Clinic'), 'Community clinic')
    await user.type(screen.getByLabelText('Notes'), 'No reaction noted')
    await user.click(screen.getByRole('button', { name: 'Add vaccination' }))
    expect(await screen.findByText('Seasonal influenza')).toBeInTheDocument()
    expect(screen.getByText('Patient-reported · not verified')).toBeInTheDocument()
    expect(screen.getByText('Dose / Dose Number: Dose 1')).toBeInTheDocument()
    expect(api.addVaccination).toHaveBeenCalledWith({ name: 'Seasonal influenza', doseNumber: 'Dose 1', dateGiven: '2026-10-01', location: 'Community clinic', notes: 'No reaction noted' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const editName = screen.getAllByLabelText('Vaccine Name')[0]
    await user.clear(editName); await user.type(editName, 'Influenza vaccine')
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))
    expect(await screen.findByText('Influenza vaccine')).toBeInTheDocument()
    expect(api.updateVaccination).toHaveBeenCalledWith(expect.objectContaining({ id: 'vaccination-1', name: 'Influenza vaccine', dateGiven: '2026-10-01' }))

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('Influenza vaccine')).not.toBeInTheDocument())
    expect(api.archive).toHaveBeenCalledWith('vaccination-1')
  })

  it('requires a valid date before saving a vaccination', async () => {
    const user = userEvent.setup()
    render(<PatientReportedHealthIntake />)
    await screen.findByRole('heading', { name: 'Health Information' })
    await user.type(screen.getByLabelText('Vaccine Name'), 'Tetanus')
    await user.type(screen.getByLabelText('Date Given'), '2026-02-30')
    await user.click(screen.getByRole('button', { name: 'Add vaccination' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid date given.')
    expect(api.addVaccination).not.toHaveBeenCalled()
  })

  it('shows an empty vaccination state without implying the patient has none', async () => {
    render(<PatientReportedHealthIntake />)
    await screen.findByRole('heading', { name: 'Vaccinations' })
    expect(screen.getByText('No vaccinations reported.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vaccinations' }).closest('section')).not.toHaveTextContent(/clinician-confirmed|verified|admin-approved/i)
  })
})
