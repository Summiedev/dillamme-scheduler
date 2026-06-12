import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sseManager } from '../lib/sse'
import { useJobStore } from '../store/jobStore'
import { useActivityStore } from '../store/activityStore'

function normalizeJob(job, previous = {}) {
  return {
    ...previous,
    ...job,
    id: job.job_id || job.id || previous.id,
    retryCount: job.retry_count ?? job.retryCount ?? previous.retryCount ?? 0,
    maxRetries: job.max_retries ?? job.maxRetries ?? previous.maxRetries,
    scheduledAt: job.scheduled_at || job.scheduledAt || previous.scheduledAt,
    createdAt: job.created_at || job.createdAt || previous.createdAt,
    updatedAt: job.updated_at || job.updatedAt || previous.updatedAt,
    cancelRequested: job.cancel_requested ?? job.cancelRequested ?? previous.cancelRequested,
  }
}

function upsertJobInCache(cache, job) {
  if (!cache) return cache

  const id = job.id
  const upsertIntoArray = (items = []) => {
    const index = items.findIndex((item) => (item?.id || item?.job_id) === id)
    if (index === -1) {
      return [...items, job]
    }
    const next = [...items]
    next[index] = { ...next[index], ...job }
    return next
  }

  if (Array.isArray(cache)) {
    return upsertIntoArray(cache)
  }

  if (Array.isArray(cache.jobs) || Array.isArray(cache.data)) {
    const nextJobs = Array.isArray(cache.jobs) ? upsertIntoArray(cache.jobs) : cache.jobs
    const nextData = Array.isArray(cache.data) ? upsertIntoArray(cache.data) : cache.data
    return {
      ...cache,
      ...(Array.isArray(cache.jobs) ? { jobs: nextJobs } : {}),
      ...(Array.isArray(cache.data) ? { data: nextData } : {}),
    }
  }

  if ((cache.id || cache.job_id) === id) {
    return { ...cache, ...job }
  }

  return cache
}

function formatActivityFromJob(job) {
  const jobType = job.type || 'job'
  const jobId = job.id

  if (job.status === 'processing') {
    return {
      id: `${jobId}-processing-${job.updatedAt || Date.now()}`,
      event: 'job_started',
      title: 'Job started',
      message: `${jobType} is now processing`,
      jobId,
      timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
      tone: 'accent',
    }
  }

  if (job.status === 'pending') {
    if ((job.retryCount ?? 0) > 0) {
      return {
        id: `${jobId}-retry-${job.retryCount}-${job.updatedAt || Date.now()}`,
        event: 'retry_attempted',
        title: 'Retry scheduled',
        message: `Attempt ${job.retryCount}/${job.maxRetries || '-'} will run again soon`,
        jobId,
        timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
        tone: 'warning',
      }
    }

    return {
      id: `${jobId}-created-${job.createdAt || Date.now()}`,
      event: 'job_created',
      title: 'Job created',
      message: `${jobType} queued and waiting to run`,
      jobId,
      timestamp: job.createdAt || job.updatedAt || new Date().toISOString(),
      tone: 'accent',
    }
  }

  if (job.status === 'completed') {
    if (jobType === 'send_email') {
      return null
    }

    return {
      id: `${jobId}-completed-${job.updatedAt || Date.now()}`,
      event: 'job_completed',
      title: 'Job completed',
      message: `${jobType} finished successfully`,
      jobId,
      timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
      tone: 'success',
    }
  }

  if (job.status === 'failed') {
    const movedToDlq = Boolean(job.dlq?.active)
    return {
      id: `${jobId}-${movedToDlq ? 'dlq' : 'failed'}-${job.updatedAt || Date.now()}`,
      event: movedToDlq ? 'job_failed_dlq' : 'job_failed',
      title: movedToDlq ? 'Moved to DLQ' : 'Job failed',
      message: movedToDlq
        ? `${jobType} exhausted its retries and entered the DLQ`
        : `${jobType} failed and will retry`,
      jobId,
      timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
      tone: 'danger',
    }
  }

  if (job.status === 'cancelled') {
    return {
      id: `${jobId}-cancelled-${job.updatedAt || Date.now()}`,
      event: 'job_cancelled',
      title: 'Job cancelled',
      message: `${jobType} will not be processed`,
      jobId,
      timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
      tone: 'warning',
    }
  }

  return null
}

