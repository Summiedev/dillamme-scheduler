import { Drawer } from '../ui/Drawer'
import { StatusBadge } from '../ui/StatusBadge'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { JsonViewer } from '../ui/JsonViewer'
import { Spinner } from '../ui/Spinner'
import { useJob, useCancelJob, useRetryJob, useDeleteJob } from '../../hooks/useJobs'
import { formatDate, formatDuration, timeAgo } from '../../lib/utils'
import { STATUS } from '../../constants/status'
import { PRIORITY, PRIORITY_LABELS } from '../../constants/priority'
import toast from 'react-hot-toast'

export function JobDrawer({ jobId, open, onClose }) {
  const { data: job, isLoading } = useJob(jobId)
  const cancelJob = useCancelJob()
  const retryJob = useRetryJob()
  const deleteJob = useDeleteJob()

  const handleCancel = () => {
    cancelJob.mutate(jobId, {
      onSuccess: () => toast.success('Job cancelled'),
      onError: () => toast.error('Failed to cancel job'),
    })
  }

  const handleRetry = () => {
    retryJob.mutate(jobId, {
      onSuccess: () => toast.success('Job queued for retry'),
      onError: () => toast.error('Failed to retry job'),
    })
  }

  const handleDelete = () => {
    if (window.confirm('Delete this job permanently?')) {
      deleteJob.mutate(jobId, {
        onSuccess: () => { toast.success('Job deleted'); onClose() },
        onError: () => toast.error('Failed to delete job'),
      })
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={job?.name || 'Job Details'} size="lg">
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      ) : !job ? (
        <div className="text-center py-16 text-text-muted text-base">Job not found</div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            {job.priority && (
              <Badge variant={job.priority === PRIORITY.HIGH ? 'warning' : job.priority === PRIORITY.LOW ? 'default' : 'neutral'}>
                {PRIORITY_LABELS[job.priority] || job.priority}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {[
              ['ID', job.id],
              ['Type', job.type],
              ['Created', formatDate(job.createdAt)],
              ['Updated', formatDate(job.updatedAt)],
              ['Duration', formatDuration(job.duration)],
              ['Retries', `${job.retryCount ?? 0} / ${job.maxRetries ?? '-'}`],
              ['Last Run', job.lastRunAt ? timeAgo(job.lastRunAt) : '-'],
              ['Scheduled', job.scheduledAt ? formatDate(job.scheduledAt) : '-'],
              ['Interval', job.interval || '-'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</dt>
                <dd className="mt-0.5 text-sm text-text font-mono break-all">{value}</dd>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            {(job.status === STATUS.PENDING || job.status === STATUS.PROCESSING) && (
              <Button variant="secondary" size="sm" onClick={handleCancel} loading={cancelJob.isPending}>Cancel</Button>
            )}
            {job.status === STATUS.FAILED && (
              <Button variant="secondary" size="sm" onClick={handleRetry} loading={retryJob.isPending}>Retry</Button>
            )}
            <Button variant="danger" size="sm" onClick={handleDelete} loading={deleteJob.isPending}>Delete</Button>
          </div>

          {job.error && (
            <div>
              <h4 className="text-sm font-semibold text-text mb-1.5">Error</h4>
              <div className="bg-surface-100 border border-border rounded-md p-2.5">
                <pre className="text-sm text-danger font-mono whitespace-pre-wrap break-all">{typeof job.error === 'string' ? job.error : JSON.stringify(job.error, null, 2)}</pre>
              </div>
            </div>
          )}

          {job.data && (
            <div>
              <h4 className="text-sm font-semibold text-text mb-1.5">Payload</h4>
              <JsonViewer data={job.data} />
            </div>
          )}

          {job.result && (
            <div>
              <h4 className="text-sm font-semibold text-text mb-1.5">Result</h4>
              <JsonViewer data={job.result} />
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
