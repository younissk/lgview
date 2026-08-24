# demo-agent

Two LangGraph graphs with no LLM calls and no API keys, used to develop and
test [lgview](../../README.md).

- **`writer`** — plan → draft → critique → (revise ↺ | finalize). A conditional
  router and a loop, so node status, iteration counts, and branch highlighting
  all have something to show. Each node sleeps a few hundred milliseconds so a
  run is watchable rather than instantaneous.
- **`approval`** — prepare → `interrupt()` → (execute | reject). Parks on a
  human decision, for testing interrupt rendering and resume.

## Running it

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install "langgraph-cli[inmem]" -e .
langgraph dev
```

Then, in another terminal, `npx lgview` (or `npm run dev` from the repo root).

Edit a node and save: `langgraph dev` hot-reloads, and the lgview canvas picks
up the new topology within a couple of seconds without a page refresh.
