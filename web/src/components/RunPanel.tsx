/** Compose an input, start a run, resume an interrupt, cancel. */
import { useEffect, useMemo, useState } from 'react'
import type { AssistantSchemas, Interrupt } from '../api/types'
import type { RunState } from '../state/runReducer'
import { schemaFieldHints, sampleFromSchema } from '../lib/schema'
import { formatDuration } from '../lib/format'

export interface RunPanelProps {
  schemas: AssistantSchemas | null
  run: RunState
  isActive: boolean
  hasThread: boolean
  /** The graph is waiting on an interrupt; starting a run would restart it. */
  parked: boolean
  disabled: boolean
  onRun: (input: Record<string, unknown> | null) => void
  onResume: (value: unknown) => void
  onCancel: () => void
  onNewThread: () => void
}

export function RunPanel({
  schemas,
  run,
  isActive,
  hasThread,
  parked,
  disabled,
  onRun,
  onResume,
  onCancel,
  onNewThread,
}: RunPanelProps) {
  const [text, setText] = useState('{}')
  const [touched, setTouched] = useState(false)

  // Start empty rather than pre-filled. LangGraph marks every field of a
  // TypedDict state as required, so a "required fields" seed would be the
  // entire state -- handing the graph a wall of empty strings that overwrite
  // whatever the nodes would have defaulted to. The field hints and the
  // template button cover discoverability instead.
  useEffect(() => {
    if (touched) return
    setText('{}')
  }, [schemas?.graph_id, touched])

  const hints = useMemo(() => schemaFieldHints(schemas?.input_schema), [schemas?.input_schema])

  const parsed = useMemo(() => parseInput(text), [text])
  // Running while parked would start the graph again from START rather than
  // resuming it -- which silently discarded the interrupt and re-ran every node.
  const canRun = !disabled && !isActive && !parked && parsed.ok

  return (
    <section className="panel run-panel">
      <header className="panel-head">
        <h2>Run</h2>
        <div className="panel-head-actions">
          <button type="button" className="btn-ghost" onClick={onNewThread} disabled={disabled}>
            New thread
          </button>
        </div>
      </header>

      {/* The template button sits beside the label, not inside it: nesting a
          button in a <label> folds its text into the field's accessible name,
          so the textarea announced as "Input template". */}
      <div className="field-label">
        <label htmlFor="run-input">Input</label>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setTouched(true)
            setText(JSON.stringify(sampleFromSchema(schemas?.input_schema) ?? {}, null, 2))
          }}
          disabled={!schemas?.input_schema}
          title="Fill in every field from the graph's input schema"
        >
          template
        </button>
      </div>
      <textarea
        id="run-input"
        className={`code-input${parsed.ok ? '' : ' is-invalid'}`}
        spellCheck={false}
        rows={8}
        value={text}
        onChange={(event) => {
          setTouched(true)
          setText(event.target.value)
        }}
      />
      {!parsed.ok && <p className="field-error">{parsed.error}</p>}
      {parsed.ok && hints.length > 0 && (
        <p className="field-hint">
          {hints.map((hint) => (
            <button
              key={hint.name}
              type="button"
              className="hint-chip"
              title={`Insert "${hint.name}"`}
              onClick={() => {
                setTouched(true)
                setText((current) => insertField(current, hint.name, hint.sample))
              }}
            >
              {hint.name}
              <span className="muted">{hint.type}</span>
            </button>
          ))}
        </p>
      )}

      <div className="run-actions">
        {isActive ? (
          <button type="button" className="btn-danger" onClick={onCancel}>
            Cancel run
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onRun(parsed.ok ? parsed.value : null)}
            disabled={!canRun}
            title={parked ? 'This thread is waiting on an interrupt — answer it below to continue' : undefined}
          >
            {hasThread ? 'Run' : 'Run in a new thread'}
          </button>
        )}
        <RunStatusLine run={run} />
      </div>

      {parked && (
        <p className="field-hint-note">
          Waiting on an interrupt. Answer it below to continue this thread — starting a run would begin the
          graph again from the start.
        </p>
      )}
      {run.interrupt && !isActive && <InterruptCard interrupt={run.interrupt} onResume={onResume} />}
      {run.error && <p className="field-error run-error">{run.error}</p>}
    </section>
  )
}

function RunStatusLine({ run }: { run: RunState }) {
  const elapsed =
    run.startedAt !== null ? formatDuration((run.finishedAt ?? Date.now()) - run.startedAt) : ''
  return (
    <span className={`run-status run-status-${run.status}`}>
      <span className="dot" />
      {run.status}
      {elapsed && <span className="muted"> · {elapsed}</span>}
    </span>
  )
}

/**
 * An interrupt is the graph asking a question. Render whatever the node passed
 * to `interrupt()`; if it looks like a list of options, offer them as buttons.
 */
function InterruptCard({ interrupt, onResume }: { interrupt: Interrupt; onResume: (value: unknown) => void }) {
  const [reply, setReply] = useState('')
  const value = interrupt.value
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const question = typeof record?.question === 'string' ? record.question : null
  const options = Array.isArray(record?.options) ? (record.options as unknown[]) : null

  return (
    <div className="interrupt-card">
      <div className="interrupt-head">
        <span className="interrupt-badge">interrupt</span>
        <span>waiting for input</span>
      </div>
      {question ? <p className="interrupt-question">{question}</p> : <pre className="interrupt-raw">{stringify(value)}</pre>}

      {options && (
        <div className="interrupt-options">
          {options.map((option, index) => (
            <button key={index} type="button" className="btn-secondary" onClick={() => onResume(option)}>
              {String(option)}
            </button>
          ))}
        </div>
      )}

      <form
        className="interrupt-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!reply.trim()) return
          onResume(coerce(reply))
          setReply('')
        }}
      >
        <input
          type="text"
          value={reply}
          placeholder="or type a resume value"
          onChange={(event) => setReply(event.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={!reply.trim()}>
          Resume
        </button>
      </form>
    </div>
  )
}

/** Add one field to the JSON in the box, keeping whatever is already there. */
export function insertField(current: string, name: string, sample: unknown): string {
  const parsed = parseInput(current)
  const base = parsed.ok && parsed.value ? parsed.value : {}
  if (name in base) {
    const { [name]: _removed, ...rest } = base
    return JSON.stringify(rest, null, 2)
  }
  return JSON.stringify({ ...base, [name]: sample }, null, 2)
}

type ParseResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string }

export function parseInput(text: string): ParseResult {
  const trimmed = text.trim()
  // An empty box means "no input", which is how you resume a thread that
  // already holds state.
  if (trimmed === '') return { ok: true, value: null }
  try {
    const value = JSON.parse(trimmed)
    if (value === null) return { ok: true, value: null }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'input must be a JSON object' }
    }
    return { ok: true, value: value as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' }
  }
}

/** Let a typed reply be a number or boolean when it obviously is one. */
function coerce(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
