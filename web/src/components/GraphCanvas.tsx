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
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphJson } from '../api/types'
import { layoutGraph, type GraphNodeData, type LayoutDirection, type NodeStatus } from '../lib/layout'
import { GraphNodeView, TerminalNodeView } from './GraphNodes'
import { Icon } from './Icon'

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
  const { fitView, zoomIn, zoomOut } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const updateNodeInternals = useUpdateNodeInternals()
  const needsFit = useRef(false)
  const wrapper = useRef<HTMLDivElement | null>(null)
  // Set once the user pans or zooms by hand, after which we stop re-framing
  // the graph for them.
  const userAdjusted = useRef(false)

  // Only the topology and the layout direction should trigger a re-layout, so
  // compare their shape rather than the object identity the poller hands us
  // every couple of seconds. Direction belongs in the key: leaving it out meant
  // toggling vertical/horizontal relabelled the button and changed nothing.
  const layoutKey = useMemo(
    () =>
      graph
        ? JSON.stringify([
            direction,
            graph.nodes.map((n) => n.id),
            graph.edges.map((e) => [e.source, e.target, Boolean(e.conditional), e.data ?? null]),
          ])
        : '',
    [graph, direction],
  )
  const lastLayout = useRef<string>('')

  useEffect(() => {
    if (!graph) {
      setNodes([])
      setEdges([])
      lastLayout.current = ''
      return
    }
    if (layoutKey === lastLayout.current) return
    lastLayout.current = layoutKey

    const layout = layoutGraph(graph, direction, statuses, runCounts, durations)
    setNodes(layout.nodes)
    setEdges(layout.edges)
    // A new topology or direction is a new picture; frame it even if the user
    // had panned the old one.
    userAdjusted.current = false
    // Framing has to wait until React Flow has measured the new nodes.
    needsFit.current = true
    // `statuses` is deliberately excluded here: it must not move anything.
  }, [layoutKey, direction, graph, setNodes, setEdges])

  /**
   * Re-frame when the canvas gets a size it did not have before.
   *
   * Two bugs share this cause. A graph mounted into a zero-sized container --
   * a hidden tab, a pane the window manager has not laid out yet -- computes a
   * fit against no space and silently keeps the identity transform. And
   * resizing the window afterwards never re-framed at all, so a graph that fit
   * a moment ago ends up half off-screen.
   */
  useEffect(() => {
    const element = wrapper.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let lastWidth = element.clientWidth
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth
      if (width === lastWidth || width === 0) return
      const wasUnusable = lastWidth === 0
      lastWidth = width
      if (wasUnusable || !userAdjusted.current) {
        needsFit.current = true
        fitView({ padding: 0.18, duration: wasUnusable ? 0 : 240 })
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fitView])

  useEffect(() => {
    if (!nodesInitialized || !needsFit.current) return
    needsFit.current = false
    // An edge renders as null until both of its endpoints report handle bounds.
    // After a topology swap the handles are new, so nudge React Flow to
    // re-measure them -- without this, edges could disappear from the DOM
    // entirely and never come back.
    for (const node of nodes) updateNodeInternals(node.id)
    // Re-measurement is asynchronous. Fitting in the same tick uses the
    // dimensions from *before* the nudge, which is how the graph ended up
    // framed against stale sizes and zoomed past 1:1.
    const handle = requestAnimationFrame(() => fitView({ padding: 0.18, duration: 280 }))
    return () => cancelAnimationFrame(handle)
  }, [nodesInitialized, nodes, fitView, updateNodeInternals])

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

  // Selection, not clicks. React Flow's keyboard handler updates the store
  // directly and never calls `onNodeClick`, so a keyboard user could focus and
  // select a node while the inspector stayed empty.
  const handleSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      const id = selected.length === 1 ? selected[0].id : null
      if (id !== selectedNode) onSelectNode(id)
    },
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
    <div className="canvas-surface" ref={wrapper}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onSelectionChange={handleSelectionChange}
      onMoveStart={(event) => {
        // Only a real gesture counts; programmatic fitView also fires this.
        if (event) userAdjusted.current = true
      }}
      nodesConnectable={false}
      nodesDraggable
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      minZoom={0.15}
      maxZoom={2.5}
      fitView
      aria-label="Graph topology. Use Tab to move between nodes and Enter to inspect one."
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="canvas-bg" />
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        nodeStrokeWidth={6}
        nodeClassName={(node) => `mini-${(node.data as GraphNodeData).status}`}
        maskColor="rgba(8, 10, 14, 0.72)"
        ariaLabel="Graph minimap"
      />
      {/* Hand-rolled rather than React Flow's <Controls>: those buttons ship
          without accessible names, and the fit-view one did not respond. */}
      <div className="canvas-controls">
        <button type="button" onClick={() => zoomIn({ duration: 160 })} aria-label="Zoom in" title="Zoom in">
          <Icon name="zoomIn" size={15} />
        </button>
        <button type="button" onClick={() => zoomOut({ duration: 160 })} aria-label="Zoom out" title="Zoom out">
          <Icon name="zoomOut" size={15} />
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.18, duration: 260 })}
          aria-label="Fit graph to view"
          title="Fit graph to view"
        >
          <Icon name="fit" size={15} />
        </button>
      </div>
    </ReactFlow>
    </div>
  )
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