export function useSSE() {
  const queryClient = useQueryClient()
  const cleanupRef = useRef(null)
  const setSSEStatus = useJobStore((s) => s.setSSEStatus)
  const upsertJob = useJobStore((s) => s.upsertJob)
  const removeJob = useJobStore((s) => s.removeJob)
  const setLoading = useJobStore((s) => s.setLoading)
  const pushActivity = useActivityStore((s) => s.pushActivity)
  const showEmailAlert = useActivityStore((s) => s.showEmailAlert)

  useEffect(() => {
    setLoading()

    const unsubState = sseManager.onStateChange((status) => {
      setSSEStatus(status)
    })

    const unsubReconnect = sseManager.onReconnect(() => {
      queryClient.refetchQueries({ type: 'active' })
    })

    const unsubJobUpdated = sseManager.subscribe('job_updated', 'job_updated', (data) => {
      const job = data.job || data
      const id = job.job_id || job.id
      if (!id) return

      const currentJob = queryClient.getQueryData(['jobs', id]) || useJobStore.getState().jobs[id]
      const normalized = normalizeJob(job, currentJob)

      // 1. Update zustand store (triggers UI merge immediately)
      upsertJob(normalized)

      // 2. Directly update the React Query cache for the individual job
      queryClient.setQueryData(['jobs', id], normalized)

      // 3. Update all list query caches in-place (no refetch needed)
      queryClient.setQueriesData(
        { queryKey: ['jobs'], type: 'active' },
        (cache) => upsertJobInCache(cache, normalized),
      )

      queryClient.invalidateQueries({
        queryKey: ['logs'],
        refetchType: 'active',
      })

      const activity = formatActivityFromJob(normalized)
      if (activity) {
        pushActivity(activity)
      }
    })

    const unsubEmailSent = sseManager.subscribe('email_sent', 'email_sent', (data) => {
      const activity = {
        id: `${data.job_id || data.message_id || Date.now()}-email-sent`,
        event: 'email_sent',
        title: 'Email sent',
        message: `Email sent to ${data.to || 'recipient'}`,
        jobId: data.job_id,
        timestamp: data.sent_at || new Date().toISOString(),
        tone: 'success',
      }
      pushActivity(activity)
      showEmailAlert({
        ...activity,
        to: data.to || '',
        subject: data.subject || '',
        messageId: data.message_id || '',
      })
    })

    const unsubJobDeleted = sseManager.subscribe('job_deleted', 'job_deleted', (data) => {
      const id = data.job_id
      if (!id) return

      removeJob(id)
      queryClient.removeQueries({ queryKey: ['jobs', id] })

      // Remove from all list caches
      queryClient.setQueriesData(
        { queryKey: ['jobs'], type: 'active' },
        (cache) => {
          if (!cache) return cache
          const removeFromArray = (items = []) =>
            items.filter((item) => (item?.id || item?.job_id) !== id)
          if (Array.isArray(cache)) return removeFromArray(cache)
          if (Array.isArray(cache.jobs)) return { ...cache, jobs: removeFromArray(cache.jobs) }
          if (Array.isArray(cache.data)) return { ...cache, data: removeFromArray(cache.data) }
          return cache
        },
      )
    })

    const unsubDlqThreshold = sseManager.subscribe('dlq_threshold', 'dlq_threshold', () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'], refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['metrics'], refetchType: 'active' })
    })

    sseManager.connect('/events')

    cleanupRef.current = () => {
      unsubState()
      unsubReconnect()
      unsubJobUpdated()
      unsubEmailSent()
      unsubJobDeleted()
      unsubDlqThreshold()
      sseManager.disconnect()
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
    }
  }, [setSSEStatus, upsertJob, removeJob, setLoading, pushActivity, showEmailAlert, queryClient])
}
