import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sseManager } from '../lib/sse'
import { useJobStore } from '../store/jobStore'

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

export function useSSE() {
  const queryClient = useQueryClient()
  const cleanupRef = useRef(null)
  const setSSEStatus = useJobStore((s) => s.setSSEStatus)
  const upsertJob = useJobStore((s) => s.upsertJob)
  const removeJob = useJobStore((s) => s.removeJob)
  const setLoading = useJobStore((s) => s.setLoading)

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
      unsubJobDeleted()
      unsubDlqThreshold()
      sseManager.disconnect()
    }

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
    }
  }, [setSSEStatus, upsertJob, removeJob, setLoading, queryClient])
}
