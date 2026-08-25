/**
 * The list of LangGraph servers the user knows about, and which one is live.
 *
 * The CLI tells us its `--server` on first load; after that the user's own
 * list wins, so restarting `lgview` with a different flag adds a server rather
 * than silently switching the one they were looking at.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Connection } from '../api/client'
import type { ServerInfo } from '../api/types'
import { useLocalStorage } from './useLocalStorage'

export interface ServerEntry {
  id: string
  url: string
  apiKey?: string
}

/** What actually goes to disk: the server list, never the keys. */
interface StoredServer {
  id: string
  url: string
}

export type ConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline'

const STORAGE_KEY = 'lgview.servers.v2'
const ACTIVE_KEY = 'lgview.activeServer.v1'
const KEY_STORAGE_PREFIX = 'lgview.apiKey.'
const HEALTH_INTERVAL_MS = 5000

/**
 * API keys live in sessionStorage, not localStorage.
 *
 * A LangGraph Platform key unlocks every thread and checkpoint in a tenant --
 * that is, other people's conversations. Persisting it to disk indefinitely so
 * that any script running on this origin can read it forever is a poor trade
 * for saving one paste. sessionStorage is scoped to the tab and cleared when it
 * closes, which is the right lifetime for a credential in a dev tool.
 *
 * The v1 key is read once and discarded so existing users are not silently
 * left with a key on disk.
 */
function readApiKey(id: string): string | undefined {
  try {
    return window.sessionStorage.getItem(KEY_STORAGE_PREFIX + id) ?? undefined
  } catch {
    return undefined
  }
}

function writeApiKey(id: string, apiKey: string | undefined): void {
  try {
    if (apiKey) window.sessionStorage.setItem(KEY_STORAGE_PREFIX + id, apiKey)
    else window.sessionStorage.removeItem(KEY_STORAGE_PREFIX + id)
  } catch {
    // Storage disabled. The key still works for this page's lifetime.
  }
}

/** Drop anything a previous version wrote to disk, keys included. */
function migrateFromV1(): void {
  try {
    const legacy = window.localStorage.getItem('lgview.servers.v1')
    if (legacy === null) return
    window.localStorage.removeItem('lgview.servers.v1')
    const parsed: unknown = JSON.parse(legacy)
    if (!Array.isArray(parsed)) return
    const cleaned: StoredServer[] = parsed
      .filter((entry): entry is ServerEntry => Boolean(entry) && typeof entry === 'object' && 'url' in entry)
      .map((entry) => ({ id: entry.id, url: entry.url }))
    if (cleaned.length > 0 && window.localStorage.getItem(STORAGE_KEY) === null) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
    }
  } catch {
    // A hand-edited or truncated value; starting fresh is the safe outcome.
  }
}

migrateFromV1()

export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    return new URL(withScheme).toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function entryId(url: string): string {
  return url.toLowerCase()
}

export function useServers() {
  const [stored, setServers] = useLocalStorage<StoredServer[]>(STORAGE_KEY, [])
  // Shape-check on read: a hand-edited or future-version payload used to be
  // cast straight through, and the first `.url` access blanked the page.
  const servers: ServerEntry[] = (Array.isArray(stored) ? stored : [])
    .filter((entry): entry is StoredServer => Boolean(entry) && typeof entry.url === 'string' && typeof entry.id === 'string')
    .map((entry) => ({ ...entry, apiKey: readApiKey(entry.id) }))
  const [activeId, setActiveId] = useLocalStorage<string | null>(ACTIVE_KEY, null)
  const [status, setStatus] = useState<ConnectionStatus>('unknown')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)

  const addServer = useCallback(
    (rawUrl: string, apiKey?: string): ServerEntry | null => {
      const url = normalizeUrl(rawUrl)
      if (!url) return null
      const entry: ServerEntry = { id: entryId(url), url, apiKey: apiKey || undefined }
      if (apiKey) writeApiKey(entry.id, apiKey)
      setServers((prev) => {
        const existing = (Array.isArray(prev) ? prev : []).find((s) => s.id === entry.id)
        if (existing) return prev
        return [...(Array.isArray(prev) ? prev : []), { id: entry.id, url: entry.url }]
      })
      setActiveId(entry.id)
      return entry
    },
    [setServers, setActiveId],
  )

  const removeServer = useCallback(
    (id: string) => {
      writeApiKey(id, undefined)
      setServers((prev) => (Array.isArray(prev) ? prev.filter((s) => s.id !== id) : []))
      setActiveId((prev) => (prev === id ? null : prev))
    },
    [setServers, setActiveId],
  )

  // Seed from the CLI's --server the first time this browser sees lgview.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/__lgview/config')
        const config = (await res.json()) as { defaultServer?: string }
        if (cancelled || !config.defaultServer) return
        const url = normalizeUrl(config.defaultServer)
        if (!url) return
        setServers((prev) => {
          const list = Array.isArray(prev) ? prev : []
          return list.some((s) => s.id === entryId(url)) ? list : [...list, { id: entryId(url), url }]
        })
        setActiveId((prev) => prev ?? entryId(url))
      } catch {
        // Running against a static host without the CLI; the user picks manually.
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setServers, setActiveId])

  const active = servers.find((s) => s.id === activeId) ?? null
  const connection: Connection | null = active ? { url: active.url, apiKey: active.apiKey } : null

  // Poll health so an upstream restart is visible without a page reload.
  useEffect(() => {
    if (!connection) {
      setStatus('unknown')
      setInfo(null)
      return
    }
    let cancelled = false
    let timer: number | undefined

    const check = async () => {
      if (cancelled) return
      setStatus((prev) => (prev === 'online' ? prev : 'checking'))
      try {
        const serverInfo = await api.info(connection)
        if (cancelled) return
        setInfo(serverInfo)
        setStatus('online')
        setError(null)
      } catch (err) {
        if (cancelled) return
        setStatus('offline')
        setInfo(null)
        setError(err instanceof ApiError ? err.message : 'could not reach the server')
      } finally {
        if (!cancelled) timer = window.setTimeout(check, HEALTH_INTERVAL_MS)
      }
    }
    void check()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [connection?.url, connection?.apiKey])

  return {
    servers,
    active,
    activeId,
    connection,
    status,
    info,
    error,
    bootstrapped,
    addServer,
    removeServer,
    selectServer: setActiveId,
  }
}
