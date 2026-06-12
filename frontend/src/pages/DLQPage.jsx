import { useState } from 'react'
import { useDLQMessages, useRetryDLQ } from '../hooks/useDLQ'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { PulseIndicator } from '../components/ui/PulseIndicator'
import { PageSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { JsonViewer } from '../components/ui/JsonViewer'
import { formatDate, timeAgo, truncate } from '../lib/utils'
import toast from 'react-hot-toast'

export function DLQPage() {
  const { data, isLoading } = useDLQMessages()
  const retry = useRetryDLQ()
  const [expandedId, setExpandedId] = useState(null)

  const messages = Array.isArray(data) ? data : data?.data ?? []

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id)
  }

  const handleRetry = (id) => {
    retry.mutate(id, {
      onSuccess: () => toast.success('Message sent for retry'),
      onError: () => toast.error('Failed to retry message'),
    })
  }

  if (isLoading) return <PageSpinner />

  return (
    <PageShell
      title="Dead Letter Queue"
      description="Messages that failed after all retry attempts"
      actions={undefined}
    >
      <Card padding={false}>
        {messages.length === 0 ? (
          <EmptyState
            title="No failed messages"
            description="The dead letter queue is empty"
            compact
          />
        ) : (
          <div>
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="w-6"></Th>
                    <Th>ID</Th>
                    <Th>Job ID</Th>
                    <Th>Error</Th>
                    <Th className="hidden md:table-cell">Failed</Th>
                    <Th className="hidden sm:table-cell">Retries</Th>
                    <Th className="w-24">Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {messages.map((msg, idx) => {
                    const isExpanded = expandedId === msg.id
                    const errorDetail = msg.error || msg.message
                    const payload = msg.payload || msg.data

                    return (
                      <Tr key={msg.id || idx}>
                        <Td>
                          <button
                            className="p-0.5 rounded text-text-muted hover:text-text"
                            onClick={() => toggleExpand(msg.id)}
                            tabIndex={0}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </Td>
                        <Td>
                          <span className="font-mono text-sm text-text-secondary">{truncate(msg.id, 12)}</span>
                        </Td>
                        <Td>
                          <span className="font-mono text-sm text-accent">{truncate(msg.job_id || msg.jobId, 12)}</span>
                        </Td>
                        <Td className="max-w-xs">
                          <div className="flex items-center gap-1.5">
                            <PulseIndicator variant="danger" size="sm" pulsing={false} />
                            <span className="text-sm text-danger truncate block" title={typeof errorDetail === 'string' ? errorDetail : ''}>
                              {typeof errorDetail === 'string' ? truncate(errorDetail, 60) : 'Error occurred'}
                            </span>
                          </div>
                        </Td>
                        <Td className="hidden md:table-cell text-sm text-text-muted font-mono">{formatDate(msg.failedAt || msg.createdAt)}</Td>
                        <Td className="hidden sm:table-cell text-sm text-text-muted font-mono">{msg.retryCount ?? 0}</Td>
                        <Td>
                          <Button size="xs" variant="secondary" onClick={() => handleRetry(msg.job_id || msg.jobId)} loading={retry.isPending}>
                            Retry
                          </Button>
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </div>

            <div className="divide-y divide-border">
              {messages.map((msg, idx) => {
                const isExpanded = expandedId === msg.id
                if (!isExpanded) return null
                const errorDetail = msg.error || msg.message
                const payload = msg.payload || msg.data

                return (
                  <div key={`detail-${msg.id || idx}`} className="p-3 bg-surface-100 animate-fade-in space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">Error Details</h4>
                      <div className="bg-surface-200 rounded-md p-2.5 border border-border">
                        <pre className="text-sm text-danger font-mono whitespace-pre-wrap break-all">
                          {typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail, null, 2)}
                        </pre>
                      </div>
                    </div>
                    {(msg.stack_trace || msg.stack) && (
  <div>
    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
      Stack Trace
    </h4>
    <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap bg-surface-200 rounded p-2 border border-border max-h-32 overflow-y-auto">
      {msg.stack_trace || msg.stack}
    </pre>
  </div>
)}
                    {payload && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">Message Payload</h4>
                        <JsonViewer data={payload} />
                      </div>
                    )}
                    {msg.headers && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">Headers</h4>
                        <JsonViewer data={msg.headers} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>
    </PageShell>
  )
}
