const sizes = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-10 w-10',
}

export function Spinner({ size = 'md', className = '' }) {
  return (
    <svg className={`animate-spin ${sizes[size]} text-accent ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-100" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="xl" />
        <span className="text-xs text-text-muted font-mono">loading</span>
      </div>
    </div>
  )
}

export function InlineSpinner() {
  return <Spinner size="sm" className="inline-block align-middle" />
}

export function SpinnerOverlay() {
  return (
    <div className="absolute inset-0 bg-surface/60 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
      <Spinner size="lg" />
    </div>
  )
}