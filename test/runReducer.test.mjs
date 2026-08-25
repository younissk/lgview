import { test } from 'vitest'
import assert from 'node:assert/strict'
import { initialRunState, runReducer, MAX_LOG_ENTRIES, RETAINED_PAYLOADS } from '../web/src/state/runReducer.ts'

/**
 * Payloads are captured from a live langgraph-api 0.13.0 stream, not invented.
 *
 * This matters more than it sounds. An earlier version of this file made up a
 * `task_result` carrying `error: 'boom'` to test the failure path. The server
 * never emits that shape -- a real node crash arrives as a top-level
 * `event: error` frame with no `task` and no `task_result` at all -- so the
 * branch under test was unreachable in production and a crashed run rendered
 * as a success with the failed node coloured green. Capture, do not imagine:
 *
 *   TID=$(curl -s -X POST localhost:2024/threads -H 'content-type: application/json' -d '{}' \
 *     | python3 -c "import sys,json;print(json.load(sys.stdin)['thread_id'])")
 *   curl -N -X POST "localhost:2024/threads/$TID/runs/stream" -H 'content-type: application/json' \
 *     -d '{"assistant_id":"writer","input":{"notes":"oops"},"stream_mode":["values","updates","debug"]}'
 */
const feed = (events, state = initialRunState) =>
  events.reduce((acc, event, index) => runReducer(acc, { type: 'event', event, at: 1000 + index * 100 }), state)

const started = () => runReducer(initialRunState, { type: 'start', at: 0, resume: false })

test('metadata marks the run as running and records the id', () => {
  const state = feed([{ event: 'metadata', data: { run_id: 'run-123', attempt: 1 } }], started())
  assert.equal(state.status, 'running')
  assert.equal(state.runId, 'run-123')
})

test('debug task events drive node status and duration', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { id: 't1', name: 'plan', input: {} } } },
      { event: 'debug', data: { type: 'task_result', step: 1, payload: { id: 't1', name: 'plan', error: null, result: { topic: 'x' } } } },
    ],
    started(),
  )
  assert.equal(state.statuses.plan, 'done')
  assert.equal(state.runCounts.plan, 1)
  assert.equal(state.durations.plan, 100)
})

test('a real node crash marks the run failed, not done', () => {
  // Exactly what the server sent for a TypeError inside a reducer: a debug
  // checkpoint, then a bare `error` frame. No task_result anywhere.
  const crashed = feed(
    [
      { event: 'metadata', data: { run_id: 'r1', attempt: 1 } },
      { event: 'debug', data: { type: 'checkpoint', step: -1, payload: { next: ['__start__'] } } },
      { event: 'error', data: { error: 'TypeError', message: 'can only concatenate list (not "str") to list' } },
    ],
    started(),
  )
  assert.equal(crashed.status, 'error')
  assert.match(crashed.error, /can only concatenate list/)

  // The stream then simply ends. Ending is not evidence of success.
  const settled = runReducer(crashed, { type: 'finish', status: 'done', at: 9999 })
  assert.equal(settled.status, 'error', 'a crashed run must not report done')
})

test('an error frame marks whichever node was in flight as failed', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { name: 'critique' } } },
      { event: 'error', data: { error: 'ValueError', message: 'bad score' } },
    ],
    started(),
  )
  assert.equal(state.statuses.critique, 'error')
})

test('a task_result carrying an error is still handled, if one ever arrives', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { id: 't1', name: 'plan' } } },
      { event: 'debug', data: { type: 'task_result', step: 1, payload: { id: 't1', name: 'plan', error: 'boom' } } },
    ],
    started(),
  )
  assert.equal(state.statuses.plan, 'error')
  assert.equal(state.log.at(-1).isError, true)
})

test('cancelling does not paint the interrupted node as completed', () => {
  const running = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { name: 'write_draft' } } },
      { event: 'debug', data: { type: 'checkpoint', step: 1, payload: { next: ['critique'] } } },
    ],
    started(),
  )
  const cancelled = runReducer(running, { type: 'finish', status: 'cancelled', at: 9999 })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.statuses.write_draft, 'stopped', 'a cancelled node did not finish')
  assert.equal(cancelled.statuses.critique, 'stopped')
})

test('resuming an interrupt keeps the colouring of nodes that already ran', () => {
  const parked = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { name: 'prepare' } } },
      { event: 'debug', data: { type: 'task_result', step: 1, payload: { name: 'prepare', error: null } } },
      { event: 'updates', data: { __interrupt__: [{ value: { question: 'ok?' }, id: 'i1' }] } },
    ],
    started(),
  )
  assert.equal(parked.statuses.prepare, 'done')

  const resumed = runReducer(parked, { type: 'start', at: 5000, resume: true })
  assert.equal(resumed.statuses.prepare, 'done', 'resuming must not blank the canvas')
  assert.equal(resumed.durations.prepare, parked.durations.prepare)

  // A fresh run, by contrast, starts from nothing.
  const fresh = runReducer(parked, { type: 'start', at: 5000, resume: false })
  assert.deepEqual(fresh.statuses, {})
})

