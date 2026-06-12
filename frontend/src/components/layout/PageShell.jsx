export function PageShell({ title, description, children, actions }) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text truncate">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
