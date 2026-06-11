import { Card } from '../ui/Card'
import { PulseIndicator } from '../ui/PulseIndicator'

const accentVariants = {
  default: 'border-l-accent',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
}

const iconVariants = {
  default: 'bg-accent-subtle/20 text-accent',
  success: 'bg-success-subtle/20 text-success',
  warning: 'bg-warning-subtle/20 text-warning',
  danger: 'bg-danger-subtle/20 text-danger',
}

export function StatCard({ title, value, subtitle, icon, trend, variant = 'default', pulsing }) {
  return (
    <Card className={`border-l-[3px] ${accentVariants[variant]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{title}</p>
            {pulsing && <PulseIndicator variant="accent" size="sm" />}
          </div>
          <p className="mt-1 text-lg font-bold text-text font-mono tracking-tight">{value ?? '-'}</p>
          {subtitle && (
            <p className="mt-0.5 text-2xs text-text-secondary">{subtitle}</p>
          )}
          {trend !== undefined && (
            <p className={`mt-0.5 text-2xs font-mono font-medium ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
              <svg className={`w-3 h-3 inline mr-0.5 ${trend >= 0 ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              {Math.abs(trend)}%
            </p>
          )}
        </div>
        {icon && (
          <div className={`p-2 rounded-lg shrink-0 ${iconVariants[variant]}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
          </div>
        )}
      </div>
    </Card>
  )
}