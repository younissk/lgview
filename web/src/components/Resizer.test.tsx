import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Resizer, widthAfterDrag } from './Resizer'

const setup = (over: Partial<Parameters<typeof Resizer>[0]> = {}) => {
  const onResize = vi.fn()
  const onReset = vi.fn()
  render(
    <Resizer
      label="Run panel"
      width={300}
      min={220}
      max={460}
      direction={1}
      onResize={onResize}
      onReset={onReset}
      {...over}
    />,
  )
  return { onResize, onReset, handle: screen.getByRole('separator') }
}

describe('as an accessible control', () => {
  test('exposes its position so assistive tech can report it', () => {
    const { handle } = setup()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-label', 'Run panel width')
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-valuemin', '220')
    expect(handle).toHaveAttribute('aria-valuemax', '460')
  })

  test('arrow keys move it — a drag-only divider is unusable without a mouse', () => {
    const { onResize, handle } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(316)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(284)
  })

  test('shift gives fine-grained steps', () => {
    const { onResize, handle } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(301)
  })

  test('Home and End jump to the bounds', () => {
    const { onResize, handle } = setup()
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onResize).toHaveBeenLastCalledWith(220)
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onResize).toHaveBeenLastCalledWith(460)
  })

  test('Enter resets to the default width', () => {
    const { onReset, handle } = setup()
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  test('double-click resets too', () => {
    const { onReset, handle } = setup()
    fireEvent.doubleClick(handle)
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})

describe('bounds', () => {
  test('cannot be driven past its maximum', () => {
    const { onResize, handle } = setup({ width: 455 })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(460)
  })

  test('cannot be driven below its minimum', () => {
    const { onResize, handle } = setup({ width: 225 })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(220)
  })

  test('a right-hand panel grows when dragged left', () => {
    // direction -1: the inspector is on the far side, so the same gesture has
    // to mean the opposite thing or the handle fights the pointer.
    const { onResize, handle } = setup({ direction: -1, label: 'Inspector' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(316)
  })
})

/**
 * The pointer plumbing itself is not tested here on purpose: jsdom implements
 * no PointerEvent, so such a test would assert on testing-library's shim rather
 * than on anything this component does. Dragging is verified in a real browser;
 * the arithmetic it depends on is verified below.
 */
describe('drag arithmetic', () => {
  test('a left-hand panel grows as the pointer moves right', () => {
    expect(widthAfterDrag(300, 60, 1, 220, 460)).toBe(360)
    expect(widthAfterDrag(300, -60, 1, 220, 460)).toBe(240)
  })

  test('a right-hand panel grows as the pointer moves left', () => {
    expect(widthAfterDrag(300, -60, -1, 220, 460)).toBe(360)
    expect(widthAfterDrag(300, 60, -1, 220, 460)).toBe(240)
  })

  test('a drag past either bound stops at the bound rather than inverting', () => {
    expect(widthAfterDrag(300, 5000, 1, 220, 460)).toBe(460)
    expect(widthAfterDrag(300, -5000, 1, 220, 460)).toBe(220)
  })

  test('no movement is no change', () => {
    expect(widthAfterDrag(317, 0, 1, 220, 460)).toBe(317)
  })
})
