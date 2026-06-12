import { useState, useCallback, useMemo } from 'react'
import { useJobs, useCancelJob, useRetryJob, useDeleteJob } from '../hooks/useJobs'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Table, Thead, Th, Tbody, Tr, Td } from '../components/ui/Table'
import { StatusBadge } from '../components/ui/StatusBadge'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { PageSpinner, InlineSpinner } from '../components/ui/Spinner'
import { EmptyState } from '../components/ui/EmptyState'
import { JobDrawer } from '../components/jobs/JobDrawer'
import { CreateJobPage } from './CreateJobPage'
import { formatDate, timeAgo } from '../lib/utils'
import { STATUS } from '../constants/status'
import { PRIORITY, PRIORITY_LABELS, PRIORITY_COLORS } from '../constants/priority'
import { useJobStore } from '../store/jobStore'
import toast from 'react-hot-toast'

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  ...Object.values(STATUS).map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
]

export function JobsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const cancelJob = useCancelJob()
  const retryJob = useRetryJob()
  const deleteJob = useDeleteJob()

  const params = useMemo(
    () => ({ page, limit: 20, search: search || undefined, status: statusFilter || undefined }),
    [page, search, statusFilter]
  )
  const { data, isLoading } = useJobs(params)
  const liveJobs = useJobStore((state) => state.jobs)
  const jobs = useMemo(() => {
    const baseJobs = Array.isArray(data) ? data : data?.data ?? data?.jobs ?? []
    return baseJobs.map((job) => {
      const liveJob = liveJobs[job.id]
      return liveJob ? { ...job, ...liveJob } : job
    })
  }, [data, liveJobs])
  const total = data?.total ?? jobs.length
  const totalPages = data?.totalPages || Math.ceil(total / 20) || 1

  const openDrawer = useCallback((id) => {
    setSelectedJobId(id)
    setDrawerOpen(true)
  }, [])

  const handleAction = (action, id, e) => {
    e.stopPropagation()
    action.mutate(id, {
      onSuccess: () => toast.success('Action completed'),
      onError: () => toast.error('Action failed'),
    })
  }

  return (
    <PageShell
      title="Jobs"
      description="Monitor and manage scheduled jobs"
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Job
        </Button>
      }
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:w-64">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-full pl-8 pr-3 py-1.5 text-base bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted"
          />
        </div>
        <SegmentedControl options={STATUS_OPTIONS} value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} size="xs" />
        <span className="text-xs text-text-muted font-mono ml-auto">{total} result{total !== 1 ? 's' : ''}</span>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            title="No jobs found"
            description={search || statusFilter ? 'Try adjusting your filters' : 'Create your first job to get started'}
            actionLabel={!search && !statusFilter ? 'Create Job' : undefined}
            onAction={() => setCreateOpen(true)}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>ID</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Priority</Th>
                  <Th className="hidden sm:table-cell">Retries</Th>
                  <Th className="hidden lg:table-cell">Scheduled</Th>
                  <Th className="hidden lg:table-cell">Interval</Th>
                  <Th className="hidden sm:table-cell">Created</Th>
                  <Th className="w-24">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {jobs.map((job) => {
                  const priorityLabel = PRIORITY_LABELS[job.priority]
                  const priorityColor = PRIORITY_COLORS[job.priority]
                  return (
                    <Tr key={job.id} onClick={() => openDrawer(job.id)}>
                      <Td>
                        <span className="text-base font-mono text-text">{job.id?.slice(0, 12)}</span>
                      </Td>
                      <Td className="text-base text-text-secondary">{job.type || '-'}</Td>
                      <Td><StatusBadge status={job.status} /></Td>
                      <Td className="hidden md:table-cell">
                        {priorityLabel && (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-base font-mono font-medium ${priorityColor?.bg || 'bg-surface-200'} ${priorityColor?.text || 'text-text-muted'} border ${priorityColor?.border || 'border-surface-300'}`}>
                            {priorityLabel}
                          </span>
                        )}
                      </Td>
                      <Td className="hidden sm:table-cell text-base text-text-muted font-mono">{job.retryCount ?? 0}/{job.maxRetries ?? '-'}</Td>
                      <Td className="hidden lg:table-cell text-base text-text-muted font-mono" title={formatDate(job.scheduledAt)}>
                        {job.scheduledAt ? timeAgo(job.scheduledAt) : '-'}
                      </Td>
                      <Td className="hidden lg:table-cell text-base text-text-muted font-mono">
                        {job.interval || '-'}
                      </Td>
                      <Td className="hidden sm:table-cell text-base text-text-muted font-mono" title={formatDate(job.createdAt)}>
                        {timeAgo(job.createdAt)}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          {(job.status === STATUS.PENDING || job.status === STATUS.PROCESSING) && (
                            <Button size="xs" variant="ghost" onClick={(e) => handleAction(cancelJob, job.id, e)} title="Cancel">
                              <svg className="w-3.5 h-3.5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </Button>
                          )}
                          {job.status === STATUS.FAILED && (
                            <Button size="xs" variant="ghost" onClick={(e) => handleAction(retryJob, job.id, e)} title="Retry">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </Button>
                          )}
                          <Button size="xs" variant="ghost" onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this job permanently?')) { deleteJob.mutate(job.id); } }} title="Delete">
                            <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2.5 border-t border-border">
              <span className="text-xs text-text-muted font-mono">Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button size="xs" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="xs" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <JobDrawer jobId={selectedJobId} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <CreateJobPage open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageShell>
  )
}
