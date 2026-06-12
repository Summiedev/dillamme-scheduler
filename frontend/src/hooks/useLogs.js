import { useQuery } from '@tanstack/react-query'
import { logsApi } from '../lib/api'

export function useLogs(params) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => logsApi.list(params),
    refetchInterval: 3000,
    staleTime: 0,
  })
}

export function useLog(id) {
  return useQuery({
    queryKey: ['logs', id],
    queryFn: () => logsApi.get(id),
    enabled: !!id,
  })
}
