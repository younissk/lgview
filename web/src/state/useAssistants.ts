/**
 * Discovers the graphs a server exposes and keeps their topology current.
 *
 * `langgraph dev` hot-reloads on file save, so the graph you are looking at can
 * change under you. We poll the topology and swap it in when it actually
 * differs, which is what makes the canvas feel live rather than stale.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Connection } from '../api/client'
import type { Assistant, AssistantSchemas, GraphJson } from '../api/types'

const GRAPH_POLL_MS = 2500
const ASSISTANT_POLL_MS = 4000

export interface AssistantsState {
  assistants: Assistant[]
  selected: Assistant | null
  graph: GraphJson | null
  schemas: AssistantSchemas | null
  loading: boolean
  error: string | null
  /** Bumped whenever the topology changed underneath us. */
  reloadCount: number
  select: (assistantId: string) => void
  refresh: () => void
}

export function useAssistants(connection: Connection | null): AssistantsState {
  const [assistants, setAssistants] = useState<Assistant[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [graph, setGraph] = useState<GraphJson | null>(null)
  const [schemas, setSchemas] = useState<AssistantSchemas | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [nonce, setNonce] = useState(0)

  const graphFingerprint = useRef<string | null>(null)
  const assistantFingerprint = useRef<string | null>(null)
  const selected = assistants.find((a) => a.assistant_id === selectedId) ?? null

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Assistant list, polled rather than fetched once.
  //
  // Polling is what makes the UI survive the server going away: `langgraph dev`
  // gets restarted constantly, and a one-shot fetch that failed while it was
  // down would leave the graph picker permanently empty even after it came
  // back. It also picks up a graph newly added to langgraph.json.
  useEffect(() => {
    if (!connection) {
      setAssistants([])
      setSelectedId(null)
      assistantFingerprint.current = null
      return
    }
    let cancelled = false
    let timer: number | undefined
    setLoading(true)

    const poll = async () => {
      if (cancelled) return
      try {
        const found = await api.searchAssistants(connection)
        if (cancelled) return
        found.sort((a, b) => a.graph_id.localeCompare(b.graph_id))
        const fingerprint = JSON.stringify(found.map((a) => [a.assistant_id, a.graph_id, a.version]))
        if (fingerprint !== assistantFingerprint.current) {
          assistantFingerprint.current = fingerprint
          setAssistants(found)
          setSelectedId((prev) => {
            if (prev && found.some((a) => a.assistant_id === prev)) return prev
            return found[0]?.assistant_id ?? null
          })
        }
        setError(null)
      } catch (err) {
        if (cancelled) return
        // Keep whatever we last knew about; the banner already says we are
        // offline, and blanking the picker on a blip is worse than stale.
        if (assistantFingerprint.current === null) {
          setError(err instanceof Error ? err.message : 'could not list graphs')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          timer = window.setTimeout(() => void poll(), ASSISTANT_POLL_MS)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [connection?.url, connection?.apiKey, nonce])

  // Schemas are per-assistant and only change on reload, so fetch them once.
  // Note: this endpoint requires the assistant UUID, not the graph name.
  useEffect(() => {
    if (!connection || !selected) {
      setSchemas(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api.schemas(connection, selected.assistant_id)
        if (!cancelled) setSchemas(result)
      } catch {
        if (!cancelled) setSchemas(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connection?.url, connection?.apiKey, selected?.assistant_id, reloadCount])

  // Topology, polled so a hot reload shows up on the canvas by itself.
  useEffect(() => {
    if (!connection || !selected) {
      setGraph(null)
      graphFingerprint.current = null
      return
    }
    graphFingerprint.current = null
    let cancelled = false
    let timer: number | undefined

    const poll = async (initial: boolean) => {
      if (cancelled) return
      try {
        const next = await api.graph(connection, selected.assistant_id)
        if (cancelled) return
        const fingerprint = JSON.stringify(next)
        if (fingerprint !== graphFingerprint.current) {
          const isReload = !initial && graphFingerprint.current !== null
          graphFingerprint.current = fingerprint
          setGraph(next)
          if (isReload) setReloadCount((count) => count + 1)
        }
        setError(null)
      } catch (err) {
        if (cancelled) return
        if (graphFingerprint.current === null) {
          setGraph(null)
          setError(err instanceof Error ? err.message : 'could not load the graph')
        }
        // A failure after we have drawn something usually means the dev server
        // is restarting after a save. Keep the last good drawing and retry.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(false), GRAPH_POLL_MS)
      }
    }

    void poll(true)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [connection?.url, connection?.apiKey, selected?.assistant_id])

  return {
    assistants,
    selected,
    graph,
    schemas,
    loading,
    error,
    reloadCount,
    select: setSelectedId,
    refresh,
  }
}
