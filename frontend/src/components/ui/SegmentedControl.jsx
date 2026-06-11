export function SegmentedControl({ options, value, onChange, size = 'sm', className = '' }) {
  const sizes = {
    xs: 'text-2xs',
    sm: 'text-xs',
    md: 'text-sm',
  }

  return (
    <div className={`inline-flex rounded-md border border-border overflow-hidden bg-surface-100 ${className}`}>
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            className={`px-3 py-1.5 font-medium transition-all duration-100 ${sizes[size]} ${
              isActive
                ? 'bg-surface-200 text-text shadow-sm'
                : 'text-text-secondary hover:text-text hover:bg-surface-100'
            } ${option.disabled ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}