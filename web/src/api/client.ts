/**
 * Thin client for the LangGraph server API.
 *
 * Every call is routed through lgview's own origin at `/__lg`, with the target
 * server named in a header. See cli/proxy.ts for why.
 */
import { readSse } from './sse'
import type {
  Assistant,
  AssistantSchemas,
  GraphJson,
  RunCreate,
  ServerInfo,
  StreamEvent,
  Thread,
  ThreadState,
} from './types'

export const PROXY_PREFIX = '/__lg'
const UPSTREAM_HEADER = 'x-lgview-upstream'
const API_KEY_HEADER = 'x-lgview-api-key'

export interface Connection {
  url: string
  apiKey?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly body?: unknown
  /** Whether lgview's proxy failed, or the LangGraph server rejected us. */
  readonly source: 'proxy' | 'upstream'
  constructor(status: number, message: string, body?: unknown, source: 'proxy' | 'upstream' = 'upstream') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.source = source
  }

  /** True when the server answered but refused us -- bad key, no permission. */
  get isAuthFailure(): boolean {
    return this.source === 'upstream' && (this.status === 401 || this.status === 403)
  }

  /** True when we never got a usable answer from the LangGraph server at all. */
  get isUnreachable(): boolean {
    return this.source === 'proxy' && this.status >= 500
  }
}

function headers(conn: Connection, extra?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { [UPSTREAM_HEADER]: conn.url, ...extra }
  if (conn.apiKey) result[API_KEY_HEADER] = conn.apiKey
  return result
}

async function request<T>(conn: Connection, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${PROXY_PREFIX}${path}`, {
    ...init,
    headers: headers(conn, {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    }),
  })
  if (!response.ok) throw await toApiError(response)
  // Not every success carries JSON. Cancel answers 202 with an empty body, and
  // calling .json() on it threw on every *successful* cancel -- which the
  // caller's catch then swallowed, so a 202, a 404 and a request that was never
  // sent all looked identical.
  return (await readBody(response)) as T
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined
  const text = await response.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let body: unknown = text
  let message = text
  let fromProxy = false
  try {
    body = JSON.parse(text)
    const record = body as { error?: unknown; detail?: unknown; message?: unknown }
    // Two envelopes reach here: ours from cli/proxy.ts, and whatever the
    // LangGraph server sent. Collapsing them made a rejected API key render as
    // "cannot reach the server -- start one with langgraph dev".
    fromProxy = record?.error === 'lgview_proxy_error'
    const detail = record?.detail ?? record?.message
    if (typeof detail === 'string') message = detail
    else if (detail) message = JSON.stringify(detail)
  } catch {
    // Leave the raw text as the message.
  }
  return new ApiError(
    response.status,
    message || `${response.status} ${response.statusText}`,
    body,
    fromProxy ? 'proxy' : 'upstream',
  )
}

const json = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) })

export const api = {
  async health(conn: Connection): Promise<boolean> {
    const res = await fetch(`${PROXY_PREFIX}/ok`, { headers: headers(conn) })
    return res.ok
  },

  info(conn: Connection): Promise<ServerInfo> {
    return request<ServerInfo>(conn, '/info')
  },

  searchAssistants(conn: Connection, limit = 100): Promise<Assistant[]> {
    return request<Assistant[]>(conn, '/assistants/search', json({ limit, offset: 0 }))
  },

  /**
   * Graph topology. This endpoint accepts a graph name as well as a UUID,
   * unlike `/schemas`, which insists on the assistant UUID.
   */
  graph(conn: Connection, assistantId: string, xray = false): Promise<GraphJson> {
    const query = xray ? '?xray=1' : ''
    return request<GraphJson>(conn, `/assistants/${encodeURIComponent(assistantId)}/graph${query}`)
  },

  /** Requires the assistant UUID; passing a graph name returns 400. */
  schemas(conn: Connection, assistantUuid: string): Promise<AssistantSchemas> {
    return request<AssistantSchemas>(conn, `/assistants/${encodeURIComponent(assistantUuid)}/schemas`)
  },

  createThread(conn: Connection, metadata?: Record<string, unknown>): Promise<Thread> {
    return request<Thread>(conn, '/threads', json({ metadata: metadata ?? {} }))
  },

  searchThreads(conn: Connection, options: { limit?: number; offset?: number; graphId?: string } = {}): Promise<Thread[]> {
    const body: Record<string, unknown> = {
      limit: options.limit ?? 30,
      offset: options.offset ?? 0,
      sort_by: 'updated_at',
      sort_order: 'desc',
    }
    if (options.graphId) body.metadata = { graph_id: options.graphId }
    return request<Thread[]>(conn, '/threads/search', json(body))
  },

  deleteThread(conn: Connection, threadId: string): Promise<void> {
    return request<void>(conn, `/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
  },

  threadState(conn: Connection, threadId: string): Promise<ThreadState> {
    return request<ThreadState>(conn, `/threads/${encodeURIComponent(threadId)}/state`)
  },

  threadStateAt(conn: Connection, threadId: string, checkpointId: string): Promise<ThreadState> {
    return request<ThreadState>(
      conn,
      `/threads/${encodeURIComponent(threadId)}/state/${encodeURIComponent(checkpointId)}`,
    )
  },

  threadHistory(conn: Connection, threadId: string, limit = 50): Promise<ThreadState[]> {
    return request<ThreadState[]>(conn, `/threads/${encodeURIComponent(threadId)}/history`, json({ limit }))
  },

  /** Ask the server to stop a run. Answers 202 with an empty body on success. */
  cancelRun(conn: Connection, threadId: string, runId: string): Promise<void> {
    return request<void>(
      conn,
      `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel?wait=false&action=interrupt`,
      { method: 'POST' },
    )
  },

  /** Start a run and yield decoded SSE events as they arrive. */
  async *streamRun(
    conn: Connection,
    threadId: string,
    body: RunCreate,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const response = await fetch(`${PROXY_PREFIX}/threads/${encodeURIComponent(threadId)}/runs/stream`, {
      method: 'POST',
      headers: headers(conn, { 'content-type': 'application/json', accept: 'text/event-stream' }),
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await toApiError(response)
    if (!response.body) throw new ApiError(500, 'the run stream returned no body')
    yield* readSse(response.body, signal)
  },
}
