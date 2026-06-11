const variants = {
  primary: 'bg-accent text-surface font-medium hover:bg-accent-hover active:bg-accent-muted border border-accent-muted/50 shadow-sm',
  secondary: 'bg-surface-100 text-text font-medium hover:bg-surface-200 active:bg-surface-300 border border-border',
  danger: 'bg-danger text-surface font-medium hover:bg-danger-muted active:bg-danger border border-danger-muted/50 shadow-sm',
  ghost: 'text-text-secondary hover:text-text hover:bg-surface-100 active:bg-surface-200',
  outline: 'bg-transparent text-accent font-medium hover:bg-accent-subtle/20 active:bg-accent-subtle/30 border border-accent-muted/50',
}

const sizes = {
  xs: 'px-2 py-1 text-2xs gap-1',
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3 py-2 text-sm gap-2',
  lg: 'px-4 py-2.5 text-sm gap-2',
}

export function Button({ children, variant = 'primary', size = 'md', disabled = false, loading = false, className = '', ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none select-none ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-0.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  )
}