/** React Flow node renderers. Status colour is the whole point of these. */
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { GraphNodeData } from '../lib/layout'
import { formatDuration } from '../lib/format'

export function GraphNodeView({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const node = data as GraphNodeData
  return (
    <div className={`gnode gnode-${node.status}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={targetPosition ?? Position.Top} className="gnode-handle" />
      <span className="gnode-label">{node.label}</span>
      <span className="gnode-meta">
        {node.status === 'running' && <span className="gnode-spinner" aria-hidden="true" />}
        {node.runs > 1 && <span className="gnode-badge">&times;{node.runs}</span>}
        {node.durationMs !== undefined && <span className="gnode-duration">{formatDuration(node.durationMs)}</span>}
      </span>
      <Handle type="source" position={sourcePosition ?? Position.Bottom} className="gnode-handle" />
    </div>
  )
}

export function TerminalNodeView({ data, sourcePosition, targetPosition }: NodeProps) {
  const node = data as GraphNodeData
  const isStart = node.label === 'start'
  return (
    <div className={`gterm ${isStart ? 'gterm-start' : 'gterm-end'} gnode-${node.status}`}>
      {!isStart && <Handle type="target" position={targetPosition ?? Position.Top} className="gnode-handle" />}
      <span>{node.label}</span>
      {isStart && <Handle type="source" position={sourcePosition ?? Position.Bottom} className="gnode-handle" />}
    </div>
  )
}
