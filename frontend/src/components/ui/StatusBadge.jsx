import { STATUS_COLORS, STATUS_LABELS } from '../../constants/status'

export function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status]
  if (!colors) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-sm font-medium bg-surface-200 text-text-secondary border border-surface-300">
        {status}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-sm font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {STATUS_LABELS[status] || status}
    </span>
  )
}
