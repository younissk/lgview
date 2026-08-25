import { test } from 'vitest'
import assert from 'node:assert/strict'
import { SseDecoder } from '../web/src/api/sse.ts'

test('decodes a complete event', () => {
  const decoder = new SseDecoder()
  const events = decoder.push('event: updates\ndata: {"plan":{"ok":true}}\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'updates')
  assert.deepEqual(events[0].data, { plan: { ok: true } })
})

test('reassembles an event split across chunks', () => {
  const decoder = new SseDecoder()
  assert.deepEqual(decoder.push('event: val'), [])
  assert.deepEqual(decoder.push('ues\ndata: {"a":'), [])
  const events = decoder.push('1}\n\n')
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].data, { a: 1 })
})

test('joins repeated data lines with newlines', () => {
  const decoder = new SseDecoder()
  const events = decoder.push('event: x\ndata: {"a":\ndata: 1}\n\n')
  assert.deepEqual(events[0].data, { a: 1 })
})

test('ignores comments and handles CRLF', () => {
  const decoder = new SseDecoder()
  const events = decoder.push(': keep-alive\r\nevent: end\r\ndata: {}\r\n\r\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'end')
})

test('emits several events from one chunk, in order', () => {
  const decoder = new SseDecoder()
  const events = decoder.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')
  assert.deepEqual(events.map((e) => e.event), ['a', 'b'])
})

test('flush releases a trailing event with no blank line', () => {
  const decoder = new SseDecoder()
  assert.deepEqual(decoder.push('event: metadata\ndata: {"run_id":"r1"}\n'), [])
  const events = decoder.flush()
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].data, { run_id: 'r1' })
})

test('non-JSON data survives as text rather than throwing', () => {
  const decoder = new SseDecoder()
  const events = decoder.push('event: error\ndata: upstream exploded\n\n')
  assert.equal(events[0].data, 'upstream exploded')
})

test('a data line with no space after the colon keeps every character', () => {
  const decoder = new SseDecoder()
  const events = decoder.push('event:values\ndata:{"a":1}\n\n')
  assert.equal(events[0].event, 'values')
  assert.deepEqual(events[0].data, { a: 1 })
})

/**
 * Guards the shape of the cost, not a wall-clock number.
 *
 * The decoder was quadratic: it re-normalised and re-scanned everything
 * received on every socket chunk. LangGraph re-sends the whole graph state
 * each superstep, so a run carrying a 20 MB state blocked the main thread for
 * ~15 s per step. Comparing per-megabyte cost at two sizes catches a
 * regression without pinning a number that varies by machine.
 */
test('decoding cost stays proportional to the payload, not its square', () => {
  const feed = (megabytes) => {
    const frame = `event: values\ndata: ${JSON.stringify({ draft: 'x'.repeat(megabytes * 1024 * 1024) })}\n\n`
    const decoder = new SseDecoder()
    const chunk = 16 * 1024
    const started = performance.now()
    let events = 0
    for (let i = 0; i < frame.length; i += chunk) {
      events += decoder.push(frame.slice(i, i + chunk)).length
    }
    return { perMb: (performance.now() - started) / megabytes, events }
  }

  const small = feed(1)
  const large = feed(8)
  assert.equal(small.events, 1)
  assert.equal(large.events, 1)

  // Linear means per-megabyte cost is flat. Quadratic showed an 8x rise here;
  // 4x leaves generous headroom for a noisy CI box.
  assert.ok(
    large.perMb < small.perMb * 4 + 5,
    `per-MB cost grew from ${small.perMb.toFixed(1)}ms to ${large.perMb.toFixed(1)}ms — decoder may be quadratic again`,
  )
})
