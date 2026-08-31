# Running a graph

## Input

The **input** box takes a JSON object — whatever you would pass to
`graph.invoke()`.

It starts as `{}` on purpose. LangGraph derives a graph's input schema from its
state `TypedDict`, which marks *every* field required even when your nodes
supply their own defaults. Seeding the box from that would hand the graph a wall
of empty strings that overwrite exactly the defaults you wanted.

Instead:

- The chips under the box are the fields the schema declares, with their types.
  Click one to insert it; click it again to remove it.
- **template** fills in every field at once, if you want the full shape.

An empty box means "no input", which is how you continue a thread that already
holds state.

## Threads

A run always happens in a thread. If none is selected, **Run in a new thread**
creates one first.

- **+** starts a fresh thread without running anything.
- The thread list shows each thread's id, status and age. Click one to open it.
- Reopening a thread restores its canvas — which nodes ran, how long they took,
  how many times they looped — reconstructed from the server's checkpoint
  history.
- Threads are capped at 40 per page, with **load older threads** at the bottom
  when there are more.

## Watching a run

While a run streams:

| what you see | what it means |
| --- | --- |
| Amber node with a pulsing dot | Currently executing |
| Teal node with a ✓ | Finished, with its duration |
| `×3` badge | The node has run three times — a loop |
| Red node with a ✕ | Raised an exception |
| Grey node with a ■ | Stopped before finishing, because the run was cancelled |
| Violet node with a ⏸ | Waiting on an [interrupt](interrupts.md) |
| Animated amber edge | The path just taken |

Status is never conveyed by colour alone — every state has a distinct glyph and
an announced text label.

## Cancelling

**Cancel run** stops watching *and* tells the server to stop the run. If the
server does not confirm, lgview says so rather than claiming success — a
half-cancelled run that reports "cancelled" is worse than one that admits it is
unsure.

A node that was mid-flight when you cancelled is marked *stopped*, not
*finished*.

## The panels

- **state** — the full state after the latest step, as a collapsible tree.
  Selecting a node shows what that node last returned above it.
- **events** — every server-sent event, decoded and timestamped. Expand a row to
  see its payload.
- **history** — the [checkpoints](time-travel.md).
- **schema** — the graph's state, input, output, config and context schemas as
  the server publishes them.

!!! note "Very long runs release old payloads"

    LangGraph re-sends the whole graph state on every superstep. Keeping all of
    it would pin hundreds of megabytes over a long run, so the event log keeps
    full payloads for the most recent entries and releases older ones, marking
    them as released. The entries themselves stay as a timeline. The current
    state is always available in full on the **state** tab, and past states on
    **history**.
