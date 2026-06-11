import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dlqApi } from '../lib/api'

const DLQ_KEY = ['dlq']

export function useDLQMessages(params) {
  return useQuery({
    queryKey: [...DLQ_KEY, params],
    queryFn: async () => {
      const res = await dlqApi.list(params)
      const dlq = (res.dlq || []).map(d => ({
        ...d,
        id: d._id,
        jobId: d.job_id,
        retryCount: d.retry_count,
        failedAt: d.failed_at,
      }))
      return { ...res, data: dlq }
    },
  })
}

export function useDLQMessage(id) {
  return useQuery({
    queryKey: [...DLQ_KEY, id],
    queryFn: () => dlqApi.get(id),
    enabled: !!id,
  })
}

export function useRetryDLQ() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => dlqApi.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DLQ_KEY }),
  })
}

export function useRetryAllDLQ() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => dlqApi.retryAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DLQ_KEY }),
  })
}

export function useClearDLQ() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => dlqApi.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DLQ_KEY }),
  })
}