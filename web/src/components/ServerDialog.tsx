/** Add, pick, or forget LangGraph servers. */
import { useEffect, useRef, useState } from 'react'
import type { ServerEntry } from '../state/useServers'

export interface ServerDialogProps {
  open: boolean
  servers: ServerEntry[]
  activeId: string | null
  onClose: () => void
  onAdd: (url: string, apiKey?: string) => void
  onRemove: (id: string) => void
  onSelect: (id: string) => void
}

export function ServerDialog({ open, servers, activeId, onClose, onAdd, onRemove, onSelect }: ServerDialogProps) {
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    // Remember where focus came from so Escape does not dump it on <body>.
    returnFocusTo.current = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => returnFocusTo.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // `aria-modal` tells assistive tech the rest of the page is inert; it
      // does not make Tab respect that. Without this, one Tab left the dialog
      // and wandered the 41 tabbables still behind it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, a[href]',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="LangGraph servers"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>LangGraph servers</h2>
        <p className="muted">
          Anything that speaks the LangGraph server API: <code>langgraph dev</code>, a self-hosted deployment, or a
          Platform URL.
        </p>

        <ul className="server-list">
          {servers.map((server) => (
            <li key={server.id} className={server.id === activeId ? 'is-active' : ''}>
              <button type="button" className="server-pick" onClick={() => onSelect(server.id)}>
                <span className="mono">{server.url}</span>
                {server.apiKey && <span className="chip chip-sm">key</span>}
              </button>
              <button type="button" className="link-btn danger" onClick={() => onRemove(server.id)}>
                forget
              </button>
            </li>
          ))}
          {servers.length === 0 && <li className="muted">None yet.</li>}
        </ul>

        <form
          className="server-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!url.trim()) return
            onAdd(url, apiKey.trim() || undefined)
            setUrl('')
            setApiKey('')
            onClose()
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={url}
            placeholder="http://127.0.0.1:2024"
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            type="password"
            value={apiKey}
            placeholder="API key (optional)"
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn-primary" disabled={!url.trim()}>
            Add
          </button>
        </form>

        <p className="muted small">
          The key is kept for this browser tab only and sent from the lgview process as <code>x-api-key</code>,
          to this server and no other. It is never written to disk.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
