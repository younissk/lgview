/**
 * Types for the LangGraph server API, hand-written from the OpenAPI document
 * served at `<server>/openapi.json` (verified against langgraph-api 0.13.0).
 * Only the fields lgview actually reads are modelled; everything else stays
 * on `unknown` so a server upgrade cannot break the build.
 */

export interface Assistant {
  assistant_id: string
  graph_id: string
  name: string | null
  description: string | null
  created_at: string
  updated_at: string
  version: number
  config: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface GraphNodeJson {
  id: string
  type?: string
  /** Absent for `__end__`; carries the display name for everything else. */
  data?: { name?: string; id?: string[] } | string | null
  metadata?: Record<string, unknown> | null
}

export interface GraphEdgeJson {
  source: string
  target: string
  /** Branch label, when the graph author supplied one. Frequently absent. */
  data?: string | null
  /** True for edges produced by `add_conditional_edges`. */
  conditional?: boolean
}

export interface GraphJson {
  nodes: GraphNodeJson[]
  edges: GraphEdgeJson[]
}

/** A JSON Schema fragment, as emitted by `/assistants/{uuid}/schemas`. */
export interface JsonSchema {
  type?: string
  title?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  default?: unknown
  description?: string
  enum?: unknown[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  [key: string]: unknown
}

export interface AssistantSchemas {
  graph_id: string
  input_schema?: JsonSchema | null
  output_schema?: JsonSchema | null
  state_schema?: JsonSchema | null
  config_schema?: JsonSchema | null
  context_schema?: JsonSchema | null
}

export interface CheckpointRef {
  checkpoint_id: string
  thread_id: string
  checkpoint_ns: string
}

export interface Interrupt {
  id?: string
  value: unknown
  when?: string
  resumable?: boolean
  ns?: string[] | null
}

export interface ThreadTask {
  id: string
  name: string
  path?: unknown[]
  error: unknown
  interrupts: Interrupt[]
  checkpoint: CheckpointRef | null
  state: ThreadState | null
  result?: unknown
}

export interface ThreadState {
  values: Record<string, unknown>
  next: string[]
  tasks: ThreadTask[]
  metadata?: Record<string, unknown>
  created_at: string | null
  checkpoint: CheckpointRef
  parent_checkpoint: CheckpointRef | null
  interrupts: Interrupt[]
  checkpoint_id?: string
  parent_checkpoint_id?: string | null
}

export type ThreadStatus = 'idle' | 'busy' | 'interrupted' | 'error'

export interface Thread {
  thread_id: string
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
  status: ThreadStatus
  values?: Record<string, unknown> | null
  interrupts?: Record<string, Interrupt[]>
}

export interface ServerInfo {
  version?: string
  langgraph_py_version?: string
  flags?: Record<string, unknown>
  host?: Record<string, unknown>
}

export type StreamMode = 'values' | 'updates' | 'debug' | 'messages-tuple' | 'custom' | 'events' | 'checkpoints' | 'tasks'

export interface RunCreate {
  assistant_id: string
  input?: Record<string, unknown> | null
  command?: { resume?: unknown; update?: Record<string, unknown>; goto?: unknown } | null
  checkpoint?: { checkpoint_id: string; checkpoint_ns?: string } | null
  stream_mode?: StreamMode[]
  stream_subgraphs?: boolean
  interrupt_before?: string[] | '*'
  interrupt_after?: string[] | '*'
  config?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  on_disconnect?: 'cancel' | 'continue'
  if_not_exists?: 'create' | 'reject'
}

/** One decoded server-sent event from a run stream. */
export interface StreamEvent {
  event: string
  data: unknown
}

/** `debug` stream payloads, which is how lgview tracks per-node execution. */
export interface DebugTaskPayload {
  id: string
  name: string
  input?: unknown
  triggers?: string[]
  error?: unknown
  result?: unknown
  interrupts?: Interrupt[]
}

export interface DebugCheckpointPayload {
  values?: Record<string, unknown>
  next?: string[]
  tasks?: Array<{ id: string; name: string; interrupts?: Interrupt[] }>
  checkpoint?: CheckpointRef
  metadata?: Record<string, unknown>
}

export interface DebugEvent {
  type: 'task' | 'task_result' | 'checkpoint'
  step: number
  timestamp: string
  payload: DebugTaskPayload & DebugCheckpointPayload
}
