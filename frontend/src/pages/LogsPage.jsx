import { useState, useRef, useEffect, useMemo } from 'react'
import { useLogs } from '../hooks/useLogs'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import { formatDate } from '../lib/utils'

const EVENT_FILTERS = [
  { value: '', label: 'All' },
  { value: 'job_created', label: 'Created' },
  { value: 'job_started', label: 'Started' },
  { value: 'retry_attempted', label: 'Retries' },
  { value: 'job_failed', label: 'Failed' },
  { value: 'job_failed_dlq', label: 'DLQ' },
  { value: 'job_completed', label: 'Completed' },
  { value: 'job_cancelled', label: 'Cancelled' },
  { value: 'recurring_scheduled', label: 'Recurring' },
  { value: 'job_failed_dependency', label: 'Dependency' },
  { value: 'job_retry_requested', label: 'Manual Retry' },
]

const EVENT_META = {
  job_created: { label: 'Created', tone: 'accent', bar: 'border-l-accent-muted' },
  job_started: { label: 'Started', tone: 'neutral', bar: 'border-l-surface-400' },
  retry_attempted: { label: 'Retry', tone: 'warning', bar: 'border-l-warning-muted' },
  job_failed: { label: 'Failed', tone: 'danger', bar: 'border-l-danger-muted' },
  job_failed_dlq: { label: 'DLQ', tone: 'danger', bar: 'border-l-danger-muted' },
  job_completed: { label: 'Completed', tone: 'success', bar: 'border-l-success-muted' },
  job_cancelled: { label: 'Cancelled', tone: 'warning', bar: 'border-l-warning-muted' },
  recurring_scheduled: { label: 'Recurring', tone: 'accent', bar: 'border-l-accent-muted' },
  job_failed_dependency: { label: 'Dependency', tone: 'danger', bar: 'border-l-danger-muted' },
  job_retry_requested: { label: 'Manual Retry', tone: 'accent', bar: 'border-l-accent-muted' },
}

export function LogsPage() {
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')
  const bottomRef = useRef(null)
  const autoScroll = useRef(true)

  const { data, isLoading } = useLogs({ level: eventFilter || undefined, search: search || undefined })
  const rawLogs = Array.isArray(data) ? data : data?.logs ?? []

  const logs = useMemo(() => {
    return rawLogs.map((log) => {
      const event = log.event || log.level || 'log'
      return {
        ...log,
        event,
        label: EVENT_META[event]?.label || event,
        jobId: log.jobId || log.job_id,
        createdAt: log.createdAt || log.timestamp,
      }
    })
  }, [rawLogs])

  useEffect(() => {
    if (autoScroll.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const handleScroll = (e) => {
    const el = e.target
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  return (
    <PageShell title="Logs" description="System and job execution logs">
      <Card padding={false}>
        <CardHeader className="px-3 pt-3 pb-0">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1 max-w-xl">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search event text, job id, or message..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_FILTERS.map((item) => (
                  <button
                    key={item.value || 'all'}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      eventFilter === item.value
                        ? 'bg-surface-200 text-text border-surface-300'
                        : 'text-text-muted hover:text-text hover:bg-surface-100 border-transparent'
                    }`}
                    onClick={() => setEventFilter(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>

        {isLoading ? (
          <PageSpinner />
        ) : (
          <div className="border-t border-border mt-3">
            <div className="h-[65vh] overflow-y-auto px-3 pb-3" onScroll={handleScroll}>
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-sm text-text-muted gap-2">
                  <span className="font-mono text-xs uppercase tracking-[0.2em]">No logs found</span>
                  <span className="text-xs text-text-muted">Try switching to All or a different event tab.</span>
                </div>
              ) : (
                <div className="space-y-2 pt-3">
                  {logs.map((log, idx) => (
                    <div
                      key={log.id || idx}
                      className={`rounded-md border border-border border-l-2 bg-surface-100/40 px-3 py-2 shadow-sm ${EVENT_META[log.event]?.bar || 'border-l-surface-300'}`}
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={EVENT_META[log.event]?.tone || 'neutral'}
                              size="sm"
                              className="uppercase tracking-wide"
                            >
                              {log.label}
                            </Badge>
                            <span className="text-xs text-text-muted font-mono">
                              {formatDate(log.timestamp || log.createdAt)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                            <span className="font-mono">job: {log.jobId || log.source || '-'}</span>
                            <span className="text-text-muted/70">|</span>
                            <span className="font-mono">event: {log.event || 'log'}</span>
                          </div>
                          <p className="text-sm text-text leading-relaxed break-words">
                            {log.message || log.text || JSON.stringify(log)}
                          </p>
                        </div>
                      </div>
                      {log.error && (
                        <div className="mt-2 text-danger bg-surface-200 rounded p-2 border border-border">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">
                            {typeof log.error === 'string' ? log.error : JSON.stringify(log.error, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </PageShell>
  )
}
