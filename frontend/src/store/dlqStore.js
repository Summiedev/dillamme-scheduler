import { create } from 'zustand'

export const useDLQStore = create((set) => ({
  alerts: [],
  alertCount: 0,

  addAlert(alert) {
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 100),
      alertCount: state.alertCount + 1,
    }))
  },

  clearAlerts() {
    set({ alerts: [], alertCount: 0 })
  },

  dismissAlert(id) {
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
      alertCount: Math.max(0, state.alertCount - 1),
    }))
  },
}))