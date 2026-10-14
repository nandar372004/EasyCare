import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorsPage } from './DoctorsPage.jsx'
const { repo, care } = vi.hoisted(() => ({ repo: { listDoctors: vi.fn(), listAvailabilitySlots: vi.fn() }, care: { draft: { intent: 'Medication question', note: 'Private note' }, clear: vi.fn() } }))
vi.mock('../../services/repositories/index.js', () => ({ presentationRepository: repo }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ patient: { id: 'self' }, user: { id: 'auth' } }) }))
vi.mock('../care/OneTapCare.jsx', async original => ({ ...await original(), useOneTapCare: () => care }))
const doctor = { id: 'provider', displayName: 'Actual Provider', specialty: 'Cardiology', consultationFeeMmk: 5000, consultationTypes: ['video'] }
function view(path = '/doctors') { return <MemoryRouter initialEntries={[path]}><Routes><Route path="/doctors" element={<DoctorsPage />} /><Route path="/doctors/:doctorId" element={<DoctorsPage />} /></Routes></MemoryRouter> }
beforeEach(() => { vi.resetAllMocks(); repo.listDoctors.mockResolvedValue([doctor]); repo.listAvailabilitySlots.mockResolvedValue([]) })
describe('Book Care discovery refinements', () => {
  it('retries in place and keeps the One-Tap context', async () => {
    repo.listDoctors.mockRejectedValueOnce(new Error('raw backend error'))
    render(view()); expect(await screen.findByRole('alert')).not.toHaveTextContent('raw backend error')
    fireEvent.click(screen.getByText('Try again'))
    await screen.findByText('Actual Provider')
    expect(screen.getByRole('heading', { name: 'Book Care' })).toBeInTheDocument()
    expect(await screen.findByText(/Care for: Self · Medication question/)).toBeInTheDocument()
    expect(care.clear).not.toHaveBeenCalled()
    expect(repo.listDoctors).toHaveBeenCalledTimes(2)
  })
  it('distinguishes no eligible providers from no search matches', async () => {
    const result = render(view())
    await screen.findByText('Actual Provider')
    fireEvent.change(screen.getByPlaceholderText('Search by name or specialty…'), { target: { value: 'Nobody' } })
    expect(screen.getByText('No providers match')).toBeInTheDocument()
    result.unmount(); repo.listDoctors.mockResolvedValue([]); render(view())
    expect(await screen.findByText('No providers available')).toBeInTheDocument()
  })
  it('shows context and an accessible unavailable CTA on a no-slot detail', async () => {
    render(view('/doctors/provider?book=1'))
    expect(await screen.findByText('No available appointment times')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book appointment' })).toBeDisabled()
    expect(screen.getByRole('complementary', { name: 'Your care request' })).toHaveTextContent('Private note')
    expect(screen.queryByText('Confirm booking')).not.toBeInTheDocument()
  })
})
