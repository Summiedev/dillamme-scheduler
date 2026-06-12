import { useJobStore } from '../../store/jobStore'
import { PulseIndicator } from '../ui/PulseIndicator'
import { useDLQStore } from '../../store/dlqStore'
import { useLocation, useNavigate } from 'react-router-dom'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/jobs': 'Jobs',
  '/metrics': 'Metrics',
  '/dlq': 'Dead Letter Queue',
  '/logs': 'Logs',
}

export function TopBar({ onMenuClick }) {
  const sseStatus = useJobStore((s) => s.sseStatus)
  const isError = useJobStore((s) => s.isError)
  const retryCount = useJobStore((s) => s.retryCount)
  const alertCount = useDLQStore((s) => s.alertCount)
  const clearAlerts = useDLQStore((s) => s.clearAlerts)
  const location = useLocation()
  const navigate = useNavigate()

  const title = PAGE_TITLES[location.pathname] || 'Dilamme Scheduler'

  return (
    <header className="bg-surface-50 border-b border-border px-3 md:px-4 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          className="md:hidden p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-surface-100"
          onClick={onMenuClick}
          aria-label="Toggle sidebar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-text truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {alertCount > 0 && (
          <button
            onClick={() => { navigate('/dlq'); clearAlerts() }}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-danger-subtle/20 text-danger text-2xs font-medium hover:bg-danger-subtle/30 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
            {alertCount} DLQ
          </button>
        )}
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-100 border border-border">
          <PulseIndicator
            variant={sseStatus === 'connected' ? 'success' : sseStatus === 'reconnecting' ? 'warning' : 'danger'}
            size="sm"
            pulsing={sseStatus === 'connected'}
          />
          <span className={`text-2xs font-mono font-medium ${
            sseStatus === 'connected' ? 'text-success' :
            sseStatus === 'reconnecting' ? 'text-warning' :
            'text-text-muted'
          }`}>
            {sseStatus === 'connected' ? 'live' :
             sseStatus === 'reconnecting' ? 'retry' :
             sseStatus === 'error' ? 'offline' : 'down'}
          </span>
        </div>
        {isError && (
          <span className="text-2xs text-danger font-mono hidden md:inline">connection failed</span>
        )}
        {sseStatus === 'reconnecting' && (
          <span className="text-2xs text-warning font-mono hidden md:inline">{retryCount}/5</span>
        )}
      </div>
    </header>
  )
}
