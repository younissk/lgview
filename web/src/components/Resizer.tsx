import { useCallback, useRef } from 'react'

export interface ResizerProps {
  /** What this handle resizes, for the accessible name. */
  label: string
  width: number
  min: number
  max: number
  /**
   * 1 when dragging right makes the panel wider (a left-hand panel), -1 when
   * dragging right makes it narrower (a right-hand panel).
   */
  direction: 1 | -1
  onResize: (width: number) => void
  onReset: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Width a drag should produce, given where it started and how far it moved.
 *
 * Extracted so it can be tested for real: jsdom implements no PointerEvent, so
 * a "drag" test there exercises testing-library's event shim rather than this
 * arithmetic. The event plumbing is verified in a browser instead.
 */
export function widthAfterDrag(
  startWidth: number,
  deltaX: number,
  direction: 1 | -1,
  min: number,
  max: number,
): number {
  return clamp(startWidth + deltaX * direction, min, max)
}

/**
 * A draggable divider between two panels.
 *
 * Exposed as a real `separator` with arrow-key support rather than a
 * drag-only affordance, because a divider you can only operate with a mouse is
 * a divider a keyboard user cannot move at all. Double-click restores the
 * default width.
 */
export function Resizer({ label, width, min, max, direction, onResize, onReset }: ResizerProps) {
  const origin = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Ignore secondary buttons so a right-click never starts a drag.
      if (event.button !== 0) return
      origin.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = origin.current
      if (!start) return
      event.preventDefault()
      onResize(widthAfterDrag(start.width, event.clientX - start.x, direction, min, max))
    },
    [direction, min, max, onResize],
  )

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 1 : 16
      let next: number | null = null
      if (event.key === 'ArrowLeft') next = width - step * direction
      else if (event.key === 'ArrowRight') next = width + step * direction
      else if (event.key === 'Home') next = min
      else if (event.key === 'End') next = max
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onReset()
        return
      }
      if (next === null) return
      event.preventDefault()
      onResize(clamp(next, min, max))
    },
    [direction, max, min, onReset, onResize, width],
  )

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} width`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title={`Drag to resize. Double-click to reset.`}
    >
      <span className="resizer-grip" aria-hidden="true" />
    </div>
  )
}
