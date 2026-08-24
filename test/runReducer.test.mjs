import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialRunState, runReducer, MAX_LOG_ENTRIES } from '../web/src/state/runReducer.ts'

/** Payload shapes below are copied from a real langgraph-api 0.13.0 stream. */
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

test('a failed task shows as an error, not as done', () => {
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

test('resuming past an interrupt clears it', () => {
  const interrupted = feed(
    [{ event: 'updates', data: { __interrupt__: [{ value: { question: 'q?' } }] } }],
    started(),
  )
  const resumed = feed([{ event: 'updates', data: { ask_human: { decision: 'approve' } } }], interrupted)
  assert.equal(resumed.interrupt, null)
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
