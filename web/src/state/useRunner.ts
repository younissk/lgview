/** Drives a run: opens the stream, folds events into state, handles cancel. */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { api, ApiError, type Connection } from '../api/client'
import type { Interrupt, RunCreate } from '../api/types'
import { initialRunState, runReducer, type RunState } from './runReducer'

export interface StartOptions {
  input: Record<string, unknown> | null
  /** Overrides the hook's thread, for a thread created moments ago. */
  threadId?: string
  checkpointId?: string
  interruptBefore?: string[]
  interruptAfter?: string[]
}

export interface Runner {
  run: RunState
  isActive: boolean
  start: (options: StartOptions) => Promise<void>
  resume: (value: unknown) => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
  hydrate: (values: Record<string, unknown> | null, interrupt: Interrupt | null, next: string[]) => void
}

const STREAM_MODES: RunCreate['stream_mode'] = ['values', 'updates', 'debug', 'messages-tuple']

export function useRunner(
  connection: Connection | null,
  assistantId: string | null,
  threadId: string | null,
  onSettled?: () => void,
): Runner {
  const [run, dispatch] = useReducer(runReducer, initialRunState)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef<string | undefined>(undefined)
  runIdRef.current = run.runId
  // Creating a thread and starting a run happen in the same click, one render
  // apart, so the callbacks below read the id from a ref rather than a closure.
  const threadIdRef = useRef<string | null>(threadId)
  threadIdRef.current = threadId

  // Never leave a stream open behind a closed view.
  useEffect(() => () => abortRef.current?.abort(), [])

  const consume = useCallback(
    async (body: RunCreate, resume: boolean, overrideThreadId?: string) => {
      const target = overrideThreadId ?? threadIdRef.current
      if (!connection || !target) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      dispatch({ type: 'start', at: Date.now(), resume })

      try {
        for await (const event of api.streamRun(connection, target, body, controller.signal)) {
          if (controller.signal.aborted) break
          dispatch({ type: 'event', event, at: Date.now() })
        }
        if (!controller.signal.aborted) {
          dispatch({ type: 'finish', status: 'done', at: Date.now() })
        }
      } catch (err) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
          dispatch({ type: 'finish', status: 'cancelled', at: Date.now() })
        } else {
          const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'the run failed'
          dispatch({ type: 'finish', status: 'error', at: Date.now(), error: message })
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        onSettled?.()
      }
    },
    [connection?.url, connection?.apiKey, onSettled],
  )

  const start = useCallback(
    async (options: StartOptions) => {
      if (!assistantId) return
      const body: RunCreate = {
        assistant_id: assistantId,
        input: options.input,
        stream_mode: STREAM_MODES,
        stream_subgraphs: true,
        // Without this, closing the tab mid-run leaves the run going server-side.
        on_disconnect: 'cancel',
        if_not_exists: 'create',
      }
      if (options.checkpointId) body.checkpoint = { checkpoint_id: options.checkpointId }
      if (options.interruptBefore?.length) body.interrupt_before = options.interruptBefore
      if (options.interruptAfter?.length) body.interrupt_after = options.interruptAfter
      await consume(body, false, options.threadId)
    },
    [assistantId, consume],
  )

  const resume = useCallback(
    async (value: unknown) => {
      if (!assistantId) return
      await consume(
        {
          assistant_id: assistantId,
          command: { resume: value },
          stream_mode: STREAM_MODES,
          stream_subgraphs: true,
          on_disconnect: 'cancel',
        },
        true,
      )
    },
    [assistantId, consume],
  )

  const cancel = useCallback(async () => {
    const controller = abortRef.current
    const runId = runIdRef.current
    const target = threadIdRef.current
    controller?.abort()

    // Aborting only drops our end of the stream; the run keeps going server-side
    // until it is told to stop. If that request fails the user needs to know --
    // swallowing it made "cancelled" a claim rather than a fact.
    let error: string | undefined
    if (connection && target && runId) {
      try {
        await api.cancelRun(connection, target, runId)
      } catch (err) {
        error = `stopped watching, but the server did not confirm the cancel: ${
          err instanceof Error ? err.message : String(err)
        }`
      }
    } else if (!runId) {
      error = 'stopped watching, but no run id was known so the server was not asked to stop'
    }
    dispatch({ type: 'finish', status: 'cancelled', at: Date.now(), error })
  }, [connection?.url, connection?.apiKey])

  const hydrate = useCallback(
    (values: Record<string, unknown> | null, interrupt: Interrupt | null, next: string[]) => {
      dispatch({ type: 'hydrate', values, interrupt, next })
    },
    [],
  )

  return {
    run,
    isActive: run.status === 'starting' || run.status === 'running',
    start,
    resume,
    cancel,
    reset: useCallback(() => dispatch({ type: 'reset' }), []),
    hydrate,
  }
}
