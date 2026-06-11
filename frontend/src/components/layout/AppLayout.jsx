import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <div className={`fixed inset-0 z-40 md:relative md:z-auto md:block ${sidebarOpen ? '' : 'hidden md:block'}`}>
        <div
          className="absolute inset-0 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
        <div className="relative z-50 md:z-auto">
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}