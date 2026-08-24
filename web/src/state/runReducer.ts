/**
 * Reduces a LangGraph run's SSE events into everything the UI draws: per-node
 * execution status, the running state values, any interrupt, and a log.
 *
 * Kept pure and separate from React so the event handling -- the part most
 * likely to be wrong -- can be tested directly against recorded streams.
 */
import type { DebugEvent, Interrupt, StreamEvent } from '../api/types'
import type { NodeStatus } from '../lib/layout'

export type RunStatus = 'idle' | 'starting' | 'running' | 'interrupted' | 'done' | 'error' | 'cancelled'

export type LogKind =
  | 'meta'
  | 'node-start'
  | 'node-end'
  | 'update'
  | 'values'
  | 'interrupt'
  | 'token'
  | 'error'
  | 'other'

export interface LogEntry {
  id: number
  at: number
  kind: LogKind
  label: string
  node?: string
  payload?: unknown
  durationMs?: number
  isError?: boolean
}

export interface RunState {
  status: RunStatus
  runId?: string
  /** Newest last. Capped, because a long run can emit thousands of events. */
  log: LogEntry[]
  statuses: Record<string, NodeStatus>
  runCounts: Record<string, number>
  durations: Record<string, number>
  values: Record<string, unknown> | null
  interrupt: Interrupt | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
  /** Node name -> wall-clock start, used to compute durations. */
  nodeStartedAt: Record<string, number>
  nextId: number
}

export const MAX_LOG_ENTRIES = 500

export const initialRunState: RunState = {
  status: 'idle',
  log: [],
  statuses: {},
  runCounts: {},
  durations: {},
  values: null,
  interrupt: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  nodeStartedAt: {},
  nextId: 1,
}

export type RunAction =
  | { type: 'start'; at: number; resume: boolean }
  | { type: 'event'; event: StreamEvent; at: number }
  | { type: 'finish'; status: RunStatus; at: number; error?: string }
  | { type: 'hydrate'; values: Record<string, unknown> | null; interrupt: Interrupt | null; next: string[] }
  | { type: 'reset' }

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'reset':
      return { ...initialRunState }

    case 'start':
      return {
        ...initialRunState,
        nextId: state.nextId,
        status: 'starting',
        startedAt: action.at,
        // Resuming continues the same thread, so the values already on screen
        // stay until the server sends fresher ones.
        values: action.resume ? state.values : null,
        log: action.resume ? state.log.slice(-MAX_LOG_ENTRIES) : [],
        runCounts: action.resume ? state.runCounts : {},
      }

    case 'finish':
      return {
        ...state,
        // A stream that ends at an interrupt has not finished -- the graph is
        // parked waiting for a human, and saying "done" would be a lie.
        status: state.status === 'interrupted' && action.status === 'done' ? 'interrupted' : action.status,
        error: action.error ?? state.error,
        finishedAt: action.at,
        statuses: clearTransientStatuses(state.statuses),
      }

    case 'hydrate':
      return {
        ...state,
        values: action.values,
        interrupt: action.interrupt,
        statuses: action.next.reduce<Record<string, NodeStatus>>(
          (acc, name) => ({ ...acc, [name]: action.interrupt ? 'interrupted' : 'queued' }),
          {},
        ),
        status: action.interrupt ? 'interrupted' : state.status === 'running' ? 'idle' : state.status,
      }

    case 'event':
      return applyEvent(state, action.event, action.at)
  }
}

/** A run that ends leaves no node mid-flight. Parked and failed nodes stay. */
function clearTransientStatuses(statuses: Record<string, NodeStatus>): Record<string, NodeStatus> {
  const next: Record<string, NodeStatus> = {}
  for (const [node, status] of Object.entries(statuses)) {
    next[node] = status === 'running' || status === 'queued' ? 'done' : status
  }
  return next
}

function applyEvent(state: RunState, event: StreamEvent, at: number): RunState {
  // Subgraph streams arrive as `updates|<namespace>`; treat them as their base
  // mode so a graph with subgraphs still lights up.
  const [mode] = event.event.split('|')

  switch (mode) {
    case 'metadata': {
      const runId = (event.data as { run_id?: string } | null)?.run_id
      return log({ ...state, runId, status: 'running' }, at, {
        kind: 'meta',
        label: runId ? `run ${runId.slice(0, 8)} started` : 'run started',
        payload: event.data,
      })
    }

    case 'debug':
      return applyDebug(state, event.data as DebugEvent, at)

    case 'values': {
      const values = isRecord(event.data) ? event.data : state.values
      return log({ ...state, values, status: state.status === 'starting' ? 'running' : state.status }, at, {
        kind: 'values',
        label: 'state updated',
        payload: event.data,
      })
    }

    case 'updates':
      return applyUpdates(state, event.data, at)

    case 'messages':
    case 'messages-tuple': {
      const label = describeToken(event.data)
      return label ? log(state, at, { kind: 'token', label, payload: event.data }) : state
    }

    case 'error': {
      const message = describeError(event.data)
      return log({ ...state, status: 'error', error: message }, at, {
        kind: 'error',
        label: message,
        payload: event.data,
        isError: true,
      })
    }

    case 'end':
      return { ...state, status: state.status === 'interrupted' ? 'interrupted' : 'done', finishedAt: at }

    default:
      return log(state, at, { kind: 'other', label: event.event, payload: event.data })
  }
}

