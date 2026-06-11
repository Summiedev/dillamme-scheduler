import { useMetrics, useMetricsHistory } from '../hooks/useMetrics'
import { StatCard } from '../components/dashboard/StatCard'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { PageSpinner } from '../components/ui/Spinner'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'

const ICONS = {
  total: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  running: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  failed: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z',
  duration: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
}

export function MetricsPage() {
  const { data: metrics, isLoading } = useMetrics()
  const { data: history, isLoading: historyLoading } = useMetricsHistory()

  if (isLoading) return <PageSpinner />

  const m = metrics?.data || metrics || {}
  const historyData = Array.isArray(history) ? history : history?.data ?? []
  const lineData = historyData.length > 0
    ? historyData
    : [
        { timestamp: '00:00', value: 95 },
        { timestamp: '04:00', value: 96 },
        { timestamp: '08:00', value: 98 },
        { timestamp: '12:00', value: 99 },
        { timestamp: '16:00', value: 97 },
        { timestamp: '20:00', value: 98 },
      ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text">Metrics</h2>
        <p className="mt-1 text-sm text-text-secondary">System performance and job statistics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          title="Total Jobs"
          value={m.totalJobs ?? m.total ?? '-'}
          icon={ICONS.total}
        />
        <StatCard
          title="Running"
          value={m.runningJobs ?? m.running ?? 0}
          variant="warning"
          icon={ICONS.running}
        />
        <StatCard
          title="Success Rate"
          value={m.successRate != null ? `${m.successRate}%` : '-'}
          variant="success"
          icon={ICONS.success}
        />
        <StatCard
          title="Failed"
          value={m.failedJobs ?? m.failed ?? 0}
          variant="danger"
          icon={ICONS.failed}
        />
        <StatCard
          title="Avg Duration"
          value={m.avgDuration != null ? `${m.avgDuration}ms` : '-'}
          icon={ICONS.duration}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Jobs Over Time</CardTitle>
          </CardHeader>
          <div className="h-64">
            {historyLoading ? <PageSpinner /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 10, fill: '#8b949e' }} stroke="#30363d" />
                  <YAxis tick={{ fontSize: 10, fill: '#8b949e' }} stroke="#30363d" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1c2128',
                      border: '1px solid #30363d',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#e6edf3',
                    }}
                  />
                  <Bar dataKey="value" fill="#58a6ff" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Success Rate Trend</CardTitle>
          </CardHeader>
          <div className="h-64">
            {historyLoading ? <PageSpinner /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 10, fill: '#8b949e' }} stroke="#30363d" />
                  <YAxis tick={{ fontSize: 10, fill: '#8b949e' }} stroke="#30363d" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1c2128',
                      border: '1px solid #30363d',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#e6edf3',
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#3fb950" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}