const SSE_URL = import.meta.env.VITE_SSE_URL || '/api'

const MAX_RETRIES = 5

function createSingletonSSE() {
  let eventSource = null
  let listeners = new Map()
  let connectionState = 'disconnected'
  let retryCount = 0
  let retryTimer = null
  let currentEndpoint = null
  let stateChangeCallback = null

  function getDelay() {
    const delays = [3000, 6000, 12000, 24000, 48000]
    return delays[Math.min(retryCount, delays.length - 1)]
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
    retryCount = 0
    setState('connected')
  }

  function handleError() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    retryCount++
    if (retryCount >= MAX_RETRIES) {
      setState('error')
      return
    }
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

  function getState() {
    return { state: connectionState, retryCount }
  }

  return {
    connect,
    disconnect,
    subscribe,
    onStateChange,
    getState,
  }
}

export const sseManager = createSingletonSSE()