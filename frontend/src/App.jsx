import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { JobsPage } from './pages/JobsPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { MetricsPage } from './pages/MetricsPage'
import { DLQPage } from './pages/DLQPage'
import { LogsPage } from './pages/LogsPage'
import { useSSE } from './hooks/useSSE'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10000,
      refetchOnWindowFocus: false,
    },
  },
})

function SSEManager() {
  useSSE()
  return null
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SSEManager />
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: '#1c2128',
              color: '#e6edf3',
              border: '1px solid #30363d',
              fontSize: '13px',
              borderRadius: '6px',
            },
            success: {
              iconTheme: { primary: '#3fb950', secondary: '#0d5320' },
            },
            error: {
              iconTheme: { primary: '#f85149', secondary: '#8b1515' },
            },
          }}
        />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/dlq" element={<DLQPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
