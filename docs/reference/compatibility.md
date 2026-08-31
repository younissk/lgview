# Compatibility

## Verified against

| component | version |
| --- | --- |
| `langgraph-api` | 0.13.0 |
| `langgraph` | 1.2.11 |
| Node | 20, 22, 24 (all three in CI) |

Everything in these docs was checked against a live server at that version, on
macOS. Windows and Linux are expected to work and are not yet verified; neither
is a LangGraph Platform or self-hosted deployment.

## Endpoints lgview uses

Only stable parts of the server API:

| endpoint | used for |
| --- | --- |
| `GET /ok`, `GET /info` | Health and version in the status pill |
| `POST /assistants/search` | The graph picker |
| `GET /assistants/{id}/graph` | Topology for the canvas |
| `GET /assistants/{id}/schemas` | Input field chips and the schema tab |
| `POST /threads`, `POST /threads/search` | The thread list |
| `GET /threads/{id}/state` | Current state |
| `POST /threads/{id}/history` | Checkpoints for time travel |
| `POST /threads/{id}/runs/stream` | Running, resuming and forking |
| `POST /threads/{id}/runs/{run}/cancel` | Cancelling |
| `DELETE /threads/{id}` | Deleting a thread |

Stream modes requested: `values`, `updates`, `debug`, `messages-tuple`, with
`stream_subgraphs` on.

## Two API details worth knowing

Both were found by driving a real server, and neither is obvious from the docs.

**`/graph` takes a name, `/schemas` does not.**
`GET /assistants/{id}/graph` accepts either a graph name or an assistant UUID.
`GET /assistants/{id}/schemas` accepts **only the UUID** and returns
`400 Invalid assistant ID: must be a UUID` for a name. lgview resolves names to
UUIDs via `/assistants/search`.

**Conditional edges carry no branch label.**
An edge produced by `add_conditional_edges` comes back with `conditional: true`
and nothing else — no label, even when the graph was built with an explicit
`path_map`. This is why lgview draws such edges dashed but never labels them:
the information is not there to draw.

## Degrading across versions

lgview is built to survive a server upgrade rather than break on one:

- Unknown stream event names are logged to the event tab, not thrown.
- Unknown response fields are ignored.
- A failed poll keeps the last good drawing on screen and retries.

The honest limit: a *renamed* event degrades silently rather than loudly. If a
future server version renames `updates`, lgview will keep running and quietly
show less.

## Older servers

Not tested. lgview uses no endpoint introduced after the versions above, so
recent 0.x servers will probably work. If yours does not, the version from
`curl <your-server>/info` in [an issue](https://github.com/younissk/lgview/issues)
is the most useful thing you can send.
