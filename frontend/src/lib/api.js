const BASE_URL = import.meta.env.VITE_API_URL || '/api'

async function request(path, options = {}) {
  const controller = new AbortController()
  const config = {
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body)
  }
  const response = await fetch(`${BASE_URL}${path}`, config)
  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      errorMessage = body.message || body.error || errorMessage
    } catch {}
    const error = new Error(errorMessage)
    error.status = response.status
    throw error
  }
  return response.json()
}

export function cancelRequest() {
  return new AbortController()
}

export const jobsApi = {
  list(params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request(`/jobs${qs}`)
  },
  get(id) {
    return request(`/jobs/${id}`)
  },
  create(data) {
    return request('/jobs', { method: 'POST', body: data })
  },
  update(id, data) {
    return request(`/jobs/${id}`, { method: 'PUT', body: data })
  },
 delete(id) {
  return request(`/jobs/${id}`, { method: 'DELETE' })
},
cancel(id) {
  return request(`/jobs/${id}/cancel`, { method: 'POST' })
},
  retry(id) {
    return request(`/jobs/${id}/retry`, { method: 'POST' })
  },
//   pause(id) {
//     return request(`/jobs/${id}/pause`, { method: 'POST' })
//   },
//   resume(id) {
//     return request(`/jobs/${id}/resume`, { method: 'POST' })
//   },
}

export const metricsApi = {
  get(params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request(`/metrics${qs}`)
  },
  history(params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request(`/metrics/history${qs}`)
  },
}

export const dlqApi = {
  list(params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request(`/dlq${qs}`)
  },
  get(id) {
    return request(`/dlq/${id}`)
  },
  retry(id) {
    return request(`/dlq/${id}/retry`, { method: 'POST' })
  },
  retryAll() {
    return request('/dlq/retry-all', { method: 'POST' })
  },
  clear() {
    return request('/dlq', { method: 'DELETE' })
  },
}

export const logsApi = {
  list(params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request(`/logs${qs}`)
  },
  get(id) {
    return request(`/logs/${id}`)
  },
}
