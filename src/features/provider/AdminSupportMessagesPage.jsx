import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Send } from 'lucide-react'
import { supportMessagingService } from '../../services/supportMessagingService.js'
import { WorkspaceSwitcher } from '../auth/WorkspaceSwitcher.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import { useChatScroll } from '../messaging/useChatScroll.js'

const timeLabel = value => value ? new Date(value).toLocaleString() : 'No messages yet'

export function AdminSupportMessagesPage() {
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messageRequest = useRef(0)
  const refreshRef = useRef(null)
  const { scrollRef, onScroll } = useChatScroll(messages)

  const loadConversation = useCallback(async id => {
    const request = ++messageRequest.current
    try {
      const rows = await supportMessagingService.listAdminMessages(id)
      if (request === messageRequest.current) setMessages(Array.isArray(rows) ? rows : [])
    } catch {
      if (request === messageRequest.current) { setMessages([]); setError('Unable to refresh this conversation.') }
    }
  }, [])

  async function openConversation(id) {
    setSelectedId(id); setError('')
    await loadConversation(id)
  }

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await supportMessagingService.listAdminConversations() || []
      setConversations(rows)
      const nextId = rows.some(row => row.conversation_id === selectedId) ? selectedId : rows[0]?.conversation_id || ''
      if (nextId) { setSelectedId(nextId); await loadConversation(nextId) }
      else { messageRequest.current += 1; setSelectedId(''); setMessages([]) }
    } catch { setError('Unable to load support conversations.') }
    finally { setLoading(false) }
  }, [loadConversation, selectedId])
  refreshRef.current = refresh

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!user?.id) return undefined
    return supportMessagingService.subscribeAdminInbox(
      user.id,
      () => { void refreshRef.current?.() },
      status => { if (status === 'SUBSCRIBED') void refreshRef.current?.() },
    )
  }, [user?.id])

  async function sendReply(event) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || !selectedId || busy) return
    setBusy(true); setError('')
    try {
      await supportMessagingService.sendAdminReply(selectedId, body)
      setDraft('')
      await refresh()
    } catch { setError('Reply could not be sent. Please try again.') }
    finally { setBusy(false) }
  }

  const selected = conversations.find(row => row.conversation_id === selectedId)
  return <main className="admin-review-page admin-support-page">
    <nav className="admin-provider-nav" aria-label="Admin areas"><Link to="/admin/providers">Providers</Link><Link to="/admin/provider-applications">Application review</Link><Link to="/admin/support-messages" aria-current="page">Support Messages</Link><WorkspaceSwitcher /></nav>
    <header className="admin-review-heading"><div><span className="eyebrow">Authorized administration</span><h1>Support Messages</h1><p>Respond to patient care support conversations.</p></div><button className="button button--secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true" /> Refresh</button></header>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="admin-support-layout card">
      <aside className="admin-support-list" aria-label="Support conversations">{loading ? <p role="status">Loading conversations…</p> : conversations.length ? conversations.map(row => <button type="button" key={row.conversation_id} className={row.conversation_id === selectedId ? 'active' : ''} onClick={() => void openConversation(row.conversation_id)}><strong>{row.patient_name || 'Patient'}</strong><span>{row.status}</span><small>{timeLabel(row.latest_message_at || row.updated_at)}</small>{row.latest_message && <small className="admin-support-preview">{row.latest_message}</small>}</button>) : <p>No support conversations yet.</p>}</aside>
      <section className="admin-support-thread" aria-label={selected ? `Conversation with ${selected.patient_name || 'patient'}` : 'Conversation'}>
        {selected ? <><header><strong>{selected.patient_name || 'Patient'}</strong><span>{selected.status} · Last activity {timeLabel(selected.latest_message_at || selected.updated_at)}</span></header>
          <div ref={scrollRef} onScroll={onScroll} className="admin-support-stream" aria-live="polite">{messages.map(message => <p className={message.sender_is_support ? 'support-outgoing' : 'support-incoming'} key={message.message_id}>{message.body}<small>{timeLabel(message.created_at)}</small></p>)}</div>
          <form onSubmit={sendReply}><input aria-label="Reply to patient" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} placeholder="Write a reply…" /><button className="button button--primary" type="submit" disabled={!draft.trim() || busy}><Send aria-hidden="true" /> {busy ? 'Sending…' : 'Reply'}</button></form>
        </> : <div className="admin-support-empty">Select a conversation to view messages.</div>}
      </section>
    </div>
  </main>
}
