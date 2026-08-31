# How it works

```
browser ──► lgview (node)  ──►  LangGraph server
            static UI           /assistants, /threads, /runs/stream
            /__lg/* proxy
```

lgview is one Node process. It serves a bundled React single-page app from disk,
and reverse-proxies that app's API calls to whichever LangGraph server you
picked.

## Why there is a proxy

The browser never calls the LangGraph server directly. Every request goes through
`/__lg/*` on lgview's own origin, with the target server named in a request
header and any API key attached server-side.

This is **not** a workaround for CORS. `langgraph dev` is permissive and would
allow direct calls. The proxy exists for three other reasons:

1. **A deployed server behind a strict CORS policy works exactly like a local
   one.** One code path, not two.
2. **The API key is attached by the process, not by the page.** It never has to
   travel with every request the page makes, and it is pinned to the origin it
   was issued for.
3. **The Vite dev server and the shipped binary mount the same middleware.** What
   you test in development is what ships.

## The canvas

The server sends topology only — nodes and edges, no coordinates. Every layout
decision is lgview's:

- [dagre](https://github.com/dagrejs/dagre) computes a layered drawing, which
  suits graphs that are mostly a pipeline with a few loops back.
- Positions are recomputed **only** when the topology or the direction changes.
  Re-running the layout on every status update would make nodes jump around
  exactly while you are trying to watch them.
- Node status is patched in place during a run, so nothing moves.

## The run pipeline

```
POST /threads/{id}/runs/stream
  └─ server-sent events
       └─ SseDecoder          decodes the wire format
            └─ runReducer     folds events into UI state
                 └─ React     one commit per animation frame
```

`web/src/state/runReducer.ts` is the interesting file: a pure function from
LangGraph's events to everything drawn on screen. Because it is pure, most
behaviour questions can be answered — and most bugs reproduced — without a
browser, and its tests run against payloads captured from a real server rather
than payloads someone imagined.

Two details that exist for a reason:

- **Events are coalesced per frame.** Dispatching one React update per
  server-sent event cost about 23ms of commit each, which at streaming speed
  saturated the main thread and made the Cancel button feel dead.
- **Old event payloads are released.** LangGraph re-sends the entire graph state
  each superstep; retaining all of it pinned hundreds of megabytes over a long
  run.

## Hot reload

lgview polls the graph topology and the assistant list. When `langgraph dev`
reloads after you save a file, the fingerprint changes, the canvas re-lays out,
and a "reloaded" pill appears briefly. Polling is also what makes lgview survive
the server restarting: a one-shot fetch that failed while it was down would leave
the picker permanently empty.

## What is not stored

lgview keeps no database and no files. Threads, checkpoints and state all live in
your LangGraph server. The only client-side state is:

| where | what |
| --- | --- |
| `localStorage` | Your server list, panel widths, layout direction |
| `sessionStorage` | API keys, for the life of the tab |

Stopping lgview loses nothing.