test('an ordinary node update does not discard a pending interrupt', () => {
  const parked = feed(
    [{ event: 'updates', data: { __interrupt__: [{ value: { question: 'ok?' }, id: 'i1' }] } }],
    started(),
  )
  // A second graph in the same thread emitting an unrelated update used to null
  // the interrupt, losing the Resume card with no way back in-session.
  const later = feed([{ event: 'updates', data: { some_other_node: { ok: true } } }], parked)
  assert.notEqual(later.interrupt, null)
})

test('checkpoint next[] queues upcoming nodes without demoting a running one', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 1, payload: { id: 't1', name: 'plan' } } },
      { event: 'debug', data: { type: 'checkpoint', step: 1, payload: { next: ['plan', 'write_draft'] } } },
    ],
    started(),
  )
  assert.equal(state.statuses.plan, 'running')
  assert.equal(state.statuses.write_draft, 'queued')
})

test('a node that loops is counted each time it runs', () => {
  const cycle = [
    { event: 'debug', data: { type: 'task', step: 1, payload: { name: 'write_draft' } } },
    { event: 'debug', data: { type: 'task_result', step: 1, payload: { name: 'write_draft', error: null } } },
  ]
  const state = feed([...cycle, ...cycle, ...cycle], started())
  assert.equal(state.runCounts.write_draft, 3)
})

test('values replaces the whole state snapshot', () => {
  const state = feed([{ event: 'values', data: { topic: 'tiny local tools', score: 0.45 } }], started())
  assert.deepEqual(state.values, { topic: 'tiny local tools', score: 0.45 })
})

test('an __interrupt__ update parks the run and surfaces the payload', () => {
  const state = feed(
    [
      { event: 'updates', data: { prepare: { request: 'refund order 4417' } } },
      {
        event: 'updates',
        data: {
          __interrupt__: [{ value: { question: 'Approve refund order 4417 for 240?', options: ['approve', 'reject'] }, id: 'i1' }],
        },
      },
    ],
    started(),
  )
  assert.equal(state.status, 'interrupted')
  assert.equal(state.interrupt.value.question, 'Approve refund order 4417 for 240?')
  assert.equal(state.statuses.prepare, 'done')
})

test('starting the resume run is what clears the interrupt', () => {
  const interrupted = feed(
    [{ event: 'updates', data: { __interrupt__: [{ value: { question: 'q?' } }] } }],
    started(),
  )
  assert.notEqual(interrupted.interrupt, null)

  // Answering it dispatches a resume `start`; that is the moment the card goes.
  const resuming = runReducer(interrupted, { type: 'start', at: 5000, resume: true })
  assert.equal(resuming.interrupt, null)

  const resumed = feed([{ event: 'updates', data: { ask_human: { decision: 'approve' } } }], resuming)
  assert.equal(resumed.interrupt, null)
  assert.equal(resumed.statuses.ask_human, 'done')
})

test('subgraph-namespaced modes are treated as their base mode', () => {
  const state = feed([{ event: 'updates|sub:1', data: { inner_node: { ok: true } } }], started())
  assert.equal(state.statuses.inner_node, 'done')
})

test('an error event records the message', () => {
  const state = feed([{ event: 'error', data: { message: 'node raised ValueError' } }], started())
  assert.equal(state.status, 'error')
  assert.equal(state.error, 'node raised ValueError')
})

test('finishing settles any node left mid-flight', () => {
  const running = feed([{ event: 'debug', data: { type: 'task', step: 1, payload: { name: 'plan' } } }], started())
  const settled = runReducer(running, { type: 'finish', status: 'done', at: 9999 })
  assert.equal(settled.statuses.plan, 'done')
  assert.equal(settled.status, 'done')
})

test('the log is capped so a long run cannot grow without bound', () => {
  const events = Array.from({ length: MAX_LOG_ENTRIES + 50 }, (_, i) => ({
    event: 'updates',
    data: { [`node_${i}`]: { i } },
  }))
  const state = feed(events, started())
  assert.equal(state.log.length, MAX_LOG_ENTRIES)
  // The newest entries survive; the oldest are dropped.
  assert.equal(state.log.at(-1).label, `node_${MAX_LOG_ENTRIES + 49}`)
})

