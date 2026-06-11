import { useMetrics } from '../hooks/useMetrics'
import { useJobs } from '../hooks/useJobs'
import { useDLQStore } from '../store/dlqStore'
import { useJobStore } from '../store/jobStore'
import { PageShell } from '../components/layout/PageShell'
import { StatCard } from '../components/dashboard/StatCard'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PulseIndicator } from '../components/ui/PulseIndicator'
import { PageSpinner } from '../components/ui/Spinner'
import { useNavigate } from 'react-router-dom'
import { STATUS } from '../constants/status'

const ICONS = {
  total: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  running: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  failed: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z',
  cancelled: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { data: metrics, isLoading: metricsLoading } = useMetrics()
  const alertCount = useDLQStore((s) => s.alertCount)
  const alerts = useDLQStore((s) => s.alerts)
  const clearAlerts = useDLQStore((s) => s.clearAlerts)
  const sseStatus = useJobStore((s) => s.sseStatus)
  const connected = sseStatus === 'connected'

  const m = metrics?.data || metrics || {}
  const byStatus = m.by_status || m.status_counts || {}
  const totalJobs = m.total_jobs ?? Object.values(byStatus).reduce((a, b) => a + b, 0) ?? '-'
  const pending = byStatus[STATUS.PENDING] ?? 0
  const processing = byStatus[STATUS.PROCESSING] ?? 0
  const completed = byStatus[STATUS.COMPLETED] ?? 0
  const failed = byStatus[STATUS.FAILED] ?? 0
  const cancelled = byStatus[STATUS.CANCELLED] ?? 0
  const dlqSize = m.dlq_size ?? 0

  if (metricsLoading) return <PageSpinner />

  return (
    <PageShell
      title="Dashboard"
      description="Real-time overview of your scheduler system"
    >
      {alertCount > 0 && (
        <Card variant="outlined" className="border-danger-muted/50 bg-danger-subtle/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PulseIndicator variant="danger" size="md" pulsing />
              <span className="text-sm font-medium text-danger">{alertCount} failed message{alertCount > 1 ? 's' : ''} in dead letter queue</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="xs" onClick={() => { clearAlerts(); navigate('/dlq') }}>
                View DLQ
              </Button>
              <Button variant="ghost" size="xs" onClick={clearAlerts}>
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          title="Total Jobs"
          value={totalJobs}
          icon={ICONS.total}
          pulsing={connected}
        />
        <StatCard
          title="Processing"
          value={processing}
          variant="warning"
          icon={ICONS.running}
        />
        <StatCard
          title="Completed"
          value={completed}
          variant="success"
          icon={ICONS.success}
        />
        <StatCard
          title="Failed"
          value={failed}
          variant="danger"
          icon={ICONS.failed}
        />
        <StatCard
          title="Cancelled"
          value={cancelled}
          variant="default"
          icon={ICONS.cancelled}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>DLQ Size</CardTitle>
          </CardHeader>
          <div className="flex items-center justify-center h-48">
            <span className="text-6xl font-bold font-mono text-danger">{dlqSize}</span>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Activity</CardTitle>
            <PulseIndicator variant="success" size="sm" pulsing={connected} />
          </CardHeader>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="text-center py-6 text-text-muted text-xs">No recent activity</div>
            ) : (
              alerts.slice(0, 10).map((alert, idx) => (
                <div key={alert.id || idx} className="flex items-start gap-2 px-2 py-1.5 rounded bg-surface-100/50">
                  <PulseIndicator variant="danger" size="sm" pulsing={false} />
                  <div className="min-w-0">
                    <p className="text-xs text-text truncate">{alert.message || 'DLQ alert'}</p>
                    <p className="text-2xs text-text-muted font-mono">{alert.timestamp || alert.createdAt}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  )
}