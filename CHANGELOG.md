# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
