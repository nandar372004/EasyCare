import { useState } from 'react'
import { Check, CheckCircle2, CreditCard, Crown, HeartPulse, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

const plans = [
  { id: 'essential', name: 'Essential', monthly: 0, description: 'Core EasyCare access for everyday health management.', icon: HeartPulse, features: ['Browse verified doctors', 'Manage appointments', 'Health records overview', 'Secure care messages'] },
  { id: 'plus', name: 'EasyCare Plus', monthly: 15000, description: 'More support for patients who use EasyCare regularly.', icon: Sparkles, popular: true, features: ['Everything in Essential', 'Priority appointment requests', 'AI Health Guardian access', 'Medication reminders', 'Expanded health summaries'] },
  { id: 'family', name: 'Family Care', monthly: 28000, description: 'A shared care experience for households and caregivers.', icon: Users, features: ['Everything in EasyCare Plus', 'Up to 5 family profiles', 'Shared appointment overview', 'Caregiver-friendly summaries', 'Priority support'] },
]

function formatPrice(value) {
  return new Intl.NumberFormat('en-MM', { maximumFractionDigits: 0 }).format(value)
}

export function SubscriptionPage() {
  const [billing, setBilling] = useState('monthly')
  const [selectedPlan, setSelectedPlan] = useState('essential')

  return <section className="subscription-page">
    <header className="subscription-heading"><div><span className="eyebrow">Care that grows with you</span><h1>Subscription</h1><p>Compare EasyCare plans and choose the presentation option that best fits your care needs.</p></div><div className="subscription-security"><ShieldCheck aria-hidden="true" /><span><strong>Safe presentation</strong><small>No charge will be made</small></span></div></header>

    <div className="subscription-notice" role="note"><CreditCard aria-hidden="true" /><span>This page demonstrates subscription choices only. No payment, renewal, or subscription is created.</span></div>

    <div className="billing-toggle" role="group" aria-label="Billing period"><button type="button" className={billing === 'monthly' ? 'active' : ''} aria-pressed={billing === 'monthly'} onClick={() => setBilling('monthly')}>Monthly</button><button type="button" className={billing === 'yearly' ? 'active' : ''} aria-pressed={billing === 'yearly'} onClick={() => setBilling('yearly')}>Yearly <span>Save 15%</span></button></div>

    <div className="subscription-plans">{plans.map((plan) => {
      const Icon = plan.icon
      const price = billing === 'yearly' ? Math.round(plan.monthly * 12 * .85) : plan.monthly
      const selected = selectedPlan === plan.id
      return <article className={`subscription-plan card${plan.popular ? ' popular' : ''}${selected ? ' selected' : ''}`} key={plan.id}>{plan.popular && <span className="popular-label"><Crown aria-hidden="true" />Most Popular</span>}<div className="plan-icon"><Icon aria-hidden="true" /></div><h2>{plan.name}</h2><p>{plan.description}</p><div className="plan-price"><strong>{price ? `${formatPrice(price)} MMK` : 'Free'}</strong><span>{price ? `/${billing === 'yearly' ? 'year' : 'month'}` : 'Current access'}</span></div><ul>{plan.features.map((feature) => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul><button type="button" className={`button ${selected ? 'button--secondary' : 'button--primary'}`} aria-pressed={selected} onClick={() => setSelectedPlan(plan.id)}>{selected ? <><CheckCircle2 aria-hidden="true" />Selected</> : `Choose ${plan.name}`}</button></article>
    })}</div>

    <section className="subscription-summary card"><div><span className="eyebrow">Your selection</span><h2>{plans.find((plan) => plan.id === selectedPlan)?.name}</h2><p>This selection is stored only while this page is open. Continue to the existing Payments presentation to review how billing information would appear.</p></div><Link className="button button--primary" to="/payments"><CreditCard aria-hidden="true" />Review payment presentation</Link></section>
  </section>
}
