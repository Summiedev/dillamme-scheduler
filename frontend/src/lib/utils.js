import { format, formatDistanceToNow, parseISO } from 'date-fns'

export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(date) {
  if (!date) return '-'
  try {
    return format(parseISO(date), 'MMM d, yyyy HH:mm:ss')
  } catch {
    return '-'
  }
}

export function timeAgo(date) {
  if (!date) return '-'
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true })
  } catch {
    return '-'
  }
}

export function formatDuration(ms) {
  if (ms == null) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function truncate(str, len = 50) {
  if (!str) return ''
  if (str.length <= len) return str
  return str.slice(0, len) + '...'
}

export function paginate(array, page, perPage) {
  const start = (page - 1) * perPage
  return array.slice(start, start + perPage)
}

export function buildQueryString(params) {
  const filtered = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  )
  if (filtered.length === 0) return ''
  return '?' + new URLSearchParams(filtered).toString()
}