import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AppLayout } from './components/layout/AppLayout'
import { Badge } from './components/ui/Badge'
import { Button } from './components/ui/Button'
import { DashboardPage } from './pages/DashboardPage'
import { JobsPage } from './pages/JobsPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { MetricsPage } from './pages/MetricsPage'
import { DLQPage } from './pages/DLQPage'
import { LogsPage } from './pages/LogsPage'
import { useSSE } from './hooks/useSSE'
import { useActivityStore } from './store/activityStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: true,
    },
  },
})

function SSEManager() {
  useSSE()
  return null
}

function EmailAlertModal() {
  const emailAlert = useActivityStore((s) => s.emailAlert)
  const dismissEmailAlert = useActivityStore((s) => s.dismissEmailAlert)

  if (!emailAlert) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-surface-950/75 backdrop-blur-sm"
        onClick={dismissEmailAlert}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-alert-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface-0 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <Badge variant="success" size="sm">Email Sent</Badge>
            <h2 id="email-alert-title" className="mt-2 text-base font-semibold text-text">
              Message delivered successfully
            </h2>
            <p className="text-sm text-text-muted">
              The frontend got the live completion event from the worker.
            </p>
          </div>
          <Button variant="ghost" size="xs" onClick={dismissEmailAlert} aria-label="Close email alert">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-muted">To</span>
              <span className="font-mono text-text break-all">{emailAlert.to || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-muted">Subject</span>
              <span className="font-mono text-text break-all text-right">{emailAlert.subject || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-muted">Job ID</span>
              <span className="font-mono text-text break-all">{emailAlert.jobId || '-'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-muted">Message ID</span>
              <span className="font-mono text-text break-all">{emailAlert.messageId || '-'}</span>
            </div>
          </div>
          <div className="rounded-md border border-success-muted/30 bg-success-subtle/10 px-3 py-2">
            <p className="text-sm text-success font-medium">{emailAlert.message || 'Email sent'}</p>
            <p className="mt-1 text-xs text-text-muted font-mono">{emailAlert.timestamp || ''}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SSEManager />
        <EmailAlertModal />
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
