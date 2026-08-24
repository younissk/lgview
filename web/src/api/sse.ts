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
  private buffer = ''
  private eventName = ''
  private dataLines: string[] = []

  /** Feed a chunk of text; returns every event completed by it. */
  push(chunk: string): StreamEvent[] {
    this.buffer += chunk
    const events: StreamEvent[] = []
    // Normalise CRLF and lone CR so a single split handles every line ending.
    this.buffer = this.buffer.replace(/\r\n|\r/g, '\n')

    let index: number
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      const event = this.consumeLine(line)
      if (event) events.push(event)
    }
    return events
  }

  /** Flush a trailing event that arrived without its final blank line. */
  flush(): StreamEvent[] {
    const events: StreamEvent[] = []
    if (this.buffer.length > 0) {
      const event = this.consumeLine(this.buffer)
      this.buffer = ''
      if (event) events.push(event)
    }
    const final = this.dispatch()
    if (final) events.push(final)
    return events
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
