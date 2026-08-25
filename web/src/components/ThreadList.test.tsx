import { describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThreadList } from './ThreadList'
import type { Thread } from '../api/types'

const thread = (over: Partial<Thread> = {}): Thread => ({
  thread_id: '01a03869-23dd-7070-902f-e6d13840c930',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  metadata: {},
  status: 'idle',
  ...over,
})

const setup = (over: Partial<Parameters<typeof ThreadList>[0]> = {}) => {
  const onDelete = vi.fn()
  const onSelect = vi.fn()
  render(
    <ThreadList
      threads={[thread()]}
      activeId={null}
      onSelect={onSelect}
      onDelete={onDelete}
      onRefresh={vi.fn()}
      {...over}
    />,
  )
  return { onDelete, onSelect, user: userEvent.setup() }
}

describe('deleting a thread', () => {
  test('the first click asks rather than deleting', async () => {
    const { onDelete, user } = setup()

    await user.click(screen.getByRole('button', { name: /delete thread .* and all its checkpoints/i }))

    // Deletion destroys every checkpoint in the thread and cannot be undone.
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'delete?' })).toBeInTheDocument()
  })

  test('the second click confirms it', async () => {
    const { onDelete, user } = setup()

    await user.click(screen.getByRole('button', { name: /delete thread/i }))
    await user.click(screen.getByRole('button', { name: 'delete?' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('01a03869-23dd-7070-902f-e6d13840c930')
  })

  test('the confirmation disarms itself so a stray later click is safe', () => {
    vi.useFakeTimers()
    try {
      const onDelete = vi.fn()
      render(
        <ThreadList threads={[thread()]} activeId={null} onSelect={vi.fn()} onDelete={onDelete} onRefresh={vi.fn()} />,
      )
      // fireEvent, not userEvent: userEvent's own async plumbing deadlocks
      // against fake timers here, and a plain click is all this needs.
      fireEvent.click(screen.getByRole('button', { name: /delete thread/i }))
      expect(screen.getByRole('button', { name: 'delete?' })).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(5000))
      expect(screen.queryByRole('button', { name: 'delete?' })).not.toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  test('the delete control names the thread it would destroy', () => {
    setup()
    // A bare "×" tells a screen-reader user nothing about what is at stake.
    expect(screen.getByRole('button', { name: /delete thread 01a0386923 and all its checkpoints/i })).toBeInTheDocument()
  })
})

describe('thread errors', () => {
  test('a thread-scoped failure is shown, not swallowed', () => {
    setup({ error: 'could not load the thread' })
    expect(screen.getByRole('alert')).toHaveTextContent('could not load the thread')
  })

  test('no alert is rendered when nothing is wrong', () => {
    setup()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
