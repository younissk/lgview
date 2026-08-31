# Security

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it
privately through GitHub:
[**Report a vulnerability**](https://github.com/younissk/lgview/security/advisories/new).

The full policy, including scope, is in
[SECURITY.md](https://github.com/younissk/lgview/blob/main/SECURITY.md).

## What lgview does, so you can judge the risk yourself

lgview starts a local HTTP server that does two things:

1. Serves a bundled single-page app from disk.
2. **Reverse-proxies requests to a LangGraph server you choose**, attaching an
   API key if you configured one.

Point 2 is the part that matters. The proxy connects to whatever address the
page names, which makes `cli/proxy.ts` the most security-sensitive code in the
project.

## How the proxy is guarded

Three checks, none of which relies on the browser enforcing CORS:

| check | why |
| --- | --- |
| `Host` must be a loopback name | Without it, DNS rebinding points an attacker-controlled hostname at `127.0.0.1` and sails through. |
| `Sec-Fetch-Site` must not say cross-site | **The load-bearing one.** Browsers omit `Origin` entirely on `<img>`, `<script>` and `no-cors` GETs, so an Origin-only check waves through exactly the cross-site requests an attacker gets for free — and those are enough to read every thread and checkpoint on your server. |
| `Origin`, when present, must be lgview's own | Belt and braces. |

Additionally:

- `x-lgview-upstream` is **mandatory**. There is no server-side default, because
  a fallback would make the custom header optional, and a request without a
  custom header is one a browser will send cross-site with no preflight.
- Responses carry `nosniff`, and the page cannot be framed. An upstream serving
  HTML must not get to execute script on the lgview origin.
- Upstream `Set-Cookie` is never relayed — cookies ignore the port, so one would
  land on `127.0.0.1` for every other dev server on your machine.
- Upstream redirects are rewritten back through the proxy, or refused if they
  leave the upstream's origin.

## Your API key

- Stored in `sessionStorage` — the life of the browser tab — and never written
  to disk.
- Attached by the lgview process, not by the page.
- **Pinned to the origin it was configured for.** It is never sent anywhere
  else, and never over plaintext `http` to a non-loopback host.

Passing `--api-key` on the command line puts it in your shell history and in
`ps` output. Typing it into the UI is better.

## Privacy

lgview collects nothing. No telemetry, no analytics, no error reporting, no
update check. The only host it contacts is the LangGraph server you point it at;
the page loads no remote fonts, scripts or images.

Thread state and checkpoints — which routinely contain end-user conversations —
are rendered in your browser and never sent anywhere except back to the server
they came from.

!!! note "This is a technical statement, not a compliance one"

    lgview handling no data of its own does not make your *agent* compliant with
    anything. The personal data lives in your LangGraph server and whatever your
    graphs do with it; that is your responsibility and outside what this tool can
    speak to.

## What is out of scope

- **An attacker who already has code execution as your user.** lgview binds to
  loopback and has no authentication by design; it assumes your machine is
  yours.
- **Vulnerabilities in the LangGraph server itself** — report those to
  [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph).
- **Deliberately exposing lgview to a network.** There is no supported way to do
  it; see [the CLI reference](reference/cli.md#there-is-no-host).

## A note on how this was hardened

Version 0.1.0 shipped with a real cross-site request forgery: `Origin` was only
checked when present, so any website you visited while lgview was running could
read your agent's threads and checkpoints with your API key attached. It was
found by an audit before publication, and the test suite had *codified the hole
as correct behaviour*, which is why review had not caught it.

That is worth stating plainly rather than quietly fixing. If you are reading this
code with an eye for holes, the proxy is where to look, and findings there are
always in scope.
