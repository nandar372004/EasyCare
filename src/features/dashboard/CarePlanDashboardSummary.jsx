import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import { carePlanService } from '../../services/carePlanService.js'

export function CarePlanDashboardSummary({ patientId, service = carePlanService }) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState(patientId ? { status: 'loading' } : { status: 'unavailable' })
    if (!patientId) return () => { current = false }
    const load = async () => {
      try {
        const summaries = await service.listMyPlans()
        const active = (Array.isArray(summaries) ? summaries : []).filter(plan => plan.patient_id === patientId && plan.status === 'active')
        if (!current) return
        if (active.length > 1) { setState({ status: 'multiple', plans: active }); return }
        if (!active.length) { setState({ status: 'empty' }); return }
        const plan = active[0]
        const [rows, detail] = await Promise.all([service.getOccurrences(plan.id), service.getDetail(plan.id)])
        if (!current) return
        const tasks = new Map((detail?.tasks || []).filter(task => task.version_id === (plan.current_version?.id || detail.plan?.current_version_id)).map(task => [task.id, task]))
        const next = (Array.isArray(rows) ? rows : []).filter(row => row.required && row.status === 'pending' && row.completed !== true && Date.parse(row.scheduled_at) > Date.now())
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))[0]
        setState({ status: 'ready', plan, progress: plan.progress?.today, next: next ? { ...next, task: tasks.get(next.task_id) } : null })
      } catch { if (current) setState({ status: 'error' }) }
    }
    void load()
    return () => { current = false }
  }, [patientId, service])
  if (state.status === 'loading' || state.status === 'unavailable' || state.status === 'empty' || state.status === 'error') return null
  return <section className="care-plan-dashboard card" aria-labelledby="dashboard-care-plan-title">
    <div className="care-plan-dashboard-heading"><span className="care-plan-dashboard-icon"><ClipboardList aria-hidden="true" /></span><div><span className="eyebrow">My Care Plan</span><h2 id="dashboard-care-plan-title">{state.status === 'multiple' ? 'Your active care plans' : state.plan.current_version?.title || 'Your care plan'}</h2></div></div>
    {state.status === 'multiple' ? <><p>Choose a plan to view its tasks and progress.</p><ul>{state.plans.map(plan => <li key={plan.id}><span>{plan.current_version?.title || 'Care plan'}</span><Link to="/my-care-plan">View plan</Link></li>)}</ul></> : <>
      {state.progress?.state === 'tasks_due' ? <p>{state.progress.completed} of {state.progress.total} tasks completed today</p> : <p>{state.progress?.state === 'no_tasks_due' ? 'No care tasks due today' : 'Progress is currently unavailable.'}</p>}
      {state.next?.task && <p className="care-plan-dashboard-next"><strong>Next:</strong> {state.next.task.title} · {new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: state.next.timezone || 'Asia/Yangon' }).format(new Date(state.next.scheduled_at))}</p>}
      <Link className="button button--secondary" to="/my-care-plan">View My Care Plan</Link>
    </>}
  </section>
}
