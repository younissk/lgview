export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatClock(at: number): string {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return ''
  return id.replace(/-/g, '').slice(0, length)
}

/** A one-line preview of a value, for collapsed rows and list items. */
export function summarize(value: unknown, max = 72): string {
  const text = renderInline(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function renderInline(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`
  }
  return String(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
