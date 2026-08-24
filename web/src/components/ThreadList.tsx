import type { Thread } from '../api/types'
import { formatRelative, shortId } from '../lib/format'

export interface ThreadListProps {
  threads: Thread[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}

export function ThreadList({ threads, activeId, onSelect, onDelete, onRefresh }: ThreadListProps) {
  return (
    <section className="panel thread-panel">
      <header className="panel-head">
        <h2>Threads</h2>
        <button type="button" className="btn-ghost" onClick={onRefresh}>
          refresh
        </button>
      </header>
      <ul className="thread-list">
        {threads.length === 0 && <li className="muted pad">No threads yet.</li>}
        {threads.map((thread) => (
          <li key={thread.thread_id} className={thread.thread_id === activeId ? 'is-active' : ''}>
            <button type="button" className="thread-pick" onClick={() => onSelect(thread.thread_id)}>
              <span className="mono">{shortId(thread.thread_id, 10)}</span>
              <span className={`chip chip-sm chip-${thread.status}`}>{thread.status}</span>
              <span className="muted">{formatRelative(thread.updated_at)}</span>
            </button>
            <button
              type="button"
              className="link-btn danger"
              title="Delete this thread"
              onClick={() => onDelete(thread.thread_id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
