const variants = {
  default: 'bg-surface-50 border-border shadow-sm',
  elevated: 'bg-surface-50 border-border shadow-md',
  outlined: 'bg-transparent border-border',
  flat: 'bg-surface-100 border-transparent',
}

export function Card({ children, variant = 'default', className = '', padding = true }) {
  return (
    <div className={`rounded-lg border ${variants[variant]} ${padding ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '' }) {
  return (
    <h3 className={`text-sm font-semibold text-text ${className}`}>
      {children}
    </h3>
  )
}

export function CardDivider() {
  return <div className="my-3 -mx-4 border-t border-border" />
}