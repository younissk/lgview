import type { Assistant, ServerInfo } from '../api/types'
import type { ConnectionStatus, ServerEntry } from '../state/useServers'
import type { LayoutDirection } from '../lib/layout'
import { Icon } from './Icon'

export interface TopBarProps {
  servers: ServerEntry[]
  activeId: string | null
  status: ConnectionStatus
  info: ServerInfo | null
  assistants: Assistant[]
  selectedAssistantId: string | null
  direction: LayoutDirection
  reloadNotice: boolean
  compact: boolean
  openDrawer: 'run' | 'inspect' | null
  onToggleDrawer: (which: 'run' | 'inspect') => void
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
  compact,
  openDrawer,
  onToggleDrawer,
  onSelectServer,
  onSelectAssistant,
  onManageServers,
  onToggleDirection,
}: TopBarProps) {
  const directionLabel = direction === 'TB' ? 'Switch to horizontal layout' : 'Switch to vertical layout'

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">lgview</span>
      </div>

      {compact && (
        <button
          type="button"
          className={`icon-btn${openDrawer === 'run' ? ' is-active' : ''}`}
          aria-label="Show the run panel and threads"
          aria-expanded={openDrawer === 'run'}
          title="Run panel and threads"
          onClick={() => onToggleDrawer('run')}
        >
          <Icon name="panelLeft" />
        </button>
      )}

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
        <button type="button" className="icon-btn" aria-label="Manage servers" title="Manage servers" onClick={onManageServers}>
          <Icon name="settings" />
        </button>
        <span
          className={`status status-${status}`}
          title={info?.version ? `langgraph-api ${info.version}` : status}
        >
          <span className="dot" aria-hidden="true" />
          <span className="status-text">
            {status === 'online' ? (info?.version ? `v${info.version}` : 'online') : status}
          </span>
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
          <span className="reload-pill" role="status" title="The server hot-reloaded and the topology changed">
            reloaded
          </span>
        )}
      </div>

      <div className="topbar-spacer" />

      <button type="button" className="icon-btn" onClick={onToggleDirection} aria-label={directionLabel} title={directionLabel}>
        <Icon name={direction === 'TB' ? 'layoutVertical' : 'layoutHorizontal'} />
      </button>

      {compact && (
        <button
          type="button"
          className={`icon-btn${openDrawer === 'inspect' ? ' is-active' : ''}`}
          aria-label="Show the inspector"
          aria-expanded={openDrawer === 'inspect'}
          title="Inspector"
          onClick={() => onToggleDrawer('inspect')}
        >
          <Icon name="panelRight" />
        </button>
      )}
    </header>
  )
}
