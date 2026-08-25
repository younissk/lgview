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
  /** Payload released to bound memory; the entry itself is still a timeline mark. */
  payloadDropped?: boolean
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

/**
 * How many log entries keep their payload.
 *
 * The log held every payload by reference, and LangGraph re-sends the whole
 * graph state on each superstep, so 600 steps of a graph with a 2 MB state
 * pinned ~772 MB of heap and took the tab with it. Entries older than this
 * keep their timestamp, label and timing -- only the payload is released.
 */
export const RETAINED_PAYLOADS = 25

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
  | { type: 'events'; events: Array<{ event: StreamEvent; at: number }> }
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
        // Resuming continues the same thread, so everything already on screen
        // stays until the server sends fresher information. Dropping statuses
        // here used to blank the canvas the moment you answered an interrupt.
        values: action.resume ? state.values : null,
        log: action.resume ? state.log.slice(-MAX_LOG_ENTRIES) : [],
        runCounts: action.resume ? state.runCounts : {},
        statuses: action.resume ? state.statuses : {},
        durations: action.resume ? state.durations : {},
        nodeStartedAt: action.resume ? state.nodeStartedAt : {},
      }

    case 'finish': {
      // The stream ending is not evidence that the run succeeded. If the server
      // already told us the run was interrupted or failed, that verdict stands
      // -- reporting "done" over the top of an `event: error` is how a crashed
      // run came to render green.
      const settled = TERMINAL_STATUSES.has(state.status) && action.status === 'done' ? state.status : action.status
      return {
        ...state,
        status: settled,
        error: action.error ?? state.error,
        finishedAt: action.at,
        statuses: clearTransientStatuses(state.statuses, settled),
      }
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

    case 'events':
      // One commit per animation frame instead of one per frame off the wire.
      // At 30 tokens/second the per-event path spent ~70% of the main thread in
      // React, which is what made the Cancel button feel dead.
      return action.events.reduce((acc, { event, at }) => applyEvent(acc, event, at), state)
  }
}

const TERMINAL_STATUSES = new Set<RunStatus>(['interrupted', 'error'])

/**
 * A run that ends leaves no node mid-flight -- but only a *successful* finish
 * means the node completed. Cancelling or failing mid-node must not paint it
 * green; the node stopped, it did not finish.
 */
function clearTransientStatuses(
  statuses: Record<string, NodeStatus>,
  outcome: RunStatus,
): Record<string, NodeStatus> {
  const next: Record<string, NodeStatus> = {}
  for (const [node, status] of Object.entries(statuses)) {
    if (status !== 'running' && status !== 'queued') {
      next[node] = status
      continue
    }
    if (outcome === 'done') next[node] = 'done'
    else if (outcome === 'error' && status === 'running') next[node] = 'error'
    else next[node] = 'stopped'
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
      // A real langgraph-api crash arrives as a top-level `error` frame with no
      // `task_result` at all, so the node never leaves `running` on its own.
      const message = describeError(event.data)
      const statuses = { ...state.statuses }
      for (const [node, status] of Object.entries(statuses)) {
        if (status === 'running') statuses[node] = 'error'
      }
      return log({ ...state, statuses, status: 'error', error: message }, at, {
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
    // Note this does NOT clear `interrupt`: a resume emits the resumed node's
    // update before anything else, and clearing here dropped the Resume card
    // with no way to get it back in-session.
    const statuses = next.statuses[key] === 'running' ? next.statuses : { ...next.statuses, [key]: 'done' as NodeStatus }
    next = log({ ...next, statuses }, at, {
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
  // A `values` frame carries the entire graph state. The State tab already
  // renders the current one in full and the History tab has the past ones, so
  // keeping a second copy per superstep buys nothing and costs everything.
  const item: LogEntry =
    entry.kind === 'values'
      ? { ...entry, payload: undefined, payloadDropped: true, id: state.nextId, at }
      : { ...entry, id: state.nextId, at }

  const nextLog = state.log.length >= MAX_LOG_ENTRIES ? [...state.log.slice(1), item] : [...state.log, item]

  // Release exactly one payload per append: O(1), and it keeps the number of
  // retained payloads at a constant regardless of how long the run goes on.
  const cutoff = nextLog.length - RETAINED_PAYLOADS - 1
  if (cutoff >= 0 && nextLog[cutoff].payload !== undefined) {
    nextLog[cutoff] = { ...nextLog[cutoff], payload: undefined, payloadDropped: true }
  }

  return { ...state, log: nextLog, nextId: state.nextId + 1 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
