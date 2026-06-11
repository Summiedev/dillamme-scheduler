import { useState } from 'react'
import { StatusBadge } from '../ui/StatusBadge'
import { Badge } from '../ui/Badge'
import { formatDate, timeAgo } from '../../lib/utils'

function DependencyItem({ dependency, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = dependency.dependencies && dependency.dependencies.length > 0

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-100 cursor-pointer transition-colors ${depth > 0 ? 'ml-4 border-l-2 border-border' : ''}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        {hasChildren && (
          <svg className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        {!hasChildren && <div className="w-3" />}
        <span className="text-xs font-mono text-accent shrink-0">{dependency.id?.slice(0, 8)}</span>
        <span className="text-xs text-text truncate">{dependency.name || dependency.type || '-'}</span>
        {dependency.status && <StatusBadge status={dependency.status} />}
        {dependency.relation && (
          <Badge variant="neutral" size="sm">{dependency.relation}</Badge>
        )}
        <span className="text-2xs text-text-muted ml-auto shrink-0">{timeAgo(dependency.createdAt)}</span>
      </div>
      {expanded && hasChildren && (
        <div className="mt-0.5 space-y-0.5">
          {dependency.dependencies.map((child, idx) => (
            <DependencyItem key={child.id || idx} dependency={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function DependencyList({ dependencies = [] }) {
  if (!dependencies.length) {
    return (
      <div className="text-center py-6 text-text-muted text-xs">
        No dependencies
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {dependencies.map((dep, idx) => (
        <DependencyItem key={dep.id || idx} dependency={dep} />
      ))}
    </div>
  )
}