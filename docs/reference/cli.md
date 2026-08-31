# CLI

```
npx lgview [options]
```

| flag | default | what it does |
| --- | --- | --- |
| `-s`, `--server <url>` | `http://127.0.0.1:2024` | The LangGraph server to connect to. A URL with no scheme is treated as `http`. |
| `-p`, `--port <n>` | `4141` | Port to serve the UI on. |
| `--api-key <key>` | — | Sent upstream as `x-api-key`, for deployed servers. |
| `--no-open` | — | Do not open a browser. |
| `-v`, `--version` | — | Print the version and exit. |
| `-h`, `--help` | — | Print usage and exit. |

## Examples

```bash
# The common case
npx lgview

# A server somewhere else
npx lgview --server http://localhost:8123

# A deployment with a key, on a different local port
npx lgview --server https://my-deployment.example.com --api-key sk-... --port 5000

# Headless box, or you just do not want a browser opening
npx lgview --no-open
```

## There is no `--host`

lgview always binds to `127.0.0.1`.

An earlier version accepted `--host`. It did not work — the UI would serve over
the network while every API call was rejected by the loopback guard — and making
it work would have been worse: lgview has no authentication and proxies to
servers with your API key attached, so exposing it on a network interface would
turn it into an open relay. The flag was removed rather than repaired.

To view a graph on a remote machine, run lgview on that machine and forward the
port over SSH:

```bash
ssh -L 4141:127.0.0.1:4141 you@remote-box
```

## Exit codes

| code | when |
| --- | --- |
| `0` | Normal shutdown (++ctrl+c++), or `--help` / `--version` |
| `1` | Unknown flag, invalid `--port`, or the port is already in use |

A busy port names the problem and suggests the next one rather than hanging.

## Environment

| variable | what it does |
| --- | --- |
| `LGVIEW_SERVER` | Default server for `npm run dev` when working on lgview itself. Has no effect on the published binary — use `--server`. |
