import { useState, useRef, useEffect } from 'react'
import { useLogs } from '../hooks/useLogs'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { PageSpinner } from '../components/ui/Spinner'
import { formatDate } from '../lib/utils'

const LEVELS = ['', 'info', 'warn', 'error', 'debug']

const LEVEL_STYLES = {
  info: 'text-accent border-l-accent-muted',
  warn: 'text-warning border-l-warning-muted',
  error: 'text-danger border-l-danger-muted',
  debug: 'text-text-muted border-l-surface-400',
}

export function LogsPage() {
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const bottomRef = useRef(null)
  const autoScroll = useRef(true)

  const { data, isLoading } = useLogs({ level: level || undefined, search: search || undefined })
  const logs = Array.isArray(data) ? data : data?.data ?? []

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
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-xs">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted"
              />
            </div>
            <div className="flex gap-0.5">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    level === l
                      ? 'bg-surface-200 text-text border border-surface-300'
                      : 'text-text-muted hover:text-text hover:bg-surface-100'
                  }`}
                  onClick={() => setLevel(l)}
                >
                  {l ? l.toUpperCase() : 'ALL'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        {isLoading ? (
          <PageSpinner />
        ) : (
          <div className="border-t border-border mt-3">
            <div className="h-[65vh] overflow-y-auto" onScroll={handleScroll}>
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-sm text-text-muted">
                  No logs found
                </div>
              ) : (
                <div className="font-mono text-xs leading-relaxed">
                  {logs.map((log, idx) => (
                    <div
                      key={log.id || idx}
                      className={`border-l-2 ${LEVEL_STYLES[log.level] || 'border-l-surface-300'} px-3 py-1.5 hover:bg-surface-100/50 border-b border-border/50`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-text-muted shrink-0 w-16 text-xs leading-relaxed">
                          {formatDate(log.timestamp || log.createdAt)}
                        </span>
                        <span className={`shrink-0 w-10 font-semibold text-xs leading-relaxed ${LEVEL_STYLES[log.level] || 'text-text-secondary'}`}>
                          {log.level || 'LOG'}
                        </span>
                        <span className="text-text-muted shrink-0 w-20 truncate text-xs leading-relaxed" title={log.jobId || log.source}>
                          {log.jobId || log.source || '-'}
                        </span>
                        <span className="text-text leading-relaxed break-all">
                          {log.message || log.text || JSON.stringify(log)}
                        </span>
                      </div>
                      {log.error && (
                        <div className="mt-1 ml-[7.5rem] text-danger bg-surface-200 rounded p-1.5 border border-border">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
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
