import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationsPage, notificationDestination } from './NotificationsPage.jsx'

const state = vi.hoisted(() => ({ notifications: [], unreadCount: 0, loading: false, error: '', refresh: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() }))
vi.mock('./NotificationContext.jsx', () => ({ useNotifications: () => state }))
vi.mock('../../services/notificationService.js', () => ({ notificationService: { markRead: (...args) => state.markRead(...args), markAllRead: (...args) => state.markAllRead(...args) } }))

function CurrentPath() { return <output data-testid="path">{useLocation().pathname}</output> }

describe('patient Notifications page', () => {
  beforeEach(() => {
    state.notifications = []
    state.unreadCount = 0
    state.loading = false
    state.error = ''
    state.refresh.mockReset().mockResolvedValue(undefined)
    state.markRead.mockReset().mockResolvedValue(undefined)
    state.markAllRead.mockReset().mockResolvedValue(undefined)
  })

  it('groups notifications and marks one read before following its safe source route', async () => {
    const messageId = '41000000-0000-4000-8000-000000000001'
    state.notifications = [{ id: 'n-1', type: 'support_message', title: 'New message from Care Coordinator', body: 'You have a new message.', created_at: '2026-10-12T02:00:00Z', status: 'sent', source_type: 'support_message', source_id: messageId }]
    state.unreadCount = 1
    render(<MemoryRouter initialEntries={['/notifications']}><Routes><Route path="/notifications" element={<NotificationsPage />} /><Route path="/messages" element={<CurrentPath />} /></Routes></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /New message from Care Coordinator/ }))
    await waitFor(() => expect(state.markRead).toHaveBeenCalledWith('n-1'))
    expect(state.refresh).toHaveBeenCalledOnce()
    expect(await screen.findByTestId('path')).toHaveTextContent('/messages')
  })

  it('marks all read through the service action', async () => {
    state.notifications = [{ id: 'n', type: 'care_action', title: 'A care item needs your attention', body: 'Please review your health dashboard.', created_at: '2026-10-11T02:00:00Z', status: 'sent', source_type: 'monitoring_alert', source_id: '41000000-0000-4000-8000-000000000002' }]
    state.unreadCount = 1
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(state.markAllRead).toHaveBeenCalledOnce())
    expect(state.refresh).toHaveBeenCalledOnce()
  })

  it('derives only known internal routes and rejects arbitrary stored destinations', () => {
    expect(notificationDestination({ type: 'wellness_check' })).toBe('/dashboard')
    expect(notificationDestination({ type: 'wellness_check', source_type: 'cervical_wellness' })).toBe('/my-care-plan')
    expect(notificationDestination({ type: 'wellness_check', source_type: 'cervical_wellness_medication' })).toBe('/my-care-plan#care-my-medications')
    for (const source_type of ['medication_daily', 'medication_done']) {
      expect(notificationDestination({ type: 'medication', source_type })).toBe('/my-care-plan#care-my-medications')
    }
    expect(notificationDestination({ type: 'booking', source_type: 'appointment_reminder', source_id: '41000000-0000-4000-8000-000000000003' })).toBe('/appointments/41000000-0000-4000-8000-000000000003')
    expect(notificationDestination({ type: 'booking', source_type: 'appointment_reminder', source_id: 'https://attacker.invalid' })).toBe('/appointments')
    expect(notificationDestination({ type: 'support_message', source_id: 'https://attacker.invalid' })).toBe('/messages')
    expect(notificationDestination({ type: 'booking', source_type: 'appointment', source_id: '41000000-0000-4000-8000-000000000003' })).toBe('/appointments/41000000-0000-4000-8000-000000000003')
    expect(notificationDestination({ type: 'care_action', source_type: 'monitoring_alert' })).toBe('/dashboard')
    expect(notificationDestination({ type: 'unknown', source_id: '41000000-0000-4000-8000-000000000003' })).toBe('/notifications')
  })
})
