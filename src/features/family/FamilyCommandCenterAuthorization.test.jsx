import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FamilyCommandCenterPage } from './FamilyCommandCenterPage.jsx'
import { deriveFamilyCommandCenter } from '../../services/familyCommandCenterService.js'
const { auth, load } = vi.hoisted(() => ({ auth: { status: 'authenticated', user: { id: 'viewer' }, patient: { id: 'owner', full_name: 'Me', date_of_birth: '1990-01-01' } }, load: vi.fn() }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../../services/familyCommandCenterService.js', async importOriginal => ({ ...await importOriginal(), familyCommandCenterService: { load } }))
const now = new Date('2026-10-08T05:00:00Z')
const own = { member: { patient_id: 'owner', display_name: 'Me' }, sections: {} }
const family = { member: { patient_id: 'mother', display_name: 'Mother', member_id: 'm', groupId: 'g' }, sections: { appointments: { status: 'ready', data: [{ id: 'a', status: 'pending', scheduledStart: '2026-10-09T05:00:00Z' }] } } }
const model = withFamily => deriveFamilyCommandCenter('owner', withFamily ? [own, family] : [own], now)
const page = () => <MemoryRouter><FamilyCommandCenterPage /></MemoryRouter>
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { vi.resetAllMocks(); auth.status = 'authenticated'; auth.user = { id: 'viewer' }; auth.patient = { id: 'owner', full_name: 'Me', date_of_birth: '1990-01-01' } })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('command center authorization lifecycle', () => {
  it('loads once with zero extra requests after 60 seconds, focus and visibility changes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    load.mockResolvedValue(model(true))
    render(page())
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: 'Show care details for Mother' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(load).toHaveBeenCalledTimes(1)
    for (const event of ['focus', 'blur', 'focus']) fireEvent(window, new Event(event))
    for (const value of ['hidden', 'visible']) {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value)
      fireEvent(document, new Event('visibilitychange'))
    }
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: 'Care details for Mother' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading family health overview' })).not.toBeInTheDocument()
  })
  it('does not show a Refresh button', async () => {
    load.mockResolvedValue(model(false))
    render(page())
    await screen.findByRole('heading', { name: 'Me' })
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
  })
  it('route leave and return loads once again after managing family sharing', async () => {
    load.mockResolvedValueOnce(model(true)).mockResolvedValueOnce(model(false))
    const view = render(page())
    await screen.findByRole('heading', { name: 'Mother' })
    view.rerender(<MemoryRouter><div>Manage Health Circle</div></MemoryRouter>)
    expect(load).toHaveBeenCalledTimes(1)
    view.rerender(page())
    await screen.findByRole('heading', { name: 'Me' })
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('heading', { name: 'Mother' })).not.toBeInTheDocument()
  })
  it('Try Again causes exactly one new load',async()=>{
    load.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(model(false))
    render(page())
    fireEvent.click(await screen.findByRole('button',{name:'Try again'}))
    await screen.findByRole('heading',{name:'Me'})
    expect(load).toHaveBeenCalledTimes(2)
  })
  it.each(['2026-10-08T04:59:59Z','1970-01-01T00:00:00Z','invalid'])('does not display invalid/expired responses or loop on expiry %s',async accessExpiresAt=>{
    vi.useFakeTimers(); vi.setSystemTime(now)
    load.mockResolvedValue({...model(true),accessExpiresAt})
    render(page())
    await act(async()=>{await Promise.resolve()})
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading',{name:'Mother'})).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
  it('discards an older response after leaving and reopening the route', async () => {
    const stale = deferred()
    load.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(model(false))
    const view = render(page())
    view.rerender(<MemoryRouter><div>Another page</div></MemoryRouter>)
    view.rerender(page())
    await screen.findByRole('heading', { name: 'Me' })
    await act(async () => stale.resolve(model(true)))
    expect(screen.queryByRole('heading', { name: 'Mother' })).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('clears expired member data at the exact existing grant expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    load.mockResolvedValueOnce({ ...model(true), accessExpiresAt: new Date(+now + 1000).toISOString() }).mockResolvedValueOnce(model(false))
    render(page())
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('heading', { name: 'Mother' })).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.queryByRole('heading', { name: 'Mother' })).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Shared access has expired/)).toBeInTheDocument()
  })
  it('remounts private state on account switch and does not refetch for an equivalent patient object', async () => {
    const switched = deferred()
    load.mockResolvedValueOnce(model(true)).mockReturnValueOnce(switched.promise)
    const view = render(page())
    await screen.findByRole('heading', { name: 'Mother' })
    auth.patient = { ...auth.patient, full_name: 'Updated name' }
    view.rerender(page())
    expect(load).toHaveBeenCalledTimes(1)
    auth.user = { id: 'other-viewer' }; auth.patient = { id: 'other-owner', full_name: 'Other', date_of_birth: '1990-01-01' }
    view.rerender(page())
    expect(screen.queryByRole('heading', { name: 'Mother' })).not.toBeInTheDocument()
    auth.status = 'anonymous'; auth.user = null; auth.patient = null
    view.rerender(page())
    await act(async () => switched.resolve(model(true)))
    expect(screen.queryByRole('heading', { name: 'Mother' })).not.toBeInTheDocument()
  })
})
