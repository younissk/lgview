/**
 * The canvas. Topology comes from the server; layout is ours.
 *
 * Positions are computed once per topology change, never per status change --
 * re-running dagre while a graph executes would make the nodes jump around
 * exactly when you are trying to watch them.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphJson } from '../api/types'
import { layoutGraph, type GraphNodeData, type LayoutDirection, type NodeStatus } from '../lib/layout'
import { GraphNodeView, TerminalNodeView } from './GraphNodes'

const nodeTypes = { graphNode: GraphNodeView, terminal: TerminalNodeView }

export interface GraphCanvasProps {
  graph: GraphJson | null
  statuses: Record<string, NodeStatus>
  runCounts: Record<string, number>
  durations: Record<string, number>
  direction: LayoutDirection
  selectedNode: string | null
  onSelectNode: (id: string | null) => void
}

function Canvas({
  graph,
  statuses,
  runCounts,
  durations,
  direction,
  selectedNode,
  onSelectNode,
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const needsFit = useRef(false)

  // Only the topology should trigger a re-layout, so compare its shape rather
  // than the object identity the poller hands us every couple of seconds.
  const topologyKey = useMemo(
    () =>
      graph
        ? JSON.stringify([
            graph.nodes.map((n) => n.id),
            graph.edges.map((e) => [e.source, e.target, Boolean(e.conditional), e.data ?? null]),
          ])
        : '',
    [graph],
  )
  const lastTopology = useRef<string>('')

  useEffect(() => {
    if (!graph) {
      setNodes([])
      setEdges([])
      lastTopology.current = ''
      return
    }
    if (topologyKey === lastTopology.current) return
    lastTopology.current = topologyKey

    const layout = layoutGraph(graph, direction, statuses, runCounts, durations)
    setNodes(layout.nodes)
    setEdges(layout.edges)
    // Framing has to wait until React Flow has measured the new nodes.
    needsFit.current = true
    // `statuses` is deliberately excluded here: it must not move anything.
  }, [topologyKey, direction, graph, setNodes, setEdges])

  useEffect(() => {
    if (!nodesInitialized || !needsFit.current) return
    needsFit.current = false
    fitView({ padding: 0.18, duration: 280 })
  }, [nodesInitialized, nodes, fitView])

  // Status arrives many times a second during a run; patch data in place.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const status = statuses[node.id] ?? 'idle'
        const runs = runCounts[node.id] ?? 0
        const durationMs = durations[node.id]
        if (node.data.status === status && node.data.runs === runs && node.data.durationMs === durationMs) {
          return node
        }
        return { ...node, data: { ...node.data, status, runs, durationMs } }
      }),
    )
    setEdges((current) =>
      current.map((edge) => {
        const active =
          statuses[edge.source] === 'done' &&
          (statuses[edge.target] === 'running' || statuses[edge.target] === 'queued')
        if (edge.animated === active) return edge
        const base = edge.className?.replace(/\s*edge-active/, '') ?? ''
        return { ...edge, animated: active, className: active ? `${base} edge-active` : base }
      }),
    )
  }, [statuses, runCounts, durations, setNodes, setEdges])

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => onSelectNode(node.id === selectedNode ? null : node.id),
    [onSelectNode, selectedNode],
  )

  if (!graph) {
    return (
      <div className="canvas-empty">
        <p>No graph loaded.</p>
        <p className="muted">Pick a server and a graph, or start one with <code>langgraph dev</code>.</p>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelectNode(null)}
      nodesConnectable={false}
      nodesDraggable
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      minZoom={0.15}
      maxZoom={2.5}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="canvas-bg" />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        nodeStrokeWidth={6}
        nodeClassName={(node) => `mini-${(node.data as GraphNodeData).status}`}
        maskColor="rgba(8, 10, 14, 0.72)"
      />
    </ReactFlow>
  )
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
