import { useState } from 'react'
import { ChevronDown, ExternalLink, Link2, Plus, Trash2, Youtube } from 'lucide-react'
import './patientLifestylePlans.css'

const categories = [
  ['nutrition', 'Nutrition'], ['exercise', 'Exercise'], ['sleep', 'Sleep'], ['posture', 'Posture'],
  ['stress', 'Stress'], ['general_wellness', 'General Wellness'], ['other', 'Other'],
]
const hostLabel = url => {
  try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return 'Website' }
}
function PlanForm({ initial, busy, onCancel, onSave }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [category, setCategory] = useState(initial?.category || '')
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    try { await onSave({ id: initial?.id, title, description, category }); onCancel() }
    catch (failure) { setError(failure.message || 'Could not save this plan.') }
  }
  return <form className="lifestyle-form" onSubmit={submit}>
    <label>Plan title *<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="For example, Improve Sleep" /></label>
    <label>My Plan<textarea maxLength={4000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe the habits you want to follow" /></label>
    <label>Category <select value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose a category</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {error && <p className="lifestyle-error" role="alert">{error}</p>}
    <div className="lifestyle-form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Create plan'}</button><button type="button" className="lifestyle-secondary" onClick={onCancel}>Cancel</button></div>
  </form>
}
function ResourceForm({ initial, busy, onCancel, onSave }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [url, setUrl] = useState(initial?.url || '')
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    try { await onSave({ id: initial?.id, title, url }); onCancel() }
    catch (failure) { setError(failure.message || 'Could not save this resource.') }
  }
  return <form className="lifestyle-resource-form" onSubmit={submit}>
    <label>URL *<input type="url" inputMode="url" required maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" /></label>
    <label>Title (optional)<input maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="A helpful guide" /></label>
    {error && <p className="lifestyle-error" role="alert">{error}</p>}
    <div className="lifestyle-form-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save link' : 'Add link'}</button><button type="button" className="lifestyle-secondary" onClick={onCancel}>Cancel</button></div>
  </form>
}
function ResourceRow({ resource, onEdit, onDelete, busy }) {
  const youtube = resource.resourceType === 'youtube'
  return <div className="lifestyle-resource-row">
    <a className="lifestyle-resource-link" href={resource.url} target="_blank" rel="noopener noreferrer">
      <span className={`lifestyle-resource-icon${youtube ? ' is-youtube' : ''}`}>{youtube ? <Youtube aria-hidden="true" /> : <Link2 aria-hidden="true" />}</span>
      <span className="lifestyle-resource-copy"><strong>{resource.title || hostLabel(resource.url)}</strong><small>{youtube ? 'YouTube' : 'Website'}</small></span>
      <ExternalLink aria-hidden="true" className="lifestyle-resource-external" />
    </a>
    <div className="lifestyle-resource-actions"><button type="button" onClick={() => onEdit(resource)} disabled={busy}>Edit link</button><button type="button" className="lifestyle-icon-button" aria-label={`Remove resource: ${resource.title || hostLabel(resource.url)}`} onClick={() => onDelete(resource)} disabled={busy}><Trash2 aria-hidden="true" /></button></div>
  </div>
}

export function PatientLifestylePlans({ plans, onCreatePlan, onEditPlan, onDeactivatePlan, onSaveResource, onDeleteResource }) {
  const [creating, setCreating] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [resourcePlan, setResourcePlan] = useState('')
  const [editingResource, setEditingResource] = useState(null)
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const savePlan = async plan => {
    const key = plan.id || 'new-plan'; setBusyKey(key); setError('')
    try { await (plan.id ? onEditPlan(plan) : onCreatePlan(plan)) }
    catch (failure) { throw failure }
    finally { setBusyKey('') }
  }
  const deactivate = async plan => {
    setBusyKey(plan.id); setError('')
    try { await onDeactivatePlan(plan) } catch { setError('Could not deactivate this plan. Try again.') } finally { setBusyKey('') }
  }
  const saveResource = async (plan, resource) => {
    const key = resource.id || `${plan.id}:new-resource`; setBusyKey(key); setError('')
    try { await onSaveResource(plan, resource) }
    finally { setBusyKey('') }
  }
  const removeResource = async (plan, resource) => {
    setBusyKey(resource.id); setError('')
    try { await onDeleteResource(plan, resource) } catch { setError('Could not remove this resource. Try again.') } finally { setBusyKey('') }
  }
  return <div className="patient-lifestyle-plans">
    {plans.length ? <div className="lifestyle-plan-list">{plans.map(plan => {
      const categoryLabel = categories.find(([value]) => value === plan.category)?.[1]
      return <details className="lifestyle-plan" key={plan.id}>
        <summary className="lifestyle-plan-summary"><span className="lifestyle-plan-heading"><strong>{plan.title}</strong><span className="lifestyle-plan-preview">{plan.description || categoryLabel || 'Personal lifestyle plan'}</span></span><span className="lifestyle-plan-count">{plan.resources.length} {plan.resources.length === 1 ? 'resource' : 'resources'}</span><ChevronDown aria-hidden="true" /></summary>
        <div className="lifestyle-plan-content">
          {editingPlan?.id === plan.id ? <PlanForm initial={plan} busy={busyKey === plan.id} onCancel={() => setEditingPlan(null)} onSave={savePlan} /> : <>
            <section className="lifestyle-plan-notes"><h3>My Plan</h3>{plan.description ? <p>{plan.description}</p> : <p className="lifestyle-muted">Add notes about the habits you want to follow.</p>}{categoryLabel && <span className="lifestyle-category">{categoryLabel}</span>}</section>
            <section className="lifestyle-resources"><h3>Resources</h3>{plan.resources.length ? <div className="lifestyle-resource-list">{plan.resources.map(resource => editingResource?.id === resource.id && resourcePlan === plan.id
              ? <ResourceForm key={resource.id} initial={resource} busy={busyKey === resource.id} onCancel={() => { setEditingResource(null); setResourcePlan('') }} onSave={value => saveResource(plan, value)} />
              : <ResourceRow key={resource.id} resource={resource} busy={busyKey === resource.id} onEdit={value => { setEditingResource(value); setResourcePlan(plan.id) }} onDelete={value => removeResource(plan, value)} />)}</div> : <p className="lifestyle-muted">No resources added yet.</p>}
              {resourcePlan === plan.id && !editingResource ? <ResourceForm busy={busyKey === `${plan.id}:new-resource`} onCancel={() => setResourcePlan('')} onSave={value => saveResource(plan, value)} /> : <button type="button" className="lifestyle-inline-action" onClick={() => { setResourcePlan(plan.id); setEditingResource(null) }}><span aria-hidden="true">+</span> Add Resource</button>}
            </section>
            <div className="lifestyle-plan-actions"><button type="button" onClick={() => setEditingPlan(plan)} disabled={busyKey === plan.id}>Edit plan</button><button type="button" className="lifestyle-secondary" onClick={() => void deactivate(plan)} disabled={busyKey === plan.id}>{busyKey === plan.id ? 'Saving…' : 'Deactivate'}</button></div>
          </>}
        </div>
      </details>
    })}</div> : !creating && <p className="lifestyle-empty">No lifestyle plans yet.</p>}
    {creating ? <PlanForm busy={busyKey === 'new-plan'} onCancel={() => setCreating(false)} onSave={savePlan} /> : <button type="button" className="lifestyle-create" onClick={() => setCreating(true)}><Plus aria-hidden="true" />{plans.length ? 'Create Lifestyle Plan' : 'Create your first plan'}</button>}
    {error && <p className="lifestyle-error" role="alert">{error}</p>}
  </div>
}
