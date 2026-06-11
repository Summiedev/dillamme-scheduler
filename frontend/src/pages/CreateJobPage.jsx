import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateJob } from '../hooks/useJobs'
import { PageShell } from '../components/layout/PageShell'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { TagInput } from '../components/ui/TagInput'
import { JsonViewer } from '../components/ui/JsonViewer'
import { Badge } from '../components/ui/Badge'
import { PRIORITY, PRIORITY_LABELS } from '../constants/priority'
import toast from 'react-hot-toast'

function validatePayload(value) {
  if (!value || !value.trim()) return { valid: true, error: null }
  try {
    JSON.parse(value)
    return { valid: true, error: null }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}

const PRIORITY_OPTIONS = [
  { value: PRIORITY.HIGH, label: PRIORITY_LABELS[PRIORITY.HIGH] },
  { value: PRIORITY.MEDIUM, label: PRIORITY_LABELS[PRIORITY.MEDIUM] },
  { value: PRIORITY.LOW, label: PRIORITY_LABELS[PRIORITY.LOW] },
]

const INTERVAL_OPTIONS = [
  { value: 'every_1_minute', label: 'Every 1 Minute' },
  { value: 'every_5_minutes', label: 'Every 5 Minutes' },
  { value: 'every_1_hour', label: 'Every 1 Hour' },
]

export function CreateJobPage() {
  const navigate = useNavigate()
  const createJob = useCreateJob()

  const [type, setType] = useState('')
  const [payloadRaw, setPayloadRaw] = useState('')
  const [priority, setPriority] = useState(PRIORITY.MEDIUM)
  const [scheduledAt, setScheduledAt] = useState('')
  const [interval, setInterval] = useState('')
  const [maxRetries, setMaxRetries] = useState(3)
  const [tags, setTags] = useState([])
  const [dependencies, setDependencies] = useState([])
  const [depInput, setDepInput] = useState('')

  const { valid: payloadValid, error: payloadError } = validatePayload(payloadRaw)

  let parsedPayload = null
  if (payloadRaw && payloadRaw.trim()) {
    try { parsedPayload = JSON.parse(payloadRaw) } catch {}
  }

  const handleAddDependency = () => {
    const trimmed = depInput.trim()
    if (!trimmed) return
    if (dependencies.includes(trimmed)) {
      toast.error('Dependency already added')
      return
    }
    setDependencies([...dependencies, trimmed])
    setDepInput('')
  }

  const handleRemoveDependency = (jobId) => {
    setDependencies(dependencies.filter((d) => d !== jobId))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!type.trim()) {
      toast.error('Job type is required')
      return
    }
    if (payloadRaw && payloadRaw.trim() && !payloadValid) {
      toast.error('Invalid JSON payload')
      return
    }

    const body = {
      type: type.trim(),
      payload: parsedPayload || undefined,
      priority,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      interval: interval || undefined,
      max_retries: maxRetries,
      tags: tags.length ? tags : undefined,
      dependencies: dependencies.length ? dependencies : undefined,
    }

    createJob.mutate(body, {
      onSuccess: () => {
        toast.success('Job created successfully')
        navigate('/jobs')
      },
      onError: () => toast.error('Failed to create job'),
    })
  }

  return (
    <PageShell
      title="Create Job"
      description="Define a new scheduled job"
      actions={
        <Button variant="ghost" size="xs" onClick={() => navigate('/jobs')}>
          Cancel
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Type <span className="text-danger">*</span></label>
              <input
                type="text"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="webhook, email, report..."
                className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Priority</label>
              <div className="flex gap-1.5">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors capitalize ${
                      priority === opt.value
                        ? 'bg-accent-subtle/20 text-accent border-accent-muted/50'
                        : 'bg-surface-100 text-text-secondary border-border hover:text-text hover:bg-surface-200'
                    }`}
                    onClick={() => setPriority(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Scheduled At</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text"
              >
                <option value="">None (one-time)</option>
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Max Retries</label>
              <input
                type="number"
                value={maxRetries}
                onChange={(e) => setMaxRetries(Math.max(0, parseInt(e.target.value) || 0))}
                min="0"
                max="100"
                className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text font-mono"
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <TagInput tags={tags} onChange={setTags} placeholder="Add tag and press Enter..." />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dependencies</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={depInput}
                onChange={(e) => setDepInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDependency())}
                placeholder="Enter job ID to depend on..."
                className="flex-1 px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted font-mono"
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleAddDependency}>Add</Button>
            </div>
            {dependencies.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {dependencies.map((dep) => (
                  <span key={dep} className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-200 text-text-secondary text-xs rounded-sm border border-surface-300">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="font-mono">{dep.slice(0, 12)}</span>
                    <button
                      type="button"
                      className="text-text-muted hover:text-danger ml-1"
                      onClick={() => handleRemoveDependency(dep)}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payload</CardTitle>
            {payloadRaw && payloadRaw.trim() && (
              <Badge variant={payloadValid ? 'success' : 'danger'}>
                {payloadValid ? 'Valid JSON' : 'Invalid JSON'}
              </Badge>
            )}
          </CardHeader>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <textarea
                value={payloadRaw}
                onChange={(e) => setPayloadRaw(e.target.value)}
                placeholder='{"key": "value"}'
                rows={10}
                className="w-full px-2.5 py-2 text-xs font-mono bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted resize-none"
                spellCheck={false}
              />
              {!payloadValid && payloadError && (
                <p className="mt-1 text-2xs text-danger font-mono">{payloadError}</p>
              )}
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-text-muted bg-surface-100 border-b border-border">
                Preview
              </div>
              {parsedPayload ? (
                <div className="p-2">
                  <JsonViewer data={parsedPayload} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-xs text-text-muted">
                  {payloadRaw ? 'Invalid JSON' : 'Enter JSON to preview'}
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-2 pt-2">
          <Button type="submit" loading={createJob.isPending}>
            Create Job
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/jobs')}>
            Cancel
          </Button>
        </div>
      </form>
    </PageShell>
  )
}