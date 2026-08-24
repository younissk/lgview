import type { Assistant, ServerInfo } from '../api/types'
import type { ConnectionStatus, ServerEntry } from '../state/useServers'
import type { LayoutDirection } from '../lib/layout'

export interface TopBarProps {
  servers: ServerEntry[]
  activeId: string | null
  status: ConnectionStatus
  info: ServerInfo | null
  assistants: Assistant[]
  selectedAssistantId: string | null
  direction: LayoutDirection
  reloadNotice: boolean
  onSelectServer: (id: string) => void
  onSelectAssistant: (id: string) => void
  onManageServers: () => void
  onToggleDirection: () => void
}

export function TopBar({
  servers,
  activeId,
  status,
  info,
  assistants,
  selectedAssistantId,
  direction,
  reloadNotice,
  onSelectServer,
  onSelectAssistant,
  onManageServers,
  onToggleDirection,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">lgview</span>
      </div>

      <div className="topbar-group">
        <label className="select-wrap">
          <span className="select-label">server</span>
          <select
            value={activeId ?? ''}
            onChange={(event) => onSelectServer(event.target.value)}
            disabled={servers.length === 0}
          >
            {servers.length === 0 && <option value="">no server</option>}
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.url.replace(/^https?:\/\//, '')}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-ghost" onClick={onManageServers}>
          manage
        </button>
        <span className={`status status-${status}`} title={info?.version ? `langgraph-api ${info.version}` : status}>
          <span className="dot" />
          {status === 'online' ? (info?.version ? `v${info.version}` : 'online') : status}
        </span>
      </div>

      <div className="topbar-group">
        <label className="select-wrap">
          <span className="select-label">graph</span>
          <select
            value={selectedAssistantId ?? ''}
            onChange={(event) => onSelectAssistant(event.target.value)}
            disabled={assistants.length === 0}
          >
            {assistants.length === 0 && <option value="">no graphs</option>}
            {assistants.map((assistant) => (
              <option key={assistant.assistant_id} value={assistant.assistant_id}>
                {assistant.graph_id}
              </option>
            ))}
          </select>
        </label>
        {reloadNotice && (
          <span className="reload-pill" title="The server hot-reloaded and the topology changed">
            reloaded
          </span>
        )}
      </div>

      <div className="topbar-spacer" />

      <button type="button" className="btn-ghost" onClick={onToggleDirection} title="Toggle layout direction">
        {direction === 'TB' ? 'vertical' : 'horizontal'}
      </button>
    </header>
  )
}
