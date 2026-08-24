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

export type ConnectionStatus = 'unknown' | 'checking' | 'online' | 'offline'

const STORAGE_KEY = 'lgview.servers.v1'
const ACTIVE_KEY = 'lgview.activeServer.v1'
const HEALTH_INTERVAL_MS = 5000

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
  const [servers, setServers] = useLocalStorage<ServerEntry[]>(STORAGE_KEY, [])
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
      setServers((prev) => {
        const existing = prev.find((s) => s.id === entry.id)
        if (existing) return prev.map((s) => (s.id === entry.id ? { ...s, apiKey: entry.apiKey ?? s.apiKey } : s))
        return [...prev, entry]
      })
      setActiveId(entry.id)
      return entry
    },
    [setServers, setActiveId],
  )

  const removeServer = useCallback(
    (id: string) => {
      setServers((prev) => prev.filter((s) => s.id !== id))
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
        setServers((prev) => (prev.some((s) => s.id === entryId(url)) ? prev : [...prev, { id: entryId(url), url }]))
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
