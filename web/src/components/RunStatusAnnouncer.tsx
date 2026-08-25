import { useEffect, useRef, useState } from 'react'
import type { RunState } from '../state/runReducer'

/**
 * Announces what the run is doing.
 *
 * Everything else about a run is conveyed visually -- colour on the canvas, a
 * status pill, a scrolling event log -- so without this a screen-reader user
 * gets no signal that a run started, failed, or is waiting on a human. Kept as
 * a separate component so re-announcing does not re-render the run panel.
 */
export function RunStatusAnnouncer({ run }: { run: RunState }) {
  const [message, setMessage] = useState('')
  const previous = useRef(run.status)

  useEffect(() => {
    if (run.status === previous.current) return
    previous.current = run.status
    switch (run.status) {
      case 'running':
        setMessage('Run started.')
        break
      case 'interrupted':
        setMessage('The graph is waiting for your input.')
        break
      case 'done':
        setMessage('Run finished.')
        break
      case 'error':
        setMessage(`Run failed. ${run.error ?? ''}`.trim())
        break
      case 'cancelled':
        setMessage('Run cancelled.')
        break
      default:
        setMessage('')
    }
  }, [run.status, run.error])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
