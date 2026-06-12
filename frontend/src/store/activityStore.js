import { create } from 'zustand'

const initialState = {
  activities: [],
  emailAlert: null,
}

export const useActivityStore = create((set) => ({
  ...initialState,

  pushActivity(activity) {
    if (!activity) return
    set((state) => ({
      activities: [activity, ...state.activities].slice(0, 20),
    }))
  },

  clearActivities() {
    set({ activities: [] })
  },

  showEmailAlert(alert) {
    set({ emailAlert: alert })
  },

  dismissEmailAlert() {
    set({ emailAlert: null })
  },
}))
