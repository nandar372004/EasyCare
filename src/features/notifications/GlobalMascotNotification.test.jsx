import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GlobalMascotNotification } from './GlobalMascotNotification.jsx'
import { CervicalWellnessReminders } from './CervicalWellnessReminders.jsx'

const { auth, state, markRead } = vi.hoisted(() => ({ auth: {}, state: { notifications: [], refresh: vi.fn() }, markRead: vi.fn() }))
vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('./NotificationContext.jsx', () => ({ useNotifications: () => state }))
vi.mock('../../services/notificationService.js', () => ({ notificationService: { markRead, persistDailyCervicalWellness: async()=>10 } }))
const notice = (id,type='medication') => ({ id,type,title:`Message ${id}`,body:`Body ${id}`,status:'sent',read_at:null,source_type:'medication_daily' })
function Path() { const location=useLocation(); return <p data-testid="route">{location.pathname}{location.hash}</p> }
const app=()=> <MemoryRouter initialEntries={['/dashboard']}><GlobalMascotNotification><Path /></GlobalMascotNotification></MemoryRouter>
beforeEach(()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']})
  auth.status='authenticated'; auth.workspace='patient'; auth.user={id:'owner'}
  state.notifications=[]; state.loading=false; state.refresh.mockReset().mockResolvedValue(); markRead.mockReset().mockResolvedValue()
})
afterEach(()=>{cleanup();vi.useRealTimers()})
it('shows actual arrival text through the refreshed notification list with one mascot',()=>{
  const view=render(app())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  state.notifications=[notice('one')];view.rerender(app())
  expect(screen.getByText('Message one')).toBeInTheDocument()
  expect(screen.getByText('Body one')).toBeInTheDocument()
  expect(screen.getByText('EasyCare Notification')).toBeInTheDocument()
  expect(document.querySelector('.mascot-card')).toBeInTheDocument()
  expect(document.querySelector('.mascot-elephant')).toHaveAttribute('src','/easycare-clover-elephant.png')
  expect(document.querySelectorAll('.mascot-elephant')).toHaveLength(1)
  view.rerender(app())
  expect(document.querySelectorAll('.mascot-elephant')).toHaveLength(1)
})
it('keeps a long Burmese wellness preview and controls inside the notification card',()=>{
  const longBody = Array.from({ length: 48 }, () => 'လည်ပင်းလေ့ကျင့်ခန်းလုပ်ဖို့ မမေ့နော်။').join(' ')
  state.notifications = [{ ...notice('wellness-burmese', 'wellness_check'), title: 'ဒီနေ့ ကျန်းမာရေး သတိပေးချက်', body: longBody }]
  render(app())
  const card = document.querySelector('.mascot-card')
  expect(card).toHaveTextContent('ဒီနေ့ ကျန်းမာရေး သတိပေးချက်')
  expect(card.querySelector('.mascot-body').textContent.endsWith('…')).toBe(true)
  expect(card.querySelector('.mascot-card-header .mascot-close')).toBeInTheDocument()
  expect(card.querySelector('.mascot-open')).toHaveTextContent('View')
})
it.each([
  ['wellness_check', 'Short wellness reminder'],
  ['medication', 'Medication reminder'],
  ['booking', 'Appointment reminder'],
  ['support_message', 'Support message'],
])('keeps %s notification content and action within the card', (type, title) => {
  state.notifications = [{ ...notice(`layout-${type}`, type), title, body: `Details for ${title}` }]
  render(app())
  const card = document.querySelector('.mascot-card')
  expect(card).toHaveTextContent(title)
  expect(card).toHaveTextContent(`Details for ${title}`)
  expect(card.querySelector('.mascot-open')).toHaveTextContent('View')
  expect(card.querySelector('.mascot-close')).toBeInTheDocument()
})
it('queues notifications, exits on dismissal, and preserves Notification Center unread data',()=>{
  state.notifications=[notice('two','booking'),notice('one','support_message')]
  const view=render(app())
  expect(screen.getByText('Message one')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Dismiss notification'}))
  expect(document.querySelector('.is-leaving')).toBeTruthy()
  act(()=>vi.advanceTimersByTime(350))
  expect(screen.getByText('Message two')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Dismiss notification'}))
  act(()=>vi.advanceTimersByTime(350))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
  view.rerender(app());act(()=>vi.advanceTimersByTime(1000))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
  expect(markRead).not.toHaveBeenCalled()
  expect(state.notifications).toHaveLength(2)
})
it('uses the existing read flow and safe route without duplicating across navigation',async()=>{
  state.notifications=[notice('one')];render(app())
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'View'})))
  expect(markRead).toHaveBeenCalledWith('one')
  expect(screen.getByTestId('route')).toHaveTextContent('/my-care-plan#care-my-medications')
  act(()=>vi.advanceTimersByTime(350))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
})
it('exits for externally read notifications and clears immediately on logout',()=>{
  state.notifications=[notice('one')];const view=render(app())
  state.notifications=[{...notice('one'),status:'read',read_at:'now'}];view.rerender(app())
  expect(document.querySelector('.is-leaving')).toBeTruthy()
  act(()=>vi.advanceTimersByTime(350))
  state.notifications=[notice('two')];view.rerender(app())
  auth.status='anonymous';view.rerender(app())
  expect(document.querySelector('.mascot-elephant')).toBeNull()
})
it('does not queue persistent cervical copies a second time',()=>{
  state.notifications=[{...notice('one','wellness_check'),source_type:'cervical_wellness'}]
  render(app())
  expect(document.querySelector('.mascot-elephant')).toBeNull()
})

it('keeps the arrival queue during authorized-list reloads',()=>{
  state.notifications=[notice('one')];const view=render(app())
  state.loading=true;state.notifications=[];view.rerender(app())
  expect(screen.getByText('Message one')).toBeInTheDocument()
  state.loading=false;state.notifications=[notice('one')];view.rerender(app())
  expect(screen.getByText('Message one')).toBeInTheDocument()
})

it('shares a single mascot with the immediate bilingual Nandar sequence on Messages',()=>{
  auth.role='patient'; auth.user={id:'presentation-owner'}
  auth.patient={id:'2d329d5b-9093-45ca-a980-97466d2a71eb',auth_user_id:auth.user.id,full_name:'Nandar Kyaw'}
  auth.session={access_token:`header.${btoa(JSON.stringify({session_id:'00000000-0000-4000-8000-000000999999'}))}.signature`}
  state.notifications=[notice('arrived'),{...notice('persisted','wellness_check'),source_type:'cervical_wellness'}]
  render(<MemoryRouter initialEntries={['/messages']}><GlobalMascotNotification><CervicalWellnessReminders /></GlobalMascotNotification></MemoryRouter>)
  expect(screen.getByText('How are you feeling today?')).toBeInTheDocument()
  const greeting = document.querySelector('.mascot-card-message')
  expect(greeting.children[0]).toHaveAttribute('lang', 'my')
  expect(greeting.children[0]).toHaveClass('mascot-title')
  expect(greeting.children[1]).toHaveAttribute('lang', 'en')
  expect(greeting.children[1]).toHaveClass('mascot-body')
  fireEvent.click(screen.getByRole('button', {name:'Dismiss notification'}))
  expect(document.querySelectorAll('.mascot-elephant')).toHaveLength(1)
  act(()=>vi.advanceTimersByTime(8000))
  expect(screen.getByText("Don't forget to take your medicine today")).toBeInTheDocument()
  expect(screen.getByText('ဒီနေ့ ဆေးသောက်ဖို့ မမေ့နော်')).toHaveClass('mascot-title')
  fireEvent.click(screen.getByRole('button', {name:'Dismiss notification'}))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
  act(()=>vi.advanceTimersByTime(7999))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
  act(()=>vi.advanceTimersByTime(1))
  expect(screen.getByText("Don't forget to do your neck exercises.")).toBeInTheDocument()
  expect(screen.getByText('လည်ပင်းလေ့ကျင့်ခန်း လုပ်ဖို့ မမေ့နော်')).toHaveClass('mascot-title')
  expect(screen.getByText("Don't forget to do your neck exercises.")).toHaveClass('mascot-body')
  fireEvent.click(screen.getByRole('button', {name:'Dismiss notification'}))
  act(()=>vi.advanceTimersByTime(80000))
  expect(document.querySelector('.mascot-elephant')).toBeNull()
  expect(markRead).not.toHaveBeenCalled()

})


