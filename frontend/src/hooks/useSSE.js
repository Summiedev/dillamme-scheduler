import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sseManager } from '../lib/sse'
import { useJobStore } from '../store/jobStore'

function normalizeJob(job) {
  return {
    ...job,
    id: job.job_id || job.id,
    retryCount: job.retry_count ?? job.retryCount ?? 0,
    scheduledAt: job.scheduled_at || job.scheduledAt,
    createdAt: job.created_at || job.createdAt,
    updatedAt: job.updated_at || job.updatedAt,
    cancelRequested: job.cancel_requested ?? job.cancelRequested,
  }
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

    const unsubJobUpdated = sseManager.subscribe('job_updated', 'job_updated', (data) => {
      const job = data.job || data
      const id = job.job_id || job.id
      if (id) {
        const normalized = normalizeJob(job)
        upsertJob(normalized)
        queryClient.setQueryData(['jobs', id], normalized)
        queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: ['metrics'], refetchType: 'active' })
      }
    })

    const unsubJobDeleted = sseManager.subscribe('job_deleted', 'job_deleted', (data) => {
      const id = data.job_id
      if (id) {
        removeJob(id)
        queryClient.removeQueries({ queryKey: ['jobs', id] })
        queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'active' })
        queryClient.invalidateQueries({ queryKey: ['metrics'], refetchType: 'active' })
      }
    })

    const unsubDlqThreshold = sseManager.subscribe('dlq_threshold', 'dlq_threshold', () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'], refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['metrics'], refetchType: 'active' })
    })

    sseManager.connect('/events')

    cleanupRef.current = () => {
      unsubState()
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