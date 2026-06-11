import { useParams, useNavigate } from 'react-router-dom'
import { useJob, useCancelJob, useRetryJob } from '../../hooks/useJobs'
import { Card, CardHeader, CardTitle } from '../ui/Card'
import { StatusBadge } from '../ui/StatusBadge'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { PageSpinner } from '../ui/Spinner'
import { JsonViewer } from '../ui/JsonViewer'
import { formatDate, formatDuration } from '../../lib/utils'
import { STATUS } from '../../constants/status'
import { PRIORITY, PRIORITY_LABELS, PRIORITY_COLORS } from '../../constants/priority'
import toast from 'react-hot-toast'

export function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: job, isLoading } = useJob(id)
  const cancelJob = useCancelJob()
  const retryJob = useRetryJob()

  if (isLoading) return <PageSpinner />
  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted">Job not found</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/jobs')}>
          Back to Jobs
        </Button>
      </div>
    )
  }

  const handleCancel = () => {
    cancelJob.mutate(id, {
      onSuccess: () => toast.success('Job cancelled'),
      onError: () => toast.error('Failed to cancel job'),
    })
  }

  const handleRetry = () => {
    retryJob.mutate(id, {
      onSuccess: () => toast.success('Job queued for retry'),
      onError: () => toast.error('Failed to retry job'),
    })
  }

  const detailFields = [
    { label: 'ID', value: job.id },
    { label: 'Name', value: job.name },
    { label: 'Type', value: job.type },
    { label: 'Status', value: <StatusBadge status={job.status} /> },
    { label: 'Priority', value: job.priority && <Badge variant={job.priority === PRIORITY.HIGH ? 'warning' : job.priority === PRIORITY.LOW ? 'default' : 'neutral'}>{PRIORITY_LABELS[job.priority] || job.priority}</Badge> },
    { label: 'Scheduled At', value: job.scheduledAt ? formatDate(job.scheduledAt) : '-' },
    { label: 'Interval', value: job.interval || '-' },
    { label: 'Created', value: formatDate(job.createdAt) },
    { label: 'Updated', value: formatDate(job.updatedAt) },
    { label: 'Duration', value: formatDuration(job.duration) },
    { label: 'Retries', value: `${job.retryCount ?? 0} / ${job.maxRetries ?? '-'}` },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/jobs')}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Button>
          <h2 className="text-xl font-bold text-text">{job.name || 'Job Details'}</h2>
        </div>
        <div className="flex items-center gap-2">
          {(job.status === STATUS.PENDING || job.status === STATUS.PROCESSING) && (
            <Button variant="secondary" size="sm" onClick={handleCancel} loading={cancelJob.isPending}>
              Cancel
            </Button>
          )}
          {job.status === STATUS.FAILED && (
            <Button variant="secondary" size="sm" onClick={handleRetry} loading={retryJob.isPending}>
              Retry
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job Information</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
          {detailFields.map((field) => (
            field.value !== undefined && field.value !== null && (
              <div key={field.label}>
                <dt className="text-2xs font-semibold uppercase tracking-wider text-text-muted">{field.label}</dt>
                <dd className="mt-1 text-sm text-text">{field.value}</dd>
              </div>
            )
          ))}
        </dl>
      </Card>

      {job.error && (
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <JsonViewer data={job.error} />
        </Card>
      )}

      {job.payload && (
        <Card>
          <CardHeader>
            <CardTitle>Payload</CardTitle>
          </CardHeader>
          <JsonViewer data={job.payload} />
        </Card>
      )}
    </div>
  )
}