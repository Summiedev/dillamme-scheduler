import { useState } from 'react'
import { formatDate } from '../../lib/utils'

const EVENT_ICONS = {
  created: 'M12 6v6m0 0v6m0-6h6m-6 0H6',
  updated: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  completed: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  failed: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z',
  retry: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  cancelled: 'M6 18L18 6M6 6l12 12',
}

const EVENT_COLORS = {
  created: 'border-l-accent',
  updated: 'border-l-accent-muted',
  completed: 'border-l-success',
  failed: 'border-l-danger',
  retry: 'border-l-warning',
  cancelled: 'border-l-text-muted',
}

export function JobEventLog({ events = [] }) {
  const [expanded, setExpanded] = useState(null)

  if (!events.length) {
    return (
      <div className="text-center py-8 text-text-muted text-xs">
        No events recorded
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {events.map((event, idx) => {
        const type = event.type || 'updated'
        const isExpanded = expanded === idx
        return (
          <div
            key={event.id || idx}
            className={`border-l-2 ${EVENT_COLORS[type] || 'border-l-surface-300'} pl-3 py-2 hover:bg-surface-100/50 rounded-r-sm cursor-pointer transition-colors`}
            onClick={() => setExpanded(isExpanded ? null : idx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setExpanded(isExpanded ? null : idx)}
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d={EVENT_ICONS[type] || EVENT_ICONS.updated} />
              </svg>
              <span className="text-xs text-text font-medium capitalize">{type}</span>
              <span className="text-2xs text-text-muted font-mono">{formatDate(event.timestamp || event.createdAt)}</span>
              {event.status && (
                <span className="text-2xs text-text-secondary">{event.status}</span>
              )}
            </div>
            {isExpanded && event.message && (
              <div className="mt-1.5 ml-5.5 text-xs text-text-secondary bg-surface-100 rounded p-2 border border-border">
                {event.message}
              </div>
            )}
            {isExpanded && event.detail && (
              <div className="mt-1 ml-5.5">
                <pre className="text-2xs text-text-muted font-mono whitespace-pre-wrap bg-surface-100 rounded p-2 border border-border">
                  {typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}