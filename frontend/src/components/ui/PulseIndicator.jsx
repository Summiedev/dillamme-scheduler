const variantStyles = {
  success: 'bg-success shadow-glow-success',
  danger: 'bg-danger shadow-glow-danger',
  accent: 'bg-accent shadow-glow',
  warning: 'bg-warning',
  neutral: 'bg-surface-400',
}

const sizes = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
}

export function PulseIndicator({ variant = 'accent', size = 'md', pulsing = true, label }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={`relative inline-flex ${sizes[size]}`}>
        <span className={`absolute inline-flex w-full h-full rounded-full opacity-75 ${variantStyles[variant]} ${pulsing ? 'animate-ping' : ''}`} />
        <span className={`relative inline-flex rounded-full w-full h-full ${variantStyles[variant]}`} />
      </span>
      {label && <span className="text-2xs text-text-muted font-mono">{label}</span>}
    </span>
  )
}