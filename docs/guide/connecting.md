# Connecting to a server

lgview talks to anything that speaks the LangGraph server API: a local
`langgraph dev`, a self-hosted deployment, or a LangGraph Platform URL.

## The default

With no flags, lgview connects to `http://127.0.0.1:2024` — where `langgraph dev`
listens. Override it at startup:

```bash
npx lgview --server https://my-deployment.example.com
```

A URL without a scheme is assumed to be `http`, so `--server localhost:8123`
works.

## Adding servers from the UI

Click the settings icon beside the **server** picker. From there you can add a
server, switch to one, or forget one. The list is remembered in `localStorage`,
so it survives a restart.

Switching servers clears the graph list, the thread list and the canvas — the
previous server's graphs do not exist on the new one, and showing them would
invite you to click something that cannot work.

## API keys

A deployed server usually wants an API key. Two ways to supply one:

=== "In the UI"

    Add the server with its key in the **manage servers** dialog. This is the
    better option.

=== "On the command line"

    ```bash
    npx lgview --server https://my-deployment.example.com --api-key sk-...
    ```

    Convenient, but the key ends up in your shell history and is visible in
    `ps` output to anyone else on the machine.

The key is attached by the lgview process, server-side, as `x-api-key`. It is
kept in `sessionStorage` — for the life of the browser tab — and is never
written to disk.

!!! warning "A key is only ever sent to the server it belongs to"

    lgview pins each key to the exact origin it was configured for, and refuses
    to send any key over plaintext `http` to a non-loopback host. This matters:
    a LangGraph Platform key unlocks every thread in a tenant, and without that
    pinning a single mistyped URL in the manage-servers box would hand it to a
    stranger.

## Servers behind a base path

A server mounted at `https://example.com/api` works — lgview preserves the base
path when it forwards. Give the full base:

```bash
npx lgview --server https://example.com/api
```

## When the server goes away

`langgraph dev` gets restarted constantly, so lgview is built for it:

- The status pill in the top bar turns red and the banner names the actual
  reason — `nothing is listening on http://127.0.0.1:2024`, not "fetch failed".
- The **last good graph stays on screen**. Blanking the canvas because of a
  two-second blip is worse than showing something slightly stale.
- lgview keeps polling. When the server comes back, everything reconnects on its
  own — no page refresh.

## Connecting to more than one

Add as many servers as you like and switch between them in the top bar. Each
keeps its own API key. There is no cross-server state: threads, graphs and
checkpoints all belong to the server you are currently pointed at.
