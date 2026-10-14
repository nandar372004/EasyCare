export function Brand({ compact = false }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`} aria-label="EasyCare Digital Health Platform home">
      <img className="brand-logo" src="/easycare-logo.png" alt="EasyCare Digital Health Platform" />
    </div>
  )
}