function applyDebug(state: RunState, debug: DebugEvent | null, at: number): RunState {
  if (!debug || typeof debug !== 'object') return state

  if (debug.type === 'task') {
    const node = debug.payload?.name
    if (!node) return state
    return log(
      {
        ...state,
        status: 'running',
        statuses: { ...state.statuses, [node]: 'running' },
        nodeStartedAt: { ...state.nodeStartedAt, [node]: at },
        runCounts: { ...state.runCounts, [node]: (state.runCounts[node] ?? 0) + 1 },
      },
      at,
      { kind: 'node-start', label: node, node, payload: debug.payload?.input },
    )
  }

  if (debug.type === 'task_result') {
    const node = debug.payload?.name
    if (!node) return state
    const failed = Boolean(debug.payload?.error)
    // A task that returns interrupts did not complete; it is parked.
    const parked = (debug.payload?.interrupts?.length ?? 0) > 0
    const startedAt = state.nodeStartedAt[node]
    const durationMs = startedAt ? at - startedAt : undefined
    return log(
      {
        ...state,
        statuses: { ...state.statuses, [node]: failed ? 'error' : parked ? 'interrupted' : 'done' },
        durations: durationMs ? { ...state.durations, [node]: durationMs } : state.durations,
      },
      at,
      {
        kind: 'node-end',
        label: node,
        node,
        durationMs,
        isError: failed,
        payload: failed ? debug.payload?.error : debug.payload?.result,
      },
    )
  }

  if (debug.type === 'checkpoint') {
    const next = debug.payload?.next ?? []
    const statuses = { ...state.statuses }
    for (const node of next) {
      // Do not downgrade a node that is already executing.
      if (statuses[node] !== 'running') statuses[node] = 'queued'
    }
    return { ...state, statuses }
  }

  return state
}

function applyUpdates(state: RunState, data: unknown, at: number): RunState {
  if (!isRecord(data)) return state
  let next = state

  for (const [key, payload] of Object.entries(data)) {
    if (key === '__interrupt__') {
      const interrupt = firstInterrupt(payload)
      const statuses = { ...next.statuses }
      for (const [node, status] of Object.entries(statuses)) {
        if (status === 'running') statuses[node] = 'interrupted'
      }
      next = log({ ...next, statuses, interrupt, status: 'interrupted' }, at, {
        kind: 'interrupt',
        label: 'waiting for input',
        payload: interrupt?.value ?? payload,
      })
      continue
    }
    // `updates` alone is enough to drive node status when `debug` is off.
    const statuses = next.statuses[key] === 'running' ? next.statuses : { ...next.statuses, [key]: 'done' as NodeStatus }
    next = log({ ...next, statuses, interrupt: null }, at, {
      kind: 'update',
      label: key,
      node: key,
      payload,
    })
  }
  return next
}

function firstInterrupt(payload: unknown): Interrupt | null {
  if (Array.isArray(payload) && payload.length > 0) return payload[0] as Interrupt
  if (isRecord(payload)) return payload as unknown as Interrupt
  return null
}

function describeToken(data: unknown): string | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const chunk = data[0] as { content?: unknown } | null
  const content = chunk?.content
  if (typeof content === 'string' && content.length > 0) return content
  return null
}

function describeError(data: unknown): string {
  if (typeof data === 'string') return data
  if (isRecord(data)) {
    const message = data.message ?? data.error ?? data.detail
    if (typeof message === 'string') return message
    return JSON.stringify(data)
  }
  return 'run failed'
}

function log(state: RunState, at: number, entry: Omit<LogEntry, 'id' | 'at'>): RunState {
  const item: LogEntry = { ...entry, id: state.nextId, at }
  const nextLog = state.log.length >= MAX_LOG_ENTRIES ? [...state.log.slice(1), item] : [...state.log, item]
  return { ...state, log: nextLog, nextId: state.nextId + 1 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
