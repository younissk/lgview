/** Right-hand panel: current state, the event log, checkpoints, and schemas. */
import { useMemo, useState } from 'react'
import type { AssistantSchemas, ThreadState } from '../api/types'
import type { LogEntry, RunState } from '../state/runReducer'
import { formatClock, formatDuration, formatRelative, shortId, summarize } from '../lib/format'
import { describeSchema } from '../lib/schema'
import { JsonView } from './JsonView'

type Tab = 'state' | 'events' | 'history' | 'schema'

export interface InspectorProps {
  run: RunState
  threadState: ThreadState | null
  history: ThreadState[]
  schemas: AssistantSchemas | null
  selectedNode: string | null
  activeCheckpointId: string | null
  onForkFrom: (checkpointId: string) => void
}

export function Inspector({
  run,
  threadState,
  history,
  schemas,
  selectedNode,
  activeCheckpointId,
  onForkFrom,
}: InspectorProps) {
  const [tab, setTab] = useState<Tab>('state')

  // A live run is the freshest truth; fall back to the persisted thread.
  const values = run.values ?? threadState?.values ?? null

  return (
    <aside className="panel inspector">
      <nav className="tabs" role="tablist">
        {(['state', 'events', 'history', 'schema'] as const).map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            className={tab === name ? 'tab is-active' : 'tab'}
            onClick={() => setTab(name)}
          >
            {name}
            {name === 'events' && run.log.length > 0 && <span className="tab-count">{run.log.length}</span>}
            {name === 'history' && history.length > 0 && <span className="tab-count">{history.length}</span>}
          </button>
        ))}
      </nav>

      <div className="panel-body">
        {tab === 'state' && (
          <StateTab values={values} threadState={threadState} run={run} selectedNode={selectedNode} />
        )}
        {tab === 'events' && <EventsTab log={run.log} />}
        {tab === 'history' && (
          <HistoryTab history={history} activeCheckpointId={activeCheckpointId} onForkFrom={onForkFrom} />
        )}
        {tab === 'schema' && <SchemaTab schemas={schemas} />}
      </div>
    </aside>
  )
}

function StateTab({
  values,
  threadState,
  run,
  selectedNode,
}: {
  values: Record<string, unknown> | null
  threadState: ThreadState | null
  run: RunState
  selectedNode: string | null
}) {
  const nodeUpdate = useMemo(() => {
    if (!selectedNode) return undefined
    // The most recent thing this node produced, newest first.
    return [...run.log].reverse().find((entry) => entry.node === selectedNode && entry.kind === 'update')
  }, [run.log, selectedNode])

  const next = threadState?.next ?? []

  return (
    <div className="stack">
      {selectedNode && (
        <section className="card">
          <h3>
            <span className="mono">{selectedNode}</span>
            {run.durations[selectedNode] !== undefined && (
              <span className="muted"> · {formatDuration(run.durations[selectedNode])}</span>
            )}
            {run.runCounts[selectedNode] > 1 && <span className="muted"> · ran {run.runCounts[selectedNode]}×</span>}
          </h3>
          {nodeUpdate ? (
            <JsonView value={nodeUpdate.payload} defaultDepth={3} />
          ) : (
            <p className="muted">This node has not produced an update in this session.</p>
          )}
        </section>
      )}

      <section className="card">
        <h3>
          State
          {threadState?.checkpoint_id && <span className="muted mono"> · {shortId(threadState.checkpoint_id, 10)}</span>}
        </h3>
        {values ? <JsonView value={values} defaultDepth={2} /> : <p className="muted">No state yet. Run the graph.</p>}
      </section>

      {next.length > 0 && (
        <section className="card">
          <h3>Next</h3>
          <p className="chips">
            {next.map((name) => (
              <span key={name} className="chip">
                {name}
              </span>
            ))}
          </p>
        </section>
      )}
    </div>
  )
}

function EventsTab({ log }: { log: LogEntry[] }) {
  if (log.length === 0) {
    return <p className="muted pad">Nothing yet. Events appear here as the graph runs.</p>
  }
  return (
    <ol className="event-log">
      {[...log].reverse().map((entry) => (
        <EventRow key={entry.id} entry={entry} />
      ))}
    </ol>
  )
}

function EventRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false)
  const expandable = entry.payload !== undefined && entry.payload !== null
  return (
    <li className={`event event-${entry.kind}${entry.isError ? ' is-error' : ''}`}>
      <button type="button" className="event-head" onClick={() => expandable && setOpen((prev) => !prev)}>
        <span className="event-time mono">{formatClock(entry.at)}</span>
        <span className="event-kind">{KIND_GLYPH[entry.kind]}</span>
        <span className="event-label">{entry.label}</span>
        {entry.durationMs !== undefined && <span className="event-duration">{formatDuration(entry.durationMs)}</span>}
        {expandable && !open && <span className="event-preview">{summarize(entry.payload, 40)}</span>}
      </button>
      {open && expandable && (
        <div className="event-body">
          <JsonView value={entry.payload} defaultDepth={3} />
        </div>
      )}
    </li>
  )
}

const KIND_GLYPH: Record<LogEntry['kind'], string> = {
  meta: '•',
  'node-start': '▸',
  'node-end': '✓',
  update: '↑',
  values: '≡',
  interrupt: '⏸',
  token: '"',
  error: '✕',
  other: '·',
}

function HistoryTab({
  history,
  activeCheckpointId,
  onForkFrom,
}: {
  history: ThreadState[]
  activeCheckpointId: string | null
  onForkFrom: (checkpointId: string) => void
}) {
  if (history.length === 0) {
    return <p className="muted pad">No checkpoints yet. Every step of a run leaves one here.</p>
  }
  return (
    <ol className="checkpoints">
      {history.map((entry) => {
        const id = entry.checkpoint_id ?? entry.checkpoint?.checkpoint_id ?? ''
        const step = (entry.metadata as { step?: number } | undefined)?.step
        const isActive = id === activeCheckpointId
        return (
          <li key={id} className={isActive ? 'checkpoint is-active' : 'checkpoint'}>
            <div className="checkpoint-head">
              <span className="mono">{shortId(id, 10)}</span>
              {step !== undefined && <span className="checkpoint-step">step {step}</span>}
              <span className="muted">{formatRelative(entry.created_at)}</span>
            </div>
            <div className="checkpoint-next">
              {entry.next.length > 0 ? (
                entry.next.map((name) => (
                  <span key={name} className="chip chip-sm">
                    {name}
                  </span>
                ))
              ) : (
                <span className="muted">finished</span>
              )}
              {entry.interrupts.length > 0 && <span className="chip chip-sm chip-warn">interrupt</span>}
            </div>
            <div className="checkpoint-actions">
              <button type="button" className="link-btn" onClick={() => onForkFrom(id)} disabled={!id}>
                resume from here
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function SchemaTab({ schemas }: { schemas: AssistantSchemas | null }) {
  if (!schemas) return <p className="muted pad">Schemas are not available for this graph.</p>
  const entries = [
    ['state', schemas.state_schema],
    ['input', schemas.input_schema],
    ['output', schemas.output_schema],
    ['config', schemas.config_schema],
    ['context', schemas.context_schema],
  ] as const

  return (
    <div className="stack">
      {entries.map(([name, schema]) => (
        <section className="card" key={name}>
          <h3>
            {name} <span className="muted">· {describeSchema(schema)}</span>
          </h3>
          {schema ? <JsonView value={schema} defaultDepth={1} /> : <p className="muted">not published</p>}
        </section>
      ))}
    </div>
  )
}
