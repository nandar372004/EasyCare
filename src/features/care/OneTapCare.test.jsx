import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { bookingReason, CARE_INTENTS, OneTapCarePage, OneTapCareProvider, useOneTapCare } from './OneTapCare.jsx'
const { auth } = vi.hoisted(() => ({ auth: { user: { id: 'auth-a' }, patient: { id: 'patient-a', full_name: 'Patient A' } } }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
function Draft() { const { draft } = useOneTapCare(); return <p>{draft ? JSON.stringify(draft) : 'No draft'}</p> }
const view = () => <MemoryRouter initialEntries={['/care/start']}><OneTapCareProvider><Routes><Route path="/care/start" element={<OneTapCarePage />} /><Route path="/doctors" element={<Draft />} /></Routes></OneTapCareProvider></MemoryRouter>
describe('One-Tap Care foundation', () => {
  it('stops at emergency guidance without exposing routine booking', () => {
    render(view()); fireEvent.click(screen.getByText('Yes, I need emergency help'))
    expect(screen.getByRole('alert')).toHaveTextContent('Do not wait for a routine appointment')
    expect(screen.queryByText('Choose a doctor')).not.toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
  })
  it('offers only Self, all five intents, and carries trimmed notes to discovery', () => {
    render(view()); expect(screen.getByText('Self')).toBeInTheDocument()
    fireEvent.click(screen.getByText('No, continue'))
    for (const intent of CARE_INTENTS) expect(screen.getByRole('option', { name: intent })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Care intent'), { target: { value: 'Medication question' } })
    const note = screen.getByLabelText('Optional patient note')
    expect(note).toHaveAttribute('maxlength', '1000')
    fireEvent.change(note, { target: { value: '  My question  ' } })
    fireEvent.click(screen.getByText('Choose a doctor'))
    expect(screen.getByText(/"note":"My question"/)).toBeInTheDocument()
  })
  it('merges context and existing reason deterministically without replacing either', () => {
    expect(bookingReason({ intent: 'Medication question', note: ' note ' }, ' existing ')).toBe('Care request: Medication question\n\nPatient note:\nnote\n\nAdditional booking reason:\nexisting')
    expect(bookingReason(null, ' existing ')).toBe('existing')
    expect(bookingReason({ intent: 'Follow-up care', note: ' ' })).toBe('Care request: Follow-up care')
  })
  it('clears the draft synchronously when the authenticated account changes or logs out', () => {
    function Editor() { const { draft, setDraft } = useOneTapCare(); return <><button onClick={() => setDraft({ intent: 'Follow-up care', note: 'Private A' })}>Set draft</button><p>{draft?.note || 'No draft'}</p></> }
    const tree = () => <MemoryRouter initialEntries={['/doctors']}><OneTapCareProvider><Editor /></OneTapCareProvider></MemoryRouter>
    const result = render(tree())
    fireEvent.click(screen.getByText('Set draft')); expect(screen.getByText('Private A')).toBeInTheDocument()
    auth.user = { id: 'auth-b' }; auth.patient = { id: 'patient-b' }
    result.rerender(tree()); expect(screen.getByText('No draft')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Set draft'))
    auth.user = null; auth.patient = null
    result.rerender(tree()); expect(screen.getByText('No draft')).toBeInTheDocument()
    auth.user = { id: 'auth-a' }; auth.patient = { id: 'patient-a', full_name: 'Patient A' }
  })
  it('keeps context across doctor routes, clears on abandonment, and keeps notes out of URLs', () => {
    function Navigation() { const { draft, setDraft, clear } = useOneTapCare(); const location = useLocation(); return <><button onClick={() => setDraft({ intent: 'Follow-up care', note: 'Private note' })}>Save</button><Link to="/doctors/provider?book=1">Provider</Link><Link to="/dashboard">Leave</Link><button onClick={clear}>Cancel</button><p>{location.pathname}{location.search}</p><p>{draft?.note || 'No draft'}</p></> }
    render(<MemoryRouter initialEntries={['/doctors']}><OneTapCareProvider><Navigation /></OneTapCareProvider></MemoryRouter>)
    fireEvent.click(screen.getByText('Save')); fireEvent.click(screen.getByText('Provider'))
    expect(screen.getByText('Private note')).toBeInTheDocument()
    expect(screen.getByText('/doctors/provider?book=1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Leave')); expect(screen.getByText('No draft')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Provider')); fireEvent.click(screen.getByText('Save')); fireEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText('No draft')).toBeInTheDocument()
  })
})
