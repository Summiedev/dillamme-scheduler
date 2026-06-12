const variants = {
  default: 'bg-surface-200 text-text-secondary border border-surface-300',
  accent: 'bg-accent-subtle/20 text-accent border border-accent-muted/30',
  success: 'bg-success-subtle/20 text-success border border-success-muted/30',
  warning: 'bg-warning-subtle/20 text-warning border border-warning-muted/30',
  danger: 'bg-danger-subtle/20 text-danger border border-danger-muted/30',
  neutral: 'bg-surface-100 text-text-muted border border-surface-300',
}

const sizes = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-sm',
  lg: 'px-2.5 py-1 text-sm',
}

export function Badge({ children, variant = 'default', size = 'md', className = '' }) {
  return (
    <span className={`inline-flex items-center font-medium rounded-sm ${variants[variant] || variants.default} ${sizes[size]} ${className}`}>
      {children}
    </span>
  )
}
