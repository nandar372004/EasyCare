import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="not-found">
      <div className="card placeholder">
        <span className="eyebrow">404</span>
        <h1>Page not found</h1>
        <p>The page you requested does not exist in this foundation build.</p>
        <Link className="button button--secondary" to="/"><ArrowLeft aria-hidden="true" />Back to dashboard</Link>
      </div>
    </main>
  )
}