test('starting a fresh run clears the previous one, resuming keeps it', () => {
  const previous = feed([{ event: 'values', data: { a: 1 } }], started())
  const fresh = runReducer(previous, { type: 'start', at: 5, resume: false })
  assert.equal(fresh.values, null)
  assert.equal(fresh.log.length, 0)

  const resumed = runReducer(previous, { type: 'start', at: 5, resume: true })
  assert.deepEqual(resumed.values, { a: 1 })
  assert.equal(resumed.log.length, previous.log.length)
})

test('hydrating a stored thread shows its pending nodes and interrupt', () => {
  const state = runReducer(initialRunState, {
    type: 'hydrate',
    values: { topic: 'x' },
    interrupt: { value: { question: 'ok?' } },
    next: ['ask_human'],
  })
  assert.equal(state.statuses.ask_human, 'interrupted')
  assert.equal(state.status, 'interrupted')
})

test('a stream that ends at an interrupt stays interrupted, not done', () => {
  const parked = feed(
    [{ event: 'updates', data: { __interrupt__: [{ value: { question: 'ok?' } }] } }],
    started(),
  )
  const settled = runReducer(parked, { type: 'finish', status: 'done', at: 9999 })
  assert.equal(settled.status, 'interrupted')
})

test('a task that returns interrupts is parked, not completed', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 2, payload: { name: 'ask_human' } } },
      {
        event: 'debug',
        data: {
          type: 'task_result',
          step: 2,
          payload: { name: 'ask_human', error: null, interrupts: [{ id: 'i1', value: { question: 'ok?' } }] },
        },
      },
    ],
    started(),
  )
  assert.equal(state.statuses.ask_human, 'interrupted')
})

test('an interrupt parks whichever node was mid-flight', () => {
  const state = feed(
    [
      { event: 'debug', data: { type: 'task', step: 2, payload: { name: 'ask_human' } } },
      { event: 'updates', data: { __interrupt__: [{ value: { question: 'ok?' } }] } },
    ],
    started(),
  )
  assert.equal(state.statuses.ask_human, 'interrupted')
})

/**
 * The log used to hold every payload by reference. LangGraph re-sends the whole
 * graph state each superstep, so 600 steps of a 2 MB-state graph pinned ~772 MB
 * and took the tab with it. Entries stay as timeline marks; payloads do not.
 */
test('retained payloads stay bounded however long the run goes on', () => {
  const bigDelta = { draft: 'x'.repeat(50_000) }
  let state = started()
  for (let i = 0; i < 400; i += 1) {
    state = runReducer(state, {
      type: 'event',
      event: { event: 'updates', data: { [`node_${i}`]: bigDelta } },
      at: 1000 + i,
    })
  }

  const withPayload = state.log.filter((entry) => entry.payload !== undefined)
  assert.ok(
    withPayload.length <= RETAINED_PAYLOADS,
    `${withPayload.length} payloads retained, expected at most ${RETAINED_PAYLOADS}`,
  )
  // The entries themselves survive -- only the payload is released.
  assert.equal(state.log.length, Math.min(400, MAX_LOG_ENTRIES))
  assert.ok(state.log.some((entry) => entry.payloadDropped))
  // The newest entry always keeps its payload; that is the one being looked at.
  assert.notEqual(state.log.at(-1).payload, undefined)
})

test('a values frame never retains the whole state a second time', () => {
  const state = feed(
    [{ event: 'values', data: { draft: 'y'.repeat(100_000), messages: [] } }],
    started(),
  )
  const entry = state.log.at(-1)
  assert.equal(entry.kind, 'values')
  // The State tab renders the current values in full; a duplicate here is pure
  // memory cost for a line that only needs to say "state updated".
  assert.equal(entry.payload, undefined)
  assert.equal(entry.payloadDropped, true)
  // The state itself is still available.
  assert.equal(state.values.draft.length, 100_000)
})

test('batched events fold identically to one-at-a-time dispatch', () => {
  const events = [
    { event: 'metadata', data: { run_id: 'r1' } },
    { event: 'debug', data: { type: 'task', step: 1, payload: { name: 'plan' } } },
    { event: 'debug', data: { type: 'task_result', step: 1, payload: { name: 'plan', error: null } } },
    { event: 'updates', data: { plan: { ok: true } } },
  ]
  const oneAtATime = events.reduce(
    (acc, event, i) => runReducer(acc, { type: 'event', event, at: 1000 + i }),
    started(),
  )
  const batched = runReducer(started(), {
    type: 'events',
    events: events.map((event, i) => ({ event, at: 1000 + i })),
  })

  assert.deepEqual(batched.statuses, oneAtATime.statuses)
  assert.deepEqual(batched.runCounts, oneAtATime.runCounts)
  assert.equal(batched.status, oneAtATime.status)
  assert.equal(batched.log.length, oneAtATime.log.length)
})
