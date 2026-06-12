import { Button } from './Button'

export function EmptyState({ icon, title, description, actionLabel, onAction, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center ${compact ? 'py-8' : 'py-16'} px-4`}>
      {icon ? (
        <div className="mb-3 text-text-muted">
          {icon}
        </div>
      ) : (
        <div className="mb-3 w-10 h-10 rounded-lg bg-surface-200 flex items-center justify-center">
          <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
      )}
      <h3 className={`font-semibold text-text-secondary ${compact ? 'text-base' : 'text-base'}`}>{title}</h3>
      {description && (
        <p className={`mt-1 text-text-muted text-center max-w-sm ${compact ? 'text-sm' : 'text-base'}`}>{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
