export function Brand({ compact = false }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`} aria-label="EasyCare Tele Clinic home">
      <img className="brand-logo" src="/easycare-logo.png" alt="EasyCare Tele Clinic" />
    </div>
  )
}
