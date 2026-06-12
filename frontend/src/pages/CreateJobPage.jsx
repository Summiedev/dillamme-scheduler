import { useEffect, useMemo, useRef, useState } from 'react'
import { useCreateJob } from '../hooks/useJobs'
import { jobsApi } from '../lib/api'
import { Card, CardHeader, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { JsonViewer } from '../components/ui/JsonViewer'
import { Badge } from '../components/ui/Badge'
import { PRIORITY, PRIORITY_LABELS } from '../constants/priority'
import toast from 'react-hot-toast'

const JOB_TYPES = ['send_email', 'webhook', 'log_processing']

const TYPE_EXAMPLES = {
  send_email: {
    to: 'user@example.com',
    subject: 'Your weekly report is ready',
    body: 'Hi there, your report has been generated.',
  },
  webhook: {
    url: 'https://webhook.site/test',
    method: 'POST',
    body: {
      event: 'job.completed',
      timestamp: '2026-06-12T00:00:00Z',
    },
  },
  log_processing: {
    message: 'User login event detected',
    level: 'info',
    source: 'auth-service',
    metadata: {
      user_id: 'u_12345',
      ip: '192.168.1.1',
    },
  },
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

const INITIAL_ERRORS = {
  type: '',
  payload: '',
  priority: '',
  maxRetries: '',
}

function formatPayload(type) {
  return JSON.stringify(TYPE_EXAMPLES[type], null, 2)
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validatePayload(type, payloadRaw) {
  if (!payloadRaw || !payloadRaw.trim()) {
    return 'Payload is required'
  }

  let payload
  try {
    payload = JSON.parse(payloadRaw)
  } catch {
    return 'Payload must be valid JSON'
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Payload must be a JSON object'
  }

  if (type === 'send_email') {
    if (!isValidEmail(String(payload.to || ''))) {
      return 'Payload must include a valid "to" email address'
    }
    if (!String(payload.subject || '').trim()) {
      return 'Payload must include a non-empty "subject"'
    }
  }

  if (type === 'webhook') {
    const url = String(payload.url || '')
    if (!/^https?:\/\/.+/i.test(url)) {
      return 'Payload must include a url starting with http:// or https://'
    }
  }

  if (type === 'log_processing') {
    if (!String(payload.message || '').trim()) {
      return 'Payload must include a non-empty "message"'
    }
  }

  return ''
}

function validateForm({ type, payloadRaw, priority, maxRetries }) {
  const errors = { ...INITIAL_ERRORS }

  if (!type || !JOB_TYPES.includes(type)) {
    errors.type = 'Job type is required'
  }

  const payloadError = validatePayload(type, payloadRaw)
  if (payloadError) {
    errors.payload = payloadError
  }

  if (priority === undefined || priority === null || priority === '') {
    errors.priority = 'Priority is required'
  }

  const parsedMaxRetries = Number.parseInt(maxRetries, 10)
  if (!Number.isInteger(parsedMaxRetries) || parsedMaxRetries < 0 || parsedMaxRetries > 10) {
    errors.maxRetries = 'Max retries must be between 0 and 10'
  }

  return errors
}

function TypeIcon({ type }) {
  if (type === 'webhook') {
    return (
      <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8V6a5 5 0 0110 0v2m-6 4h2m-4 0h.01M6 10h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2z" />
      </svg>
    )
  }

  if (type === 'log_processing') {
    return (
      <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
      </svg>
    )
  }

  return (
    <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l4-4m0 0l4 4m-4-4v12m10-7a4 4 0 10-8 0v7m8-7a4 4 0 018 0v7" />
    </svg>
  )
}

async function fetchAllJobs() {
  const limit = 500
  let offset = 0
  const allJobs = []

  while (true) {
    const response = await jobsApi.list({ limit, offset })
    const jobs = Array.isArray(response.jobs) ? response.jobs : []
    allJobs.push(...jobs)

    if (jobs.length < limit || (response.total != null && allJobs.length >= response.total)) {
      break
    }

    offset += limit
  }

  return allJobs
}

export function CreateJobPage({ open = false, onClose = () => {} }) {
  const createJob = useCreateJob()
  const dropdownRef = useRef(null)

  const [mounted, setMounted] = useState(open)
  const [active, setActive] = useState(false)
  const [type, setType] = useState('send_email')
  const [payloadRaw, setPayloadRaw] = useState(formatPayload('send_email'))
  const [priority, setPriority] = useState(PRIORITY.MEDIUM)
  const [scheduledAt, setScheduledAt] = useState('')
  const [interval, setInterval] = useState('')
  const [maxRetries, setMaxRetries] = useState('3')
  const [dependencies, setDependencies] = useState([])
  const [dependencyJobs, setDependencyJobs] = useState([])
  const [dependencySearch, setDependencySearch] = useState('')
  const [dependencyOpen, setDependencyOpen] = useState(false)
  const [dependencyLoading, setDependencyLoading] = useState(false)
  const [dependencyError, setDependencyError] = useState('')
  const [errors, setErrors] = useState(INITIAL_ERRORS)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let timer

    if (open) {
      setMounted(true)
      setType('send_email')
      setPayloadRaw(formatPayload('send_email'))
      setPriority(PRIORITY.MEDIUM)
      setScheduledAt('')
      setInterval('')
      setMaxRetries('3')
      setDependencies([])
      setDependencyJobs([])
      setDependencySearch('')
      setDependencyOpen(false)
      setDependencyLoading(false)
      setDependencyError('')
      setErrors(INITIAL_ERRORS)
      setSubmitted(false)

      requestAnimationFrame(() => setActive(true))
    } else {
      setActive(false)
      timer = window.setTimeout(() => setMounted(false), 200)
    }

    return () => {
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [open])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDependencyOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadJobs = async () => {
      if (!dependencyOpen || !mounted) return
      setDependencyLoading(true)
      setDependencyError('')
      try {
        const jobs = await fetchAllJobs()
        if (!cancelled) {
          setDependencyJobs(jobs)
        }
      } catch {
        if (!cancelled) {
          setDependencyJobs([])
          setDependencyError('Unable to load jobs')
        }
      } finally {
        if (!cancelled) {
          setDependencyLoading(false)
        }
      }
    }

    loadJobs()

    return () => {
      cancelled = true
    }
  }, [dependencyOpen, mounted])

  const parsedPayload = useMemo(() => {
    try {
      return payloadRaw && payloadRaw.trim() ? JSON.parse(payloadRaw) : null
    } catch {
      return null
    }
  }, [payloadRaw])

  const currentErrors = useMemo(
    () => validateForm({ type, payloadRaw, priority, maxRetries }),
    [type, payloadRaw, priority, maxRetries]
  )

  const dependencyMap = useMemo(() => {
    const map = new Map()
    for (const job of dependencyJobs) {
      map.set(job.job_id, job)
    }
    for (const job of dependencies) {
      if (!map.has(job.job_id)) {
        map.set(job.job_id, job)
      }
    }
    return map
  }, [dependencyJobs, dependencies])

  const filteredDependencyJobs = useMemo(() => {
    const selectedIds = new Set(dependencies.map((job) => job.job_id))
    const search = dependencySearch.trim().toLowerCase()

    return dependencyJobs.filter((job) => {
      if (selectedIds.has(job.job_id)) return false
      if (!search) return true
      const haystack = `${job.job_id} ${job.type || ''} ${job.status || ''}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [dependencyJobs, dependencies, dependencySearch])

  useEffect(() => {
    if (submitted) {
      setErrors(currentErrors)
    }
  }, [currentErrors, submitted])

  const handleTypeChange = (value) => {
    setType(value)
    setPayloadRaw(formatPayload(value))
  }

  const handleAddDependency = (job) => {
    if (dependencies.some((item) => item.job_id === job.job_id)) {
      return
    }
    setDependencies([...dependencies, job])
    setDependencySearch('')
  }

  const handleRemoveDependency = (jobId) => {
    setDependencies(dependencies.filter((job) => job.job_id !== jobId))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)

    const nextErrors = validateForm({ type, payloadRaw, priority, maxRetries })
    setErrors(nextErrors)

    if (Object.values(nextErrors).some(Boolean)) {
      return
    }

    let payload = undefined
    try {
      payload = JSON.parse(payloadRaw)
    } catch {}

    const body = {
      type,
      payload,
      priority,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      interval: interval || undefined,
      max_retries: Number.parseInt(maxRetries, 10),
      dependencies: dependencies.length ? dependencies.map((job) => job.job_id) : undefined,
    }

    createJob.mutate(body, {
      onSuccess: () => {
        toast.success('Job created successfully')
        onClose()
      },
      onError: () => toast.error('Failed to create job'),
    })
  }

  if (!mounted) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className={`absolute inset-0 bg-surface-950/70 backdrop-blur-sm transition-opacity duration-200 ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-job-title"
        className={`relative z-10 flex w-full max-w-[600px] max-h-[85vh] flex-col overflow-hidden rounded-xl border border-border bg-surface-0 shadow-2xl transition-all duration-200 ${
          active ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-2 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-100 border border-border">
            <TypeIcon type={type} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="create-job-title" className="text-base font-semibold text-text">
              Create Job
            </h2>
            <p className="text-sm text-text-muted">
              Configure the job, then submit it to the scheduler
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:text-text hover:bg-surface-100"
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
              </CardHeader>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">Type</label>
                  <select
                    value={type}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text"
                    autoFocus
                  >
                    <option value="send_email">send_email</option>
                    <option value="webhook">webhook</option>
                    <option value="log_processing">log_processing</option>
                  </select>
                  {errors.type && <p className="text-sm text-danger font-mono">{errors.type}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">Priority</label>
                  <div className="flex gap-1.5">
                    {PRIORITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`px-2.5 py-1.5 text-base font-medium rounded-md border transition-colors capitalize ${
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
                  {errors.priority && <p className="text-sm text-danger font-mono">{errors.priority}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">Scheduled At</label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">Interval</label>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text"
                  >
                    <option value="">None (one-time)</option>
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">Max Retries</label>
                  <input
                    type="number"
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(e.target.value)}
                    min="0"
                    max="10"
                    className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text font-mono"
                  />
                  {errors.maxRetries && <p className="text-sm text-danger font-mono">{errors.maxRetries}</p>}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dependencies</CardTitle>
              </CardHeader>
              <div className="space-y-2" ref={dropdownRef}>
                <div className="relative">
                  <input
                    type="text"
                    value={dependencySearch}
                    onChange={(e) => {
                      setDependencySearch(e.target.value)
                      setDependencyOpen(true)
                    }}
                    onFocus={() => setDependencyOpen(true)}
                    placeholder="Search jobs to depend on..."
                    className="w-full px-2.5 py-1.5 text-sm bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setDependencyOpen((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                    aria-label="Toggle dependency dropdown"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {dependencyOpen && (
                  <div className="rounded-md border border-border bg-surface-0 shadow-sm max-h-52 overflow-y-auto">
                    {dependencyLoading ? (
                      <div className="px-3 py-2 text-base text-text-muted">Loading jobs...</div>
                    ) : dependencyError ? (
                      <div className="px-3 py-2 text-base text-text-muted">{dependencyError}</div>
                    ) : dependencyJobs.length === 0 ? (
                      <div className="px-3 py-2 text-base text-text-muted">No jobs available</div>
                    ) : filteredDependencyJobs.length === 0 ? (
                      <div className="px-3 py-2 text-base text-text-muted">
                        {dependencySearch.trim() ? 'No matching jobs found' : 'No jobs available'}
                      </div>
                    ) : (
                      filteredDependencyJobs.map((job) => (
                        <button
                          key={job.job_id}
                          type="button"
                          onClick={() => handleAddDependency(job)}
                          className="w-full text-left px-3 py-2 text-base text-text hover:bg-surface-100 border-b border-border/50 last:border-b-0"
                        >
                          <span className="font-mono">
                            {job.job_id.slice(0, 12)} — {job.type || '-'} — {job.status || '-'}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {dependencies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dependencies.map((job) => (
                      <span
                        key={job.job_id}
                        className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-200 text-text-secondary text-base rounded-sm border border-surface-300"
                      >
                        <span className="font-mono">{job.job_id.slice(0, 12)}</span>
                        <span className="text-text-muted font-mono">{job.type || '-'}</span>
                        <button
                          type="button"
                          className="text-text-muted hover:text-danger ml-1"
                          onClick={() => handleRemoveDependency(job.job_id)}
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
                  <Badge variant={parsedPayload ? 'success' : 'danger'}>
                    {parsedPayload ? 'Valid JSON' : 'Invalid JSON'}
                  </Badge>
                )}
              </CardHeader>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <textarea
                    value={payloadRaw}
                    onChange={(e) => setPayloadRaw(e.target.value)}
                    placeholder={formatPayload(type)}
                    rows={10}
                    className="w-full px-2.5 py-2 text-sm font-mono bg-surface-100 border border-border rounded-md focus:outline-none focus:border-accent-muted focus:ring-1 focus:ring-accent/30 text-text placeholder:text-text-muted resize-none"
                    spellCheck={false}
                  />
                  {errors.payload && <p className="text-sm text-danger font-mono">{errors.payload}</p>}
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="px-2.5 py-1.5 text-sm font-semibold uppercase tracking-wider text-text-muted bg-surface-100 border-b border-border">
                    Preview
                  </div>
                  {parsedPayload ? (
                    <div className="p-2">
                      <JsonViewer data={parsedPayload} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-base text-text-muted">
                      {payloadRaw ? 'Invalid JSON' : 'Enter JSON to preview'}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="border-t border-border bg-surface-0/95 px-4 py-3 sm:px-5 sm:py-4 backdrop-blur">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" loading={createJob.isPending} className="w-full sm:w-auto">
                Create Job
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
