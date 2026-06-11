import { NavLink } from 'react-router-dom'
import { useDLQStore } from '../../store/dlqStore'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/jobs', label: 'Jobs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { path: '/metrics', label: 'Metrics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { path: '/dlq', label: 'DLQ', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z', badge: true },
  { path: '/logs', label: 'Logs', icon: 'M4 6h16M4 12h16M4 18h7' },
]

export function Sidebar({ onClose }) {
  const alertCount = useDLQStore((s) => s.alertCount)

  return (
    <aside className="w-56 bg-surface-50 border-r border-border flex flex-col h-screen">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
        <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center">
          <svg className="w-4 h-4 text-surface" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <span className="text-sm font-bold text-text tracking-tight">Dilamme</span>
        <span className="ml-auto text-2xs text-text-muted font-mono">v1.0.0</span>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-accent-subtle/20 text-accent shadow-sm'
                  : 'text-text-secondary hover:text-text hover:bg-surface-100'
              }`
            }
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            <span>{item.label}</span>
            {item.badge && alertCount > 0 && (
              <span className="ml-auto bg-danger text-white text-2xs font-bold px-1.5 py-0.5 rounded-sm min-w-[18px] text-center">
                {alertCount > 99 ? '99+' : alertCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}