import { useQuery } from '@tanstack/react-query'
import { metricsApi } from '../lib/api'

export function useMetrics(params) {
  return useQuery({
    queryKey: ['metrics', params],
    queryFn: () => metricsApi.get(params),
  })
}

export function useMetricsHistory(params) {
  return useQuery({
    queryKey: ['metrics', 'history', params],
    queryFn: () => metricsApi.history(params),
  })
}