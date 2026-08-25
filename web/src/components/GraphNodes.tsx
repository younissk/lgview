/** React Flow node renderers. Status colour is the whole point of these. */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { GraphNodeData, NodeStatus } from '../lib/layout'
import { describeStatus } from '../lib/layout'
import { formatDuration } from '../lib/format'

/**
 * Status is also carried as a glyph, not by colour alone. A protanope sees
 * finished and failed at 1.12:1 against each other.
 */
const STATUS_GLYPH: Partial<Record<NodeStatus, string>> = {
  done: '\u2713',
  error: '\u2715',
  interrupted: '\u23F8',
  stopped: '\u25A0',
  queued: '\u2026',
}

export const GraphNodeView = memo(function GraphNodeView({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const node = data as GraphNodeData
  return (
    <div className={`gnode gnode-${node.status}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={targetPosition ?? Position.Top} className="gnode-handle" />
      <span className="gnode-label">{node.label}</span>
      <span className="gnode-meta">
        {node.status === 'running' && <span className="gnode-spinner" aria-hidden="true" />}
        {STATUS_GLYPH[node.status] && (
          <span className={`gnode-glyph gnode-glyph-${node.status}`} aria-hidden="true">
            {STATUS_GLYPH[node.status]}
          </span>
        )}
        <span className="sr-only">{describeStatus(node.status)}</span>
        {node.runs > 1 && <span className="gnode-badge">&times;{node.runs}</span>}
        {node.durationMs !== undefined && <span className="gnode-duration">{formatDuration(node.durationMs)}</span>}
      </span>
      <Handle type="source" position={sourcePosition ?? Position.Bottom} className="gnode-handle" />
    </div>
  )
})

export const TerminalNodeView = memo(function TerminalNodeView({ data, sourcePosition, targetPosition }: NodeProps) {
  const node = data as GraphNodeData
  const isStart = node.label === 'start'
  return (
    <div className={`gterm ${isStart ? 'gterm-start' : 'gterm-end'} gnode-${node.status}`}>
      {!isStart && <Handle type="target" position={targetPosition ?? Position.Top} className="gnode-handle" />}
      <span>{node.label}</span>
      {isStart && <Handle type="source" position={sourcePosition ?? Position.Bottom} className="gnode-handle" />}
    </div>
  )
})
