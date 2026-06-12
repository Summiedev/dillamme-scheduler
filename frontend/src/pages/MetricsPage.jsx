import { useEffect, useMemo, useState } from 'react'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Spinner } from '../components/ui/Spinner'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { timeAgo } from '../lib/utils'
import { STATUS } from '../constants/status'

const METRICS_URL = '/api/metrics'
const HEALTH_URL = '/api/health'
const LOGS_URL = '/api/logs?limit=20&offset=0'

const STATUS_ORDER = [
  STATUS.PENDING,
  STATUS.PROCESSING,
  STATUS.COMPLETED,
  STATUS.FAILED,
  STATUS.CANCELLED,
]

const PIE_COLORS = {
  [STATUS.PENDING]: '#8b949e',
  [STATUS.PROCESSING]: '#58a6ff',
  [STATUS.COMPLETED]: '#3fb950',
  [STATUS.FAILED]: '#f85149',
  [STATUS.CANCELLED]: '#d29922',
}

const EVENT_VARIANTS = {
  job_created: 'accent',
  job_updated: 'success',
  job_deleted: 'danger',
  job_cancelled: 'warning',
  job_failed: 'danger',
  job_completed: 'success',
  default: 'neutral',
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json()
}

function HealthPill({ label, value, tone }) {
  const variant = tone === 'ok' ? 'success' : tone === 'stale' || tone === 'degraded' || tone === 'unknown' ? 'warning' : tone === 'error' ? 'danger' : 'neutral'
  return (
    <Badge variant={variant} size="lg" className="capitalize">
      {label}: {value}
    </Badge>
  )
}

function LogEventBadge({ event }) {
  const variant = EVENT_VARIANTS[event] || EVENT_VARIANTS.default
  return (
    <Badge variant={variant} size="sm" className="capitalize">
      {event || 'log'}
    </Badge>
  )
}

export function MetricsPage() {
  const [metrics, setMetrics] = useState(null)
  const [health, setHealth] = useState(null)
  const [logs, setLogs] = useState([])
  const [metricsError, setMetricsError] = useState(false)
  const [healthError, setHealthError] = useState(false)
  const [logsError, setLogsError] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadMetricsAndHealth = async (silent = false) => {
      if (!silent) {
        setMetricsError(false)
        setHealthError(false)
      }

      const [metricsResult, healthResult] = await Promise.allSettled([
        fetchJson(METRICS_URL),
        fetchJson(HEALTH_URL),
      ])

      if (cancelled) return

      if (metricsResult.status === 'fulfilled') {
        setMetrics(metricsResult.value)
        setMetricsError(false)
      } else {
        setMetricsError(true)
      }

      if (healthResult.status === 'fulfilled') {
        setHealth(healthResult.value)
        setHealthError(false)
      } else {
        setHealthError(true)
      }
    }

    const loadLogs = async (silent = false) => {
      if (!silent) {
        setLogsError(false)
      }

      try {
        const data = await fetchJson(LOGS_URL)
        if (cancelled) return
        setLogs(Array.isArray(data.logs) ? data.logs : [])
        setLogsError(false)
      } catch {
        if (!cancelled) {
          setLogsError(true)
        }
      }
    }

    const loadInitial = async () => {
      await Promise.allSettled([
        loadMetricsAndHealth(false),
        loadLogs(false),
      ])
      if (!cancelled) {
        setInitialLoading(false)
      }
    }

    loadInitial()

    const metricsTimer = window.setInterval(() => {
      loadMetricsAndHealth(true)
    }, 15000)

    const logsTimer = window.setInterval(() => {
      loadLogs(true)
    }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(metricsTimer)
      window.clearInterval(logsTimer)
    }
  }, [])

  const metricsData = metrics || {}
  const byStatus = metricsData.by_status || {}
  const totalJobs = toNumber(metricsData.total_jobs)
  const dlqSize = toNumber(metricsData.dlq_size)

  const statusRows = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status,
      value: toNumber(byStatus[status]),
    }))
  }, [byStatus])

  const chartTotal = statusRows.reduce((sum, item) => sum + item.value, 0)
  const chartData = statusRows

  const healthRow = [
    {
      label: 'MongoDB',
      value: healthError ? 'unavailable' : health?.mongodb || 'unavailable',
      tone: healthError ? 'error' : health?.mongodb || 'error',
    },
    {
      label: 'Redis',
      value: healthError ? 'unavailable' : health?.redis || 'unavailable',
      tone: healthError ? 'error' : health?.redis || 'error',
    },
    {
      label: 'Worker',
      value: healthError ? 'unavailable' : health?.worker || 'unavailable',
      tone: healthError ? 'error' : health?.worker || 'error',
    },
  ]

  if (initialLoading) {
    return (
      <PageShell title="System Health" description="MongoDB, Redis, worker, and logs">
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="xl" />
            <span className="text-xs text-text-muted font-mono">loading</span>
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="System Health" description="MongoDB, Redis, worker, and logs">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Health Status</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            {healthRow.map((item) => (
              <HealthPill
                key={item.label}
                label={item.label}
                value={item.value}
                tone={item.tone}
              />
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardHeader>
              <CardTitle>Total Jobs</CardTitle>
            </CardHeader>
            <div className="text-3xl font-bold text-text font-mono">
              {metricsError ? 'unavailable' : totalJobs}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Completed</CardTitle>
            </CardHeader>
            <div className="text-3xl font-bold text-text font-mono">
              {metricsError ? 'unavailable' : toNumber(byStatus[STATUS.COMPLETED])}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Failed</CardTitle>
            </CardHeader>
            <div className="text-3xl font-bold text-text font-mono">
              {metricsError ? 'unavailable' : toNumber(byStatus[STATUS.FAILED])}
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>DLQ Size</CardTitle>
            </CardHeader>
            <div className="text-3xl font-bold text-text font-mono">
              {metricsError ? 'unavailable' : dlqSize}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Job Status Breakdown</CardTitle>
            </CardHeader>
            <div className="relative h-72">
              {metricsError ? (
                <div className="flex h-full items-center justify-center text-sm text-text-muted">
                  unavailable
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="status"
                        innerRadius={78}
                        outerRadius={110}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {chartData.map((entry) => (
                          <Cell key={entry.status} fill={PIE_COLORS[entry.status]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1c2128',
                          border: '1px solid #30363d',
                          borderRadius: '6px',
                          fontSize: '12px',
                          color: '#e6edf3',
                        }}
                        formatter={(value, name) => [value, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-3xl font-bold font-mono text-text">
                        {chartTotal}
                      </div>
                      <div className="text-xs text-text-muted">total jobs</div>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {statusRows.map((item) => (
                <div key={item.status} className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-text-muted font-mono">{item.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Logs</CardTitle>
            </CardHeader>
            <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
              {logsError ? (
                <div className="flex items-center justify-center py-10 text-sm text-text-muted">
                  unavailable
                </div>
              ) : logs.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-sm text-text-muted">
                  No recent logs
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={log.id || log._id || idx} className="flex items-start gap-3 rounded-md border border-border bg-surface-100/40 px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted font-mono">{timeAgo(log.timestamp || log.createdAt)}</span>
                        <LogEventBadge event={log.event} />
                      </div>
                      <p className="text-sm text-text">{log.message || log.text || JSON.stringify(log)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
