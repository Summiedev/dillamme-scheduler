import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi } from '../lib/api'

const JOBS_KEY = ['jobs']

export function useJobs(params) {
  return useQuery({
    queryKey: [...JOBS_KEY, params],
    queryFn: async () => {
  const res = await jobsApi.list(params)
  const jobs = (res.jobs || []).map(j => ({
    ...j,
    id: j.job_id,
    retryCount: j.retry_count,
    maxRetries: j.max_retries,
    scheduledAt: j.scheduled_at,
    createdAt: j.created_at,
  }))
  return { ...res, jobs, data: jobs }
},
    placeholderData: (prev) => prev,
  })
}

export function useJob(id) {
  return useQuery({
    queryKey: [...JOBS_KEY, id],
    queryFn: async () => {
      const res = await jobsApi.get(id)
      return {
        ...res,
        id: res.job_id,
        retryCount: res.retry_count,
        maxRetries: res.max_retries,
        scheduledAt: res.scheduled_at,
        createdAt: res.created_at,
        updatedAt: res.updated_at,
      }
    },
    enabled: !!id,
    placeholderData: (prev) => prev,
  })
}

export function useCreateJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => jobsApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => jobsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function useCancelJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => jobsApi.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function useRetryJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => jobsApi.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function usePauseJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => jobsApi.pause(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function useResumeJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => jobsApi.resume(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}