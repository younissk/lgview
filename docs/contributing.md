# Contributing

The full guide is in
[CONTRIBUTING.md](https://github.com/younissk/lgview/blob/main/CONTRIBUTING.md).
The short version:

## Setup

```bash
git clone https://github.com/younissk/lgview
cd lgview
npm install
```

You also need something to point it at. The repo ships one:

```bash
cd examples/demo-agent
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install "langgraph-cli[inmem]" -e .
langgraph dev
```

Then:

```bash
npm run dev
```

Vite serves the UI with hot reload and mounts the same reverse-proxy middleware
the shipped CLI uses, so development and production behave identically.

## The checks

```bash
npm run typecheck
npm test
npm run build
```

CI runs all three on Node 20, 22 and 24, then packs the tarball and runs the
installed binary.

## House rules

**Code is the source of truth; the canvas only ever reads it.** lgview does not
generate, rewrite, or round-trip user code, and it never will. If a proposal
requires parsing someone's Python to keep the canvas in sync, the answer is no —
that is the failure mode that killed every canvas-to-code tool before this one,
including LangChain's own. A stale canvas is acceptable; a canvas that lies is
not.

**Do not draw what the server cannot tell you.** A conditional edge is dashed
because the server reports `conditional: true` and nothing more. Showing the
*condition* would mean inventing information.

**Degrade, do not crash.** A LangGraph server may be older, newer, restarting or
gone. Unknown stream events get logged, not thrown. The last good drawing stays
on screen while the server is away.

## Tests

Add one when the behaviour could plausibly regress and a test can catch it
without a browser. `test/runReducer.test.mjs` is the model: its fixtures are
payloads captured from a real `langgraph-api` stream, not idealised shapes.

If you are testing something the server sends, capture the real thing:

```bash
TID=$(curl -s -X POST http://127.0.0.1:2024/threads \
  -H 'content-type: application/json' -d '{}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['thread_id'])")
curl -N -X POST "http://127.0.0.1:2024/threads/$TID/runs/stream" \
  -H 'content-type: application/json' \
  -d '{"assistant_id":"writer","input":{},"stream_mode":["values","updates","debug"]}'
```

A test that would still pass with the code deleted is worse than no test. If you
cannot name the mutation your test kills, it probably does not kill one.

## Where the interesting code is

| path | what |
| --- | --- |
| `cli/proxy.ts` | The reverse proxy. The security boundary — read closely. |
| `web/src/state/runReducer.ts` | Pure function from server events to UI state. Start here. |
| `web/src/lib/layout.ts` | Topology to positioned nodes, via dagre. |
| `web/src/state/use*.ts` | Polling, streaming and lifecycle. The least-tested part. |

## Where help is most wanted

- **Tests for the hooks.** Coverage sits around 30%, and the gap is exactly the
  polling, streaming and lifecycle logic most likely to regress.
- **End-to-end tests.** `examples/demo-agent` is deterministic enough to assert
  on exactly (`write_draft ×3`, `score 0.85`); nothing has been built on it yet.
- **Windows and Linux.** Everything so far was verified on macOS.
- **Screen reader testing.** The accessibility work is correct by construction
  and by DOM inspection — nobody has actually listened to it.

## Building these docs

```bash
pip install -r requirements-docs.txt
mkdocs serve
```
