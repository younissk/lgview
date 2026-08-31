# Getting started

## Requirements

- **Node 20 or newer.** Nothing else — the published package is pre-bundled
  JavaScript with no runtime dependencies.
- **A LangGraph server** to look at. A local `langgraph dev` is the usual case;
  a self-hosted deployment or a LangGraph Platform URL works too.

## Run it

You do not need to install anything permanently:

```bash
npx lgview
```

That starts lgview on `http://127.0.0.1:4141`, connects to a LangGraph server on
`http://127.0.0.1:2024`, and opens a browser.

If you would rather have it on your PATH:

```bash
npm install -g lgview
lgview
```

## Point it at your own agent

In your LangGraph project — the one with a `langgraph.json` — start the dev
server:

```bash
langgraph dev
```

Then, in another terminal:

```bash
npx lgview
```

lgview lists every graph in your `langgraph.json` in the **graph** picker. Pick
one and it appears on the canvas.

If your server is somewhere else:

```bash
npx lgview --server http://localhost:8123
```

You can also add and switch servers from inside the UI — see
[Connecting to a server](guide/connecting.md).

## Try it without an agent of your own

The repository ships a demo project with two graphs that call no LLM, so they
need no API keys and run identically every time. It is what lgview was built
and tested against.

```bash
git clone https://github.com/younissk/lgview
cd lgview/examples/demo-agent
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install "langgraph-cli[inmem]" -e .
langgraph dev
```

You get two graphs:

| graph | what it does | what it demonstrates |
| --- | --- | --- |
| `writer` | plan → draft → critique → (revise ↺ \| finalize) | A conditional router and a loop. Nodes sleep a few hundred ms each, so a run takes about four seconds and is actually watchable. |
| `approval` | prepare → `interrupt()` → (execute \| reject) | Parks on a human decision. |

Then `npx lgview` in another terminal.

!!! tip "Watch a hot reload"

    With both running, open `examples/demo-agent/src/demo_agent/writer.py`, add
    a node, and save. `langgraph dev` reloads, and the lgview canvas picks up the
    new topology within a couple of seconds — no page refresh.

## First run

1. Pick a graph in the top bar.
2. Type an input, or leave `{}` — most graphs supply their own defaults. The
   chips under the box are the fields the graph's input schema declares; click
   one to insert it.
3. Press **Run** (or ++cmd+enter++ / ++ctrl+enter++).

Nodes light up as they execute. The **state** tab on the right fills in as the
graph produces values, and **events** shows every frame the server sent.

## Stopping it

++ctrl+c++ in the terminal. lgview holds no state of its own — everything lives
in your LangGraph server — so stopping and restarting loses nothing.
