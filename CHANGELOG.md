# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- The proxy now checks `Sec-Fetch-Site`. Checking `Origin` alone let any website
  the user visited drive authenticated GETs at their configured LangGraph server
  — browsers omit `Origin` on `<img>`, `<script>` and `no-cors` GETs — which was
  enough to read every thread and checkpoint, with the API key attached.
- API keys are pinned to the origin they were configured for, and are never sent
  over plaintext `http` to a non-loopback host. Previously a key went to
  whatever upstream a request named, so one mistyped URL leaked it.
- API keys moved from `localStorage` to `sessionStorage`, and any key written to
  disk by 0.1.0 is deleted on first load.
- `x-lgview-upstream` is now mandatory; the server-side fallback that made it
  optional has been removed.
- Responses carry `nosniff`, the page cannot be framed, and upstream
  `Set-Cookie` is no longer relayed onto `127.0.0.1`.
- Upstream redirects are rewritten back through the proxy, or refused if they
  leave the upstream's origin.
- Fixed a path-traversal hole: a sibling directory sharing the web root's name
  prefix was readable.

### Removed

- **`--host`.** It was documented but broken — the UI loaded over the network
  while every proxy call was rejected. Making it work would have turned lgview
  into an unauthenticated relay carrying the user's API key. The bind is now
  unconditionally `127.0.0.1`.

### Fixed

- A crashed run reported success with the failed node coloured green.
- Cancelling a run painted the interrupted node as completed, and never
  reliably told the server to stop.
- The first run of every session reset itself mid-flight, so History stayed
  empty and a second click started a duplicate run.
- The **Run** button restarted a graph parked on an interrupt instead of
  resuming it. It is now disabled while parked.
- The vertical/horizontal toggle relabelled itself without re-laying out.
- **Fit view** did nothing, and the graph never re-framed on resize.
- Keyboard users could select a node without the inspector responding.
- Deleting a thread now asks first.
- Thread errors are shown instead of silently discarded, and a thread that
  fails to load no longer leaves the previous thread's state on screen.
- Resuming an interrupt no longer blanks the canvas.

### Performance

- The SSE decoder was quadratic; a 20 MB state froze the tab for ~15 s per
  superstep. Now linear — 103 ms for the same payload.
- The event log pinned unbounded memory (~772 MB over a long run). Payloads are
  released beyond the newest 25 entries.
- Events are coalesced into one render per frame instead of one per event.

### Accessibility

- Visible focus indicators, live-region announcements for run status, a focus
  trap in the servers dialog, accessible names on graph nodes, and node status
  carried by glyph as well as colour. Raised `--text-faint` to pass contrast.

### Changed

- Tests moved to Vitest. The previous suite could not run on Node 20 at all.
- `THIRD-PARTY-NOTICES.md` is generated during the build and shipped, as the
  bundled dependencies' licences require.
- The published tarball no longer contains a source map: 540 kB → 154 kB.

## [0.1.0] — 2026-08-25

First release. A local web UI for any LangGraph server: point it at
`langgraph dev` and it draws the graph, streams runs node by node, shows state
and checkpoints, and answers interrupts. No login, no account, no Docker.

### Added

- **Graph canvas** — topology read from `/assistants/{id}/graph`, laid out with
  dagre. Conditional edges are dashed; `__start__` and `__end__` render as
  pills.
- **Live run view** — nodes light up as they execute, with per-node durations
  and an iteration count for loops, driven by the `debug` stream mode.
- **State inspector** — the full state after each step as a collapsible tree.
  Selecting a node shows what that node last returned.
- **Interrupts** — a graph that calls `interrupt()` surfaces its question with
  its options as buttons; answering resumes the run in place.
- **Time travel** — every checkpoint is listed with its step and pending nodes;
  "resume from here" forks the thread from that point.
- **Threads** — create, switch, inspect, and delete.
- **Event log** — every server-sent event, decoded and timestamped.
- **Multi-server support** — add, switch between, and forget servers from the
  UI, with an optional API key per server. Works with `langgraph dev`, a
  self-hosted deployment, or a LangGraph Platform URL.
- **Hot reload** — topology and the graph list are polled, so a `langgraph dev`
  reload appears on the canvas without a page refresh.
- **Reverse proxy** (`/__lg/*`) so the browser never contacts the LangGraph
  server directly: CORS stops mattering, API keys are attached server-side, and
  the Vite dev server and the shipped binary run the same middleware. Guarded
  by a loopback `Host` check and a same-`Origin` check.
- **Zero runtime dependencies** — the published package is entirely bundled.

### Known

- The canvas is read-only with respect to your code, by design. lgview never
  generates or rewrites Python.
- Conditional edges carry no branch label, because the server does not send
  one. The canvas shows *that* a router fans out, never *why*.
- Subgraphs are not yet drilled into, and state cannot be edited before
  forking a checkpoint.

[Unreleased]: https://github.com/younissk/lgview/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/younissk/lgview/releases/tag/v0.1.0
