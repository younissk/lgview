/** Thread list, current thread state, and checkpoint history for time travel. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Connection } from '../api/client'
import type { Thread, ThreadState } from '../api/types'

const THREAD_PAGE = 40
const HISTORY_LIMIT = 100

export function useThreads(connection: Connection | null, graphId: string | null) {
  const [threads, setThreads] = useState<Thread[]>([])
  /** True when the server had at least one more thread than we asked for. */
  const [hasMoreThreads, setHasMoreThreads] = useState(false)
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
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
        // Ask for one more than we show, so "is there another page" is a fact
        // rather than a guess. A full page used to just stop, and older threads
        // were silently unreachable.
        const found = await api.searchThreads(connection, { limit: THREAD_PAGE + 1, graphId: graphId ?? undefined })
        if (cancelled) return
        setHasMoreThreads(found.length > THREAD_PAGE)
        setThreads(found.slice(0, THREAD_PAGE))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'could not list threads')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connection?.url, connection?.apiKey, graphId, nonce])

  const loadMoreThreads = useCallback(async () => {
    if (!connection || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await api.searchThreads(connection, {
        limit: THREAD_PAGE + 1,
        offset: threads.length,
        graphId: graphId ?? undefined,
      })
      setHasMoreThreads(next.length > THREAD_PAGE)
      setThreads((prev) => [...prev, ...next.slice(0, THREAD_PAGE)])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load more threads')
    } finally {
      setLoadingMore(false)
    }
  }, [connection?.url, connection?.apiKey, graphId, threads.length, loadingMore])

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
          api.threadHistory(connection, id, HISTORY_LIMIT).catch(() => [] as ThreadState[]),
        ])
        if (signal?.aborted) return
        setState(current)
        setHistory(past)
        // A long run can have more checkpoints than this; say so rather than
        // letting early-step time travel look impossible.
        setHistoryTruncated(past.length >= HISTORY_LIMIT)
        setError(null)
      } catch (err) {
        if (signal?.aborted) return
        setState(null)
        setHistory([])
        setHistoryTruncated(false)
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

  /**
   * Every node that executed in this thread, oldest first.
   *
   * A checkpoint records the tasks that were pending when it was written, so
   * walking the history from the oldest entry forward reconstructs the order
   * nodes ran in -- and how many times, which is what puts the loop counts back
   * on the canvas when you reopen a thread.
   */
  const nodesThatRan = useMemo(() => {
    const ordered: string[] = []
    for (const entry of [...history].reverse()) {
      for (const task of entry.tasks ?? []) {
        if (task.name && !task.name.startsWith('__')) ordered.push(task.name)
      }
    }
    return ordered
  }, [history])

  return {
    threads,
    nodesThatRan,
    hasMoreThreads,
    loadingMore,
    loadMoreThreads,
    historyTruncated,
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
