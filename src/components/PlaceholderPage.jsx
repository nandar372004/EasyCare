import { Construction } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PlaceholderPage({ title, publicPage = false }) {
  return (
    <section className={`placeholder card${publicPage ? ' auth-card' : ''}`}>
      <span className="placeholder-icon"><Construction aria-hidden="true" /></span>
      <span className="eyebrow">Foundation placeholder</span>
      <h1>{title}</h1>
      <p>This screen is reserved for the next implementation phase. No production functionality is active here.</p>
      {publicPage && <Link className="text-link" to="/login">Return to sign in</Link>}
    </section>
  )
}
