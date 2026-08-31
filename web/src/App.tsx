import { useCallback, useEffect, useRef, useState } from 'react'
import { GraphCanvas } from './components/GraphCanvas'
import { Inspector } from './components/Inspector'
import { Resizer } from './components/Resizer'
import { RunPanel } from './components/RunPanel'
import { RunStatusAnnouncer } from './components/RunStatusAnnouncer'
import { ServerDialog } from './components/ServerDialog'
import { ThreadList } from './components/ThreadList'
import { TopBar } from './components/TopBar'
import type { LayoutDirection } from './lib/layout'
import { useAssistants } from './state/useAssistants'
import { useLocalStorage } from './state/useLocalStorage'
import { useMediaQuery } from './state/useMediaQuery'
import { useRunner } from './state/useRunner'
import { useServers } from './state/useServers'
import { useThreads } from './state/useThreads'

const SIDEBAR = { min: 220, max: 460, default: 292 }
const INSPECTOR = { min: 260, max: 620, default: 384 }

/** Below this the three columns stop fitting, and the side panels become drawers. */
const COMPACT_QUERY = '(max-width: 1023px)'

export default function App() {
  const servers = useServers()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [direction, setDirection] = useLocalStorage<LayoutDirection>('lgview.direction.v1', 'TB')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [reloadNotice, setReloadNotice] = useState(false)

  const [sidebarWidth, setSidebarWidth] = useLocalStorage('lgview.sidebarWidth.v1', SIDEBAR.default)
  const [inspectorWidth, setInspectorWidth] = useLocalStorage('lgview.inspectorWidth.v1', INSPECTOR.default)
  const compact = useMediaQuery(COMPACT_QUERY)
  /** Which drawer is open. Only meaningful while compact. */
  const [drawer, setDrawer] = useState<'run' | 'inspect' | null>(null)

  const assistants = useAssistants(servers.connection)
  const graphId = assistants.selected?.graph_id ?? null
  const threads = useThreads(servers.connection, graphId)

  const onSettled = useCallback(() => {
    void threads.reloadState()
    threads.refreshThreads()
  }, [threads.reloadState, threads.refreshThreads])

  const runner = useRunner(
    servers.connection,
    assistants.selected?.assistant_id ?? null,
    threads.threadId,
    onSettled,
  )

  // Switching graphs or threads starts a clean slate on the canvas.
  const lastThread = useRef<string | null>(null)
  useEffect(() => {
    if (lastThread.current === threads.threadId) return
    lastThread.current = threads.threadId
    runner.reset()
    setSelectedNode(null)
  }, [threads.threadId, runner.reset])

  // Show a persisted thread's state before it has been run in this session.
  // Once a run has produced events, those win -- otherwise refreshing the
  // thread after a run would wipe the colours you just watched appear.
  const hasLiveRun = runner.run.log.length > 0
  useEffect(() => {
    if (hasLiveRun || runner.isActive || !threads.state) return
    runner.hydrate(
      threads.state.values ?? null,
      threads.state.interrupts?.[0] ?? null,
      threads.state.next ?? [],
      threads.nodesThatRan,
    )
  }, [threads.state, threads.nodesThatRan, hasLiveRun, runner.isActive, runner.hydrate])

  useEffect(() => {
    if (assistants.reloadCount === 0) return
    setReloadNotice(true)
    const timer = window.setTimeout(() => setReloadNotice(false), 4000)
    return () => window.clearTimeout(timer)
  }, [assistants.reloadCount])

  // A drawer is a compact-mode idea; leaving one "open" while the window grows
  // would strand it as an overlay on a layout that already has room for it.
  useEffect(() => {
    if (!compact) setDrawer(null)
  }, [compact])

  useEffect(() => {
    if (!drawer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const handleRun = useCallback(
    async (input: Record<string, unknown> | null) => {
      const threadId = threads.threadId ?? (await threads.createThread({ graph_id: graphId ?? undefined }))
      if (!threadId) return
      // Claim the thread before starting, so the clean-slate effect above does
      // not reset the run we are about to launch.
      lastThread.current = threadId
      if (compact) setDrawer(null)
      await runner.start({ input, threadId })
    },
    [threads.threadId, threads.createThread, graphId, runner.start, compact],
  )

  const handleFork = useCallback(
    (checkpointId: string) => {
      if (compact) setDrawer(null)
      void runner.start({ input: null, checkpointId })
    },
    [runner.start, compact],
  )

  // Cmd/Ctrl+Enter runs, from anywhere -- except while the graph is parked on
  // an interrupt, where "run" would restart it from START rather than resume.
  const parked = Boolean(runner.run.interrupt) && !runner.isActive
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !runner.isActive && !parked) {
        document.querySelector<HTMLButtonElement>('.run-actions .btn-primary')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runner.isActive, parked])

  const offline = servers.status === 'offline'

  const layoutStyle = compact
    ? undefined
    : {
        gridTemplateColumns: `${sidebarWidth}px var(--resizer-w) minmax(0, 1fr) var(--resizer-w) ${inspectorWidth}px`,
      }

  return (
    <div className="app" data-compact={compact ? 'true' : undefined}>
      <TopBar
        servers={servers.servers}
        activeId={servers.activeId}
        status={servers.status}
        info={servers.info}
        assistants={assistants.assistants}
        selectedAssistantId={assistants.selected?.assistant_id ?? null}
        direction={direction}
        reloadNotice={reloadNotice}
        compact={compact}
        openDrawer={drawer}
        onToggleDrawer={(which) => setDrawer((prev) => (prev === which ? null : which))}
        onSelectServer={servers.selectServer}
        onSelectAssistant={assistants.select}
        onManageServers={() => setDialogOpen(true)}
        onToggleDirection={() => setDirection(direction === 'TB' ? 'LR' : 'TB')}
      />

      {offline && (
        <div className="banner banner-error">
          <span>
            Cannot reach <code>{servers.active?.url}</code>. {servers.error}
          </span>
          <span className="muted">
            Start one with <code>langgraph dev</code>, or add a different server.
          </span>
        </div>
      )}
      {!servers.active && servers.bootstrapped && (
        <div className="banner">
          <span>No server selected.</span>
          <button type="button" className="link-btn" onClick={() => setDialogOpen(true)}>
            add one
          </button>
        </div>
      )}

      <RunStatusAnnouncer run={runner.run} />

      <main className="layout" style={layoutStyle}>
        <div className={`sidebar${drawer === 'run' ? ' is-open' : ''}`} aria-hidden={compact && drawer !== 'run'}>
          <RunPanel
            schemas={assistants.schemas}
            run={runner.run}
            isActive={runner.isActive}
            hasThread={Boolean(threads.threadId)}
            parked={parked}
            disabled={!assistants.selected || offline}
            onRun={(input) => void handleRun(input)}
            onResume={(value) => void runner.resume(value)}
            onCancel={() => void runner.cancel()}
            onNewThread={() => void threads.createThread({ graph_id: graphId ?? undefined })}
          />
          <ThreadList
            threads={threads.threads}
            activeId={threads.threadId}
            onSelect={(id) => {
              threads.selectThread(id)
              if (compact) setDrawer(null)
            }}
            onDelete={(id) => void threads.deleteThread(id)}
            error={threads.error}
            hasMore={threads.hasMoreThreads}
            loadingMore={threads.loadingMore}
            onLoadMore={() => void threads.loadMoreThreads()}
            onRefresh={threads.refreshThreads}
          />
        </div>

        {!compact && (
          <Resizer
            label="Run panel"
            width={sidebarWidth}
            min={SIDEBAR.min}
            max={SIDEBAR.max}
            direction={1}
            onResize={setSidebarWidth}
            onReset={() => setSidebarWidth(SIDEBAR.default)}
          />
        )}

        <div className="canvas">
          {assistants.error && !assistants.graph ? (
            <div className="canvas-empty">
              <p>Could not load the graph.</p>
              <p className="muted">{assistants.error}</p>
            </div>
          ) : (
            <GraphCanvas
              graph={assistants.graph}
              statuses={runner.run.statuses}
              runCounts={runner.run.runCounts}
              durations={runner.run.durations}
              direction={direction}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
            />
          )}
        </div>

        {!compact && (
          <Resizer
            label="Inspector"
            width={inspectorWidth}
            min={INSPECTOR.min}
            max={INSPECTOR.max}
            direction={-1}
            onResize={setInspectorWidth}
            onReset={() => setInspectorWidth(INSPECTOR.default)}
          />
        )}

        <div
          className={`inspector-slot${drawer === 'inspect' ? ' is-open' : ''}`}
          aria-hidden={compact && drawer !== 'inspect'}
        >
          <Inspector
            run={runner.run}
            threadState={threads.state}
            history={threads.history}
            schemas={assistants.schemas}
            selectedNode={selectedNode}
            activeCheckpointId={threads.state?.checkpoint_id ?? null}
            canFork={Boolean(threads.threadId) && !runner.isActive}
            historyTruncated={threads.historyTruncated}
            onForkFrom={handleFork}
          />
        </div>

        {compact && drawer && <div className="drawer-backdrop" onClick={() => setDrawer(null)} />}
      </main>

      <ServerDialog
        open={dialogOpen}
        servers={servers.servers}
        activeId={servers.activeId}
        onClose={() => setDialogOpen(false)}
        onAdd={(url, apiKey) => servers.addServer(url, apiKey)}
        onRemove={servers.removeServer}
        onSelect={servers.selectServer}
      />
    </div>
  )
}
