/**
 * Turn a LangGraph topology into positioned React Flow nodes and edges.
 *
 * The server sends no coordinates -- only nodes and edges -- so every layout
 * decision is ours. Dagre gives a layered drawing, which is the right shape
 * for graphs that are mostly a pipeline with a few loops back.
 */
import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType, Position } from '@xyflow/react'
import type { GraphEdgeJson, GraphJson, GraphNodeJson } from '../api/types'

export const START_NODE = '__start__'
export const END_NODE = '__end__'

export type NodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'interrupted' | 'stopped'

export interface GraphNodeData extends Record<string, unknown> {
  label: string
  status: NodeStatus
  isTerminal: boolean
  /** How many times this node ran during the current session. */
  runs: number
  durationMs?: number
}

export type LayoutDirection = 'TB' | 'LR'

const NODE_WIDTH = 172
const NODE_HEIGHT = 48
const TERMINAL_WIDTH = 92
const TERMINAL_HEIGHT = 34
const CHAR_WIDTH = 7.6
const LABEL_PADDING = 44

/** Plain-language status, for screen readers and for the node's own badge. */
export function describeStatus(status: NodeStatus): string {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'done':
      return 'finished'
    case 'error':
      return 'failed'
    case 'interrupted':
      return 'waiting for input'
    case 'stopped':
      return 'stopped before finishing'
    default:
      return 'not run'
  }
}

export function isTerminal(id: string): boolean {
  return id === START_NODE || id === END_NODE
}

export function nodeLabel(node: GraphNodeJson): string {
  if (node.id === START_NODE) return 'start'
  if (node.id === END_NODE) return 'end'
  const data = node.data
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && typeof data.name === 'string') return data.name
  return node.id
}

function sizeFor(node: GraphNodeJson, label: string): { width: number; height: number } {
  if (isTerminal(node.id)) return { width: TERMINAL_WIDTH, height: TERMINAL_HEIGHT }
  return {
    width: Math.max(NODE_WIDTH, Math.round(label.length * CHAR_WIDTH + LABEL_PADDING)),
    height: NODE_HEIGHT,
  }
}

export interface LayoutResult {
  nodes: Node<GraphNodeData>[]
  edges: Edge[]
}

export function layoutGraph(
  graph: GraphJson,
  direction: LayoutDirection = 'TB',
  statuses: Record<string, NodeStatus> = {},
  runCounts: Record<string, number> = {},
  durations: Record<string, number> = {},
): LayoutResult {
  const dag = new dagre.graphlib.Graph({ multigraph: true })
  dag.setDefaultEdgeLabel(() => ({}))
  dag.setGraph({
    rankdir: direction,
    // Loops back to an earlier node need vertical room to be readable.
    ranksep: direction === 'TB' ? 62 : 92,
    nodesep: direction === 'TB' ? 46 : 34,
    marginx: 24,
    marginy: 24,
  })

  const known = new Set(graph.nodes.map((node) => node.id))
  const labels = new Map<string, string>()
  const sizes = new Map<string, { width: number; height: number }>()

  for (const node of graph.nodes) {
    const label = nodeLabel(node)
    const size = sizeFor(node, label)
    labels.set(node.id, label)
    sizes.set(node.id, size)
    dag.setNode(node.id, size)
  }

  // A malformed or partially-loaded graph must not throw inside dagre.
  const edges = graph.edges.filter((edge) => known.has(edge.source) && known.has(edge.target))
  edges.forEach((edge, index) => {
    dag.setEdge(edge.source, edge.target, {}, String(index))
  })

  dagre.layout(dag)

  const sourcePosition = direction === 'TB' ? Position.Bottom : Position.Right
  const targetPosition = direction === 'TB' ? Position.Top : Position.Left

  const nodes: Node<GraphNodeData>[] = graph.nodes.map((node) => {
    const positioned = dag.node(node.id)
    const size = sizes.get(node.id)!
    return {
      id: node.id,
      type: isTerminal(node.id) ? 'terminal' : 'graphNode',
      // Dagre reports centres; React Flow wants the top-left corner.
      position: {
        x: Math.round((positioned?.x ?? 0) - size.width / 2),
        y: Math.round((positioned?.y ?? 0) - size.height / 2),
      },
      // Announced to assistive technology; React Flow renders nodes as bare
      // divs with no accessible name of their own.
      ariaLabel: `${labels.get(node.id) ?? node.id}, ${describeStatus(statuses[node.id] ?? 'idle')}`,
      data: {
        label: labels.get(node.id) ?? node.id,
        status: statuses[node.id] ?? 'idle',
        isTerminal: isTerminal(node.id),
        runs: runCounts[node.id] ?? 0,
        durationMs: durations[node.id],
      },
      sourcePosition,
      targetPosition,
      // `initialWidth`/`initialHeight` rather than `width`/`height`: the latter
      // makes the node *controlled*, so React Flow stops measuring it, never
      // reports it initialised, and every fitView call silently becomes a
      // no-op. Dagre still gets the real sizes above; these are only a hint so
      // the first paint is not zero-sized.
      initialWidth: size.width,
      initialHeight: size.height,
      draggable: true,
      selectable: true,
    }
  })

  const flowEdges: Edge[] = edges.map((edge, index) => buildEdge(edge, index, statuses))
  return { nodes, edges: flowEdges }
}

function buildEdge(edge: GraphEdgeJson, index: number, statuses: Record<string, NodeStatus>): Edge {
  const conditional = Boolean(edge.conditional)
  // An edge is "live" while its source has finished and its target is next up.
  const active = statuses[edge.source] === 'done' && (statuses[edge.target] === 'running' || statuses[edge.target] === 'queued')
  return {
    id: `${edge.source}->${edge.target}#${index}`,
    source: edge.source,
    target: edge.target,
    label: typeof edge.data === 'string' && edge.data ? edge.data : undefined,
    type: 'smoothstep',
    animated: active,
    className: [conditional ? 'edge-conditional' : 'edge-plain', active ? 'edge-active' : '']
      .filter(Boolean)
      .join(' '),
    style: conditional ? { strokeDasharray: '6 4' } : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    data: { conditional },
  }
}
