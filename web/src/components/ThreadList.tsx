import { useEffect, useState } from 'react'
import type { Thread } from '../api/types'
import { formatRelative, shortId } from '../lib/format'
import { Icon } from './Icon'

export interface ThreadListProps {
  threads: Thread[]
  activeId: string | null
  error?: string | null
  hasMore?: boolean
  loadingMore?: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
  onLoadMore?: () => void
}

export function ThreadList({
  threads,
  activeId,
  error,
  hasMore,
  loadingMore,
  onSelect,
  onDelete,
  onRefresh,
  onLoadMore,
}: ThreadListProps) {
  // Deleting a thread destroys every checkpoint in it and cannot be undone, so
  // the button asks first. Two-step in place rather than window.confirm, which
  // is easy to dismiss reflexively.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingDelete) return
    const timer = window.setTimeout(() => setPendingDelete(null), 4000)
    return () => window.clearTimeout(timer)
  }, [pendingDelete])

  return (
    <section className="panel thread-panel">
      <header className="panel-head">
        <h2>Threads</h2>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label="Refresh threads" title="Refresh threads">
          <Icon name="refresh" size={14} />
        </button>
      </header>
      {error && <p className="field-error pad" role="alert">{error}</p>}
      <ul className="thread-list">
        {threads.length === 0 && <li className="muted pad">No threads yet.</li>}
        {threads.map((thread) => (
          <li key={thread.thread_id} className={thread.thread_id === activeId ? 'is-active' : ''}>
            <button type="button" className="thread-pick" onClick={() => onSelect(thread.thread_id)}>
              <span className="mono">{shortId(thread.thread_id, 10)}</span>
              <span className={`chip chip-sm chip-${thread.status}`}>{thread.status}</span>
              <span className="muted">{formatRelative(thread.updated_at)}</span>
            </button>
            {pendingDelete === thread.thread_id ? (
              <button
                type="button"
                className="link-btn danger confirm-delete"
                onClick={() => {
                  setPendingDelete(null)
                  onDelete(thread.thread_id)
                }}
              >
                delete?
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn icon-btn-sm danger"
                aria-label={`Delete thread ${shortId(thread.thread_id, 10)} and all its checkpoints`}
                title="Delete this thread and all its checkpoints"
                onClick={() => setPendingDelete(thread.thread_id)}
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </li>
        ))}
        {hasMore && (
          <li className="thread-more">
            <button type="button" className="link-btn" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? 'loading…' : 'load older threads'}
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}
