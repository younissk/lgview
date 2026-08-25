/**
 * A server-sent events decoder.
 *
 * We cannot use `EventSource`: it only does GET, and every LangGraph run
 * stream is a POST with a JSON body. So we read the fetch body ourselves and
 * decode the wire format per the HTML spec -- events are separated by a blank
 * line, `data:` may repeat and is joined with newlines, and a leading space
 * after the colon is stripped.
 */
import type { StreamEvent } from './types'

export class SseDecoder {
  /**
   * Pieces of the line currently being assembled, joined only when it ends.
   *
   * Deliberately not a single accumulating string. `buffer += chunk` builds a
   * rope, and every `indexOf` on it forces a flatten, so scanning stayed
   * proportional to everything received rather than to the new chunk. With
   * LangGraph re-sending full graph state each superstep, a 20 MB state froze
   * the tab for ~15 s per step. Searching only the chunk makes it linear.
   */
  private pending: string[] = []
  private eventName = ''
  private dataLines: string[] = []
  /** A `\r` at the end of a chunk may be the first half of a `\r\n`. */
  private pendingCarriageReturn = false

  /** Feed a chunk of text; returns every event completed by it. */
  push(chunk: string): StreamEvent[] {
    let text = chunk
    if (this.pendingCarriageReturn) {
      // The `\r` already ended a line; swallow the `\n` that completes it.
      if (text.startsWith('\n')) text = text.slice(1)
      this.pendingCarriageReturn = false
    }
    if (text.endsWith('\r')) {
      this.pendingCarriageReturn = true
      text = text.slice(0, -1)
    }
    if (text.includes('\r')) text = text.replace(/\r\n|\r/g, '\n')

    const events: StreamEvent[] = []
    let from = 0
    let index: number
    while ((index = text.indexOf('\n', from)) !== -1) {
      this.pending.push(text.slice(from, index))
      from = index + 1
      const event = this.consumeLine(this.takePending())
      if (event) events.push(event)
    }
    if (from < text.length) this.pending.push(text.slice(from))
    return events
  }

  /** Flush a trailing event that arrived without its final blank line. */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = []
    if (this.pending.length > 0) {
      const event = this.consumeLine(this.takePending())
      if (event) events.push(event)
    }
    const final = this.dispatch()
    if (final) events.push(final)
    return events
  }

  private takePending(): string {
    const line = this.pending.length === 1 ? this.pending[0] : this.pending.join('')
    this.pending.length = 0
    return line
  }

  private consumeLine(line: string): StreamEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null // comment / keep-alive

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') this.eventName = value
    else if (field === 'data') this.dataLines.push(value)
    // `id` and `retry` are meaningful for reconnection, which we do not do.
    return null
  }

  private dispatch(): StreamEvent | null {
    if (this.dataLines.length === 0 && this.eventName === '') return null
    const raw = this.dataLines.join('\n')
    this.dataLines = []
    const event = this.eventName || 'message'
    this.eventName = ''
    if (raw === '') return { event, data: null }
    return { event, data: safeParse(raw) }
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // The server should always send JSON, but a proxy error page or a
    // truncated final chunk should surface as text rather than crash the run.
    return raw
  }
}

/** Decode a fetch response body into a stream of events. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const sse = new SseDecoder()
  try {
    for (;;) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      for (const event of sse.push(decoder.decode(value, { stream: true }))) {
        yield event
      }
    }
    for (const event of sse.flush()) yield event
  } finally {
    reader.releaseLock()
  }
}
