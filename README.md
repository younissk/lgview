# lgview

A fast, local, open-source web UI for any LangGraph server.

Point it at `langgraph dev` and you get your graph on a canvas, its state as it
changes, and every run streamed node by node. No login, no account, no Docker,
nothing leaves your machine.

```bash
langgraph dev          # in your agent project
npx lgview             # in another terminal
```

That's it. `lgview` finds the server on `http://127.0.0.1:2024`, lists the
graphs it exposes, and opens a browser.

## Why

LangGraph Studio is good, and it is also a hosted product: it wants a LangSmith
login even to look at a graph running on your own laptop. `lgview` is the small
local alternative — one npm package, one command, no account.

It reads. It does not author. Your code stays the source of truth: `lgview`
never writes a line of it, and when you save a file and `langgraph dev`
hot-reloads, the canvas follows within a couple of seconds.

## What you get

- **The graph, laid out.** Nodes and edges straight from the server, arranged
  with dagre. Conditional edges are dashed, because the canvas can honestly
  show you *that* a router fans out to three places but never *why* — that
  lives in your Python.
- **Runs you can watch.** Every node lights up as it executes and reports how
  long it took. Loops count their iterations (`write_draft ×3`).
- **State, live.** The full state after each step, as a collapsible tree. Click
  a node to see exactly what it returned.
- **Interrupts, answered in place.** When a graph calls `interrupt()`, the
  question appears with its options as buttons. Answer it and the run resumes.
- **Time travel.** Every checkpoint is listed with its step number and what was
  going to run next. "Resume from here" forks the thread from that point.
- **Threads.** Create, switch, inspect, delete.
- **An event log.** Every SSE frame the server sent, decoded and timestamped.

## Usage

```
npx lgview [options]

  -s, --server <url>   LangGraph server to connect to  (default http://127.0.0.1:2024)
  -p, --port <n>       Port to serve the UI on         (default 4141)
      --host <host>    Interface to bind               (default 127.0.0.1)
      --api-key <key>  Sent upstream as x-api-key, for deployed servers
      --no-open        Do not open a browser
  -v, --version        Print version
  -h, --help           Show this help
```

You can also add servers from inside the UI (**manage**), and switch between
them without restarting. Anything that speaks the LangGraph server API works:
`langgraph dev`, a self-hosted deployment, or a LangGraph Platform URL.

### Installing it properly

```bash
npm install -g lgview
lgview
```

## How it fits together

```
browser ──► lgview (node)  ──►  LangGraph server
            static UI           /assistants, /threads, /runs/stream
            /__lg/* proxy
```

The browser never calls the LangGraph server directly. Every request goes
through `/__lg/*` on lgview's own origin, with the target server named in a
request header and the API key attached server-side.

That is not a workaround for local CORS — `langgraph dev` is permissive. It is
so that a deployed server behind a strict CORS policy works exactly like a
local one, so API keys never have to live in browser storage, and so the dev
server and the shipped binary run the same code path. The proxy refuses any
request whose `Host` is not loopback or whose `Origin` is not its own, so a
page you happen to have open elsewhere cannot use it to reach your network.

## What it deliberately does not do

- **Author graphs.** Code is the source of truth. LangChain's own
  canvas-to-code tool, LangGraph Builder, was archived in February 2026; the
  round trip between a canvas and real Python is where these tools go to die.
  If the canvas and your code disagree, the canvas is stale — that's the whole
  contract.
- **Show routing conditions.** A conditional edge is drawn dashed. The
  predicate that chooses the branch is arbitrary Python and is not something
  the server serializes, so pretending otherwise would be a lie.
- **Replace LangSmith.** No tracing, no evals, no datasets.

## Development

```bash
npm install
npm run dev        # Vite dev server on :5173, same proxy as production
npm test           # SSE decoding, run-event reduction, proxy guards
npm run typecheck
npm run build      # dist/web + dist/cli.js
```

`LGVIEW_SERVER=http://localhost:8123 npm run dev` points the dev server
somewhere other than the default.

There is a demo agent in [`examples/demo-agent`](examples/demo-agent) with two
graphs — a draft/critique/revise loop and a human-in-the-loop approval flow.
Neither calls an LLM, so they run with no API keys and are the fixture the UI
was built against.

### Layout

| path | what |
|---|---|
| `cli/` | the node server: static hosting, reverse proxy, argument parsing |
| `web/src/api/` | typed client for the LangGraph server API, plus an SSE decoder |
| `web/src/state/` | server list, graph discovery, threads, and the run reducer |
| `web/src/lib/layout.ts` | topology to positioned React Flow nodes, via dagre |
| `web/src/components/` | canvas, inspector, run panel |
| `examples/demo-agent/` | offline LangGraph graphs to develop against |

The interesting file is `web/src/state/runReducer.ts`: a pure function from
LangGraph's SSE events to everything drawn on screen. It is tested against
payloads recorded from a real `langgraph-api` stream.

## Compatibility

Built and verified against `langgraph-api 0.13.0` / `langgraph 1.2.11`. It uses
only the stable parts of the server API — `/assistants`, `/threads`, `/runs` —
and treats unknown stream events as loggable rather than fatal, so a server
upgrade should degrade gracefully rather than break.

## Roadmap

- Editing state at a checkpoint before forking
- Subgraph drill-down (`?xray=1` is already fetched but not yet rendered)
- `pipx`/Homebrew distribution alongside npm
- Click a node to open its source in your editor

## License

MIT
