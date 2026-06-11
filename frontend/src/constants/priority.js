export const PRIORITY = {
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

export const PRIORITY_COLORS = {
  [PRIORITY.LOW]: { bg: 'bg-surface-200', text: 'text-text-muted', border: 'border-surface-300' },
  [PRIORITY.MEDIUM]: { bg: 'bg-accent-subtle/20', text: 'text-accent', border: 'border-accent-muted/30' },
  [PRIORITY.HIGH]: { bg: 'bg-warning-subtle/20', text: 'text-warning', border: 'border-warning-muted/30' },
}

export const PRIORITY_LABELS = {
  [PRIORITY.HIGH]: 'High',
  [PRIORITY.MEDIUM]: 'Medium',
  [PRIORITY.LOW]: 'Low',
}