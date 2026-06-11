import { create } from 'zustand'

const initialState = {
  jobs: {},
  selectedJob: null,
  metrics: null,
  sseStatus: 'disconnected',
  retryCount: 0,
  isLoading: false,
  isError: false,
  error: null,
}

export const useJobStore = create((set, get) => ({
  ...initialState,

  setJobs(jobs) {
    const map = {}
    for (const job of jobs) {
      map[job.id] = job
    }
    set({ jobs: map, isLoading: false })
  },

  upsertJob(job) {
    set((state) => ({
      jobs: {
        ...state.jobs,
        [job.id]: { ...state.jobs[job.id], ...job },
      },
    }))
  },

  removeJob(id) {
    set((state) => {
      const { [id]: _, ...rest } = state.jobs
      return { jobs: rest, selectedJob: state.selectedJob === id ? null : state.selectedJob }
    })
  },

  setSelectedJob(job) {
    set({ selectedJob: job })
  },

  setMetrics(metrics) {
    set({ metrics })
  },

  setSSEStatus(status) {
    set({
      sseStatus: status.state,
      retryCount: status.retryCount,
      isError: status.state === 'error',
      error: status.state === 'error' ? 'SSE connection failed after max retries' : null,
    })
  },

  setLoading() {
    set({ isLoading: true, isError: false, error: null })
  },

  setError(error) {
    set({ isError: true, error: error?.message || error, isLoading: false })
  },

  resetError() {
    set({ isError: false, error: null })
  },
}))