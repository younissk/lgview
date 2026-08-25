/** Thread list, current thread state, and checkpoint history for time travel. */
import { useCallback, useEffect, useState } from 'react'
import { api, type Connection } from '../api/client'
import type { Thread, ThreadState } from '../api/types'

export function useThreads(connection: Connection | null, graphId: string | null) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [state, setState] = useState<ThreadState | null>(null)
  const [history, setHistory] = useState<ThreadState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refreshThreads = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!connection) {
      setThreads([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const found = await api.searchThreads(connection, { limit: 40, graphId: graphId ?? undefined })
        if (!cancelled) setThreads(found)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'could not list threads')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connection?.url, connection?.apiKey, graphId, nonce])

  // Selecting a different graph should not leave a foreign thread selected.
  useEffect(() => {
    setThreadId(null)
    setState(null)
    setHistory([])
  }, [graphId, connection?.url])

  /**
   * Load a thread's current state and checkpoint history.
   *
   * `signal` matters: without it, switching threads quickly could land the
   * slower response last and show thread A's state under thread B's label. So
   * could a failure -- the old code left the previous thread's values,
   * checkpoints and node colours on screen when the fetch threw, which is how
   * restarting `langgraph dev` from a different project produced a UI
   * confidently displaying data for a thread that no longer existed.
   */
  const loadState = useCallback(
    async (id: string, signal?: AbortSignal) => {
      if (!connection) return
      try {
        const [current, past] = await Promise.all([
          api.threadState(connection, id),
          api.threadHistory(connection, id, 40).catch(() => [] as ThreadState[]),
        ])
        if (signal?.aborted) return
        setState(current)
        setHistory(past)
        setError(null)
      } catch (err) {
        if (signal?.aborted) return
        setState(null)
        setHistory([])
        setError(err instanceof Error ? err.message : 'could not load the thread')
      }
    },
    [connection?.url, connection?.apiKey],
  )

  useEffect(() => {
    if (!threadId) return
    const controller = new AbortController()
    void loadState(threadId, controller.signal)
    return () => controller.abort()
  }, [threadId, loadState])

  const createThread = useCallback(
    async (metadata?: Record<string, unknown>): Promise<string | null> => {
      if (!connection) return null
      try {
        const thread = await api.createThread(connection, metadata)
        setThreadId(thread.thread_id)
        setState(null)
        setHistory([])
        refreshThreads()
        return thread.thread_id
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not create a thread')
        return null
      }
    },
    [connection?.url, connection?.apiKey, refreshThreads],
  )

  const deleteThread = useCallback(
    async (id: string) => {
      if (!connection) return
      try {
        await api.deleteThread(connection, id)
        setThreadId((prev) => (prev === id ? null : prev))
        refreshThreads()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not delete the thread')
      }
    },
    [connection?.url, connection?.apiKey, refreshThreads],
  )

  return {
    threads,
    threadId,
    state,
    history,
    error,
    selectThread: setThreadId,
    createThread,
    deleteThread,
    refreshThreads,
    reloadState: useCallback(() => (threadId ? loadState(threadId) : Promise.resolve()), [threadId, loadState]),
    clearError: useCallback(() => setError(null), []),
  }
}
