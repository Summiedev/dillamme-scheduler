export const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
}

export const STATUS_COLORS = {
  [STATUS.PENDING]: { bg: 'bg-surface-200', text: 'text-text-secondary', dot: 'bg-surface-400', border: 'border-surface-300' },
  [STATUS.PROCESSING]: { bg: 'bg-accent-subtle/30', text: 'text-accent', dot: 'bg-accent', border: 'border-accent-muted/50' },
  [STATUS.COMPLETED]: { bg: 'bg-success-subtle/30', text: 'text-success', dot: 'bg-success', border: 'border-success-muted/50' },
  [STATUS.FAILED]: { bg: 'bg-danger-subtle/30', text: 'text-danger', dot: 'bg-danger', border: 'border-danger-muted/50' },
  [STATUS.CANCELLED]: { bg: 'bg-surface-100', text: 'text-text-muted', dot: 'bg-surface-400', border: 'border-surface-300' },
}

export const STATUS_LABELS = {
  [STATUS.PENDING]: 'Pending',
  [STATUS.PROCESSING]: 'Processing',
  [STATUS.COMPLETED]: 'Completed',
  [STATUS.FAILED]: 'Failed',
  [STATUS.CANCELLED]: 'Cancelled',
}