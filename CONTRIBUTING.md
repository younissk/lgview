# Contributing to lgview

Thanks for looking. lgview is small on purpose, so almost any change is
tractable in an afternoon.

## Getting set up

You need **Node 20 or newer**, and Python 3.10+ if you want to run the demo
agent.

```bash
git clone https://github.com/younissk/lgview
cd lgview
npm install
```

You also want something to point lgview at. The repo ships one:

```bash
cd examples/demo-agent
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install "langgraph-cli[inmem]" -e .
langgraph dev
```

That gives you two graphs on `http://127.0.0.1:2024` — `writer` (a loop with a
conditional router) and `approval` (a human-in-the-loop interrupt). Neither
calls an LLM, so no API keys, and both are deterministic, which is what makes
them usable as test fixtures.

Then, in another terminal:

```bash
npm run dev
```

Vite serves the UI on `http://localhost:5173` with hot reload, and mounts the
same reverse-proxy middleware the shipped CLI uses — so dev and production
behave identically. Point it elsewhere with `LGVIEW_SERVER=http://host:port npm run dev`.

## The checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit + integration
npm run build       # dist/web + dist/cli.js
```

CI runs all three on Node 20, 22 and 24, then packs the tarball and runs the
installed binary. A change is ready when those pass.

Tests run on Vitest. `test/` holds unit and integration tests for the CLI and
the API layer; component tests live next to the component, as
`Thing.test.tsx`.

## How the pieces fit

```
cli/          the Node server: static hosting, reverse proxy, argument parsing
web/src/api/  typed client for the LangGraph server API, plus an SSE decoder
web/src/state/  server list, graph discovery, threads, and the run reducer
web/src/lib/  dagre layout, JSON-schema helpers, formatting
web/src/components/  canvas, inspector, run panel
examples/demo-agent/  offline LangGraph graphs to develop against
```

The file worth reading first is `web/src/state/runReducer.ts`. It is a pure
function from LangGraph's server-sent events to everything drawn on screen,
which means most behaviour questions can be answered — and most bugs
reproduced — without a browser.

## House rules

**Code is the source of truth; the canvas only ever reads it.** lgview does not
generate, rewrite, or round-trip user code, and it never will. If a proposal
requires parsing someone's Python to keep the canvas in sync, the answer is no —
that is the failure mode that killed every canvas-to-code tool before this one,
including LangChain's own. A stale canvas is an acceptable outcome; a canvas
that lies is not.

**Do not draw what the server cannot tell you.** A conditional edge is dashed
because the server reports `conditional: true` and nothing more. Showing the
*condition* would require inventing information. Same for `Send` fan-out and
`Command(goto=...)`.

**Degrade, do not crash.** A LangGraph server may be older, newer, restarting,
or gone. Unknown stream events get logged, not thrown. Unknown fields are
ignored. The last good drawing stays on screen while the server is away.

## Tests

Add one when the behaviour could plausibly regress and a test can catch it
without a browser — reducer logic, the SSE decoder, proxy guards, path
handling, layout. `test/runReducer.test.mjs` is the model: its fixtures are
payloads captured from a real `langgraph-api` stream, not idealised shapes.

If you are adding a test for something the server sends, capture the real thing
rather than writing what you expect:

```bash
TID=$(curl -s -X POST http://127.0.0.1:2024/threads -H 'content-type: application/json' -d '{}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['thread_id'])")
curl -N -X POST "http://127.0.0.1:2024/threads/$TID/runs/stream" \
  -H 'content-type: application/json' \
  -d '{"assistant_id":"writer","input":{},"stream_mode":["values","updates","debug"]}'
```

A test that would still pass with the code deleted is worse than no test. If
you cannot think of the mutation your test kills, it probably does not kill
one.

## Style

There is no linter yet. Match the file you are in: no semicolons, single
quotes, two-space indent, and comments that say *why* rather than restating the
code. `.editorconfig` covers whitespace.

## Pull requests

Small and single-purpose. Say what breaks without the change. If it touches the
UI, a screenshot saves a round trip. If it touches the proxy, say what you
probed and what came back — that code is the security boundary and gets read
closely.

Never commit a repo-wide reformat inside a feature change; it makes the real
diff unreviewable.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
