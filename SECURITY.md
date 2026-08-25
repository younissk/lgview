# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/younissk/lgview/security/advisories/new).
That opens a draft advisory only you and the maintainers can see.

Please include what you can of: the version (`lgview --version`), how lgview
was started (flags and `--server`), what you did, what happened, and what you
expected. A reproduction — even a `curl` one-liner — is worth more than
anything else in the report.

Expect an acknowledgement within a few days. This is a small volunteer
project, so please be patient with the fix timeline; if a report is credible
and I cannot fix it quickly, I would rather say so than go quiet.

If a fix ships, you will be credited in the advisory and the changelog unless
you ask not to be.

## What lgview actually does, so you can judge the risk yourself

lgview starts a local HTTP server that does two things:

1. Serves a bundled single-page app from disk.
2. **Reverse-proxies requests to a LangGraph server you choose**, attaching an
   API key if you configured one.

Point 2 is the part that matters. The proxy will connect to whatever address
the page names, which makes it the most security-sensitive code in the
repository (`cli/proxy.ts`). It is defended by two checks: the request's `Host`
must be a loopback name, and if an `Origin` header is present it must match
lgview's own. Those two checks are load-bearing — weakening either turns the
proxy into a server-side request forgery vector against your own network.
Changes to that file get read closely, and findings there are always in scope.

## Scope

**In scope**

- Anything that lets a web page, another local process, or a remote host reach
  the `/__lg/*` proxy or use it to reach hosts it should not.
- Anything that discloses your LangGraph API key, or sends it somewhere you did
  not configure.
- Path traversal or arbitrary file read through the static server.
- Code execution through the CLI, the build, or the published package.
- Anything that lets content from a LangGraph server (graph names, thread state,
  agent output) execute script in the lgview origin.

**Out of scope**

- An attacker who already has local code execution as your user. lgview binds
  to loopback and has no authentication by design; it assumes your machine is
  yours.
- Vulnerabilities in the LangGraph server itself — report those to
  [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph).
- Running lgview with `--host 0.0.0.0` and exposing it deliberately. That is
  unsupported, and the loopback check will reject the proxy calls anyway.
- Missing hardening headers on a localhost-only page, absent a concrete
  exploit path.

## Practical advice

- Prefer a local `langgraph dev` server. If you must connect to a deployed one,
  use `https://`.
- Treat your LangGraph API key like any other production credential. Passing it
  as `--api-key` puts it in your shell history and in `ps` output.
- Thread state and checkpoints routinely contain end-user data. lgview renders
  it locally and never transmits it anywhere except back to the server it came
  from — but your screen recording and your screenshots will contain it.
