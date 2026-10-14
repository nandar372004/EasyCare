export function ProviderPageHeader({ eyebrow = 'Clinical Workspace', title, description, actions }) {
  return (
    <div className="provider-page-header">
      <div className="provider-page-header-main">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="provider-page-header-actions">{actions}</div>}
    </div>
  )
}

export function ProviderTabs({ tabs, activeTab, onChange }) {
  function handleKeyDown(event) {
    const buttons = [...event.currentTarget.querySelectorAll('[role="tab"]')]
    const index = buttons.indexOf(event.target)
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
    if (next >= 0) { event.preventDefault(); buttons[next].focus(); onChange(tabs[next].id) }
  }
  return (
    <div className="provider-tabs" role="tablist" onKeyDown={handleKeyDown}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            className={`provider-tab-button${isActive ? ' active' : ''}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span className="provider-tab-count" aria-label={`${tab.count} items`}>
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function ProviderStatCard({ title, value, subtitle, icon: Icon, tone = 'default' }) {
  return (
    <article className={`provider-stat-card tone-${tone}`}>
      <div className="provider-stat-card-header">
        <span className="provider-stat-title">{title}</span>
        {Icon && (
          <span className="provider-stat-icon" aria-hidden="true">
            <Icon size={20} />
          </span>
        )}
      </div>
      <div className="provider-stat-value">{value}</div>
      {subtitle && <p className="provider-stat-subtitle">{subtitle}</p>}
    </article>
  )
}

export function ProviderEmptyState({ title, description, action }) {
  return (
    <div className="card provider-empty-state-card" role="status">
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="provider-empty-action">{action}</div>}
    </div>
  )
}

export function ProviderStatusBadge({ status, label }) {
  const normalized = (status || '').toLowerCase().replaceAll(' ', '_')
  const displayLabel = label || status?.replaceAll('_', ' ') || 'Unknown'
  return (
    <span className={`provider-status-badge status-${normalized}`}>
      <span className="provider-status-dot" aria-hidden="true" />
      <span>{displayLabel}</span>
    </span>
  )
}
