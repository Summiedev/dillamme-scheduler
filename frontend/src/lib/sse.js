const SSE_URL = import.meta.env.VITE_SSE_URL || '/api'
const BASE_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30000

function createSingletonSSE() {
  let eventSource = null
  let listeners = new Map()
  let connectionState = 'disconnected'
  let retryCount = 0
  let retryTimer = null
  let currentEndpoint = null
  let stateChangeCallback = null
  let reconnectCallback = null

  function getDelay() {
    const exponential = Math.min(BASE_RETRY_DELAY_MS * (2 ** retryCount), MAX_RETRY_DELAY_MS)
    const jitter = 0.5 + Math.random()
    return Math.round(exponential * jitter)
  }

  function setState(state) {
    connectionState = state
    if (stateChangeCallback) {
      stateChangeCallback({ state, retryCount })
    }
  }

  function notifyListeners(event, data) {
    for (const [, handler] of listeners) {
      if (handler.event === event) {
        handler.callback(data)
      }
    }
  }

  function handleOpen() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    const wasRetrying = retryCount > 0
    retryCount = 0
    setState('connected')
    if (wasRetrying && reconnectCallback) {
      reconnectCallback()
    }
  }

  function handleError() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    retryCount++
    setState('reconnecting')
    scheduleReconnect()
  }

  function scheduleReconnect() {
    if (retryTimer) clearTimeout(retryTimer)
    const endpoint = currentEndpoint
    retryTimer = setTimeout(() => {
      if (endpoint) connect(endpoint)
    }, getDelay())
  }

  function connect(endpoint) {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    currentEndpoint = endpoint
    const url = `${SSE_URL}${endpoint}`
    eventSource = new EventSource(url)
    eventSource.onopen = handleOpen
    eventSource.onerror = handleError
    eventSource.addEventListener('job_updated', (e) => {
      notifyListeners('job_updated', JSON.parse(e.data))
    })
    eventSource.addEventListener('dlq_threshold', (e) => {
      notifyListeners('dlq_threshold', JSON.parse(e.data))
    })
    eventSource.addEventListener('job_deleted', (e) => {
      notifyListeners('job_deleted', JSON.parse(e.data))
    })
  }

  function disconnect() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    retryCount = 0
    currentEndpoint = null
    if (eventSource) {
      eventSource.onopen = null
      eventSource.onerror = null
      eventSource.close()
      eventSource = null
    }
    setState('disconnected')
  }

  function subscribe(id, event, callback) {
    listeners.set(id, { event, callback })
    return () => {
      listeners.delete(id)
    }
  }

  function onStateChange(callback) {
    stateChangeCallback = callback
    return () => {
      stateChangeCallback = null
    }
  }

  function onReconnect(callback) {
    reconnectCallback = callback
    return () => {
      reconnectCallback = null
    }
  }

  function getState() {
    return { state: connectionState, retryCount }
  }

  return {
    connect,
    disconnect,
    subscribe,
    onStateChange,
    onReconnect,
    getState,
  }
}

export const sseManager = createSingletonSSE()
