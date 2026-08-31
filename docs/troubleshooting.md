# Troubleshooting

## "Cannot reach http://127.0.0.1:2024"

The banner names the real reason. The common ones:

| message | what it means |
| --- | --- |
| `nothing is listening on <url>` | The server is not running. Start `langgraph dev`. |
| `could not resolve <host>` | The hostname is wrong, or DNS cannot see it. |
| `timed out connecting to <url>` | Something is there but not answering — a firewall, or the wrong port. |
| `the TLS certificate for <url> was rejected` | Self-signed or expired certificate on a deployed server. |

lgview keeps polling, so once the server is back the banner clears on its own.
No refresh needed.

## The graph list is empty

- Check the server is actually serving graphs:
  `curl -s -X POST http://127.0.0.1:2024/assistants/search -H 'content-type: application/json' -d '{}'`
- If that returns `[]`, the problem is your `langgraph.json` — `langgraph dev`
  starts happily with no graphs in it.
- If it returns graphs but lgview shows none, that is a bug worth
  [an issue](https://github.com/younissk/lgview/issues).

## The port is already in use

```
lgview: port 4141 is already in use. Try `lgview --port 4142`.
```

Exactly that. lgview exits rather than hanging.

## `npx lgview` runs an old version

npx caches. Force the latest:

```bash
npx lgview@latest
```

## The graph is off-screen or too small

Press the fit button, bottom right of the canvas. The graph re-frames itself
automatically when the topology changes or the window resizes, but not after you
have panned or zoomed by hand — at that point it assumes you meant it.

## Nothing happens when I press Run

Two likely causes:

- **The thread is parked on an interrupt.** Run is disabled and says so; answer
  the interrupt instead. See [Interrupts](guide/interrupts.md).
- **The input is not valid JSON.** The box outlines red and the error appears
  under it.

## A run says "error" and I want the traceback

lgview shows the exception type and message the server sent. The full traceback
is in the terminal running `langgraph dev` — the server does not stream it.

## Deleting a thread did not ask twice

It does: the first click arms the control and it becomes **delete?**. The
confirmation disarms itself after a few seconds if you do not follow through.

## The page is blank after an upgrade

Most likely stored state in a shape the new version does not expect. Clear it:

```js
// In the browser console
localStorage.clear(); sessionStorage.clear(); location.reload()
```

You lose your server list and panel widths, nothing else. If this happens,
please [report it](https://github.com/younissk/lgview/issues) — lgview validates
stored data on read specifically so this should not occur.

## Something else

The four things that make a report actionable:

1. `lgview --version`
2. The `version` from `curl -s <your-server>/info`
3. Whether you are on local `langgraph dev`, self-hosted, or Platform
4. Anything in the browser console or the lgview terminal

The [bug report form](https://github.com/younissk/lgview/issues/new?template=bug_report.yml)
asks for exactly these.
