# Time travel

Every step of a run leaves a checkpoint on the server. The **history** tab lists
them, and any one of them can be re-run from.

## Reading the history

Each entry shows:

- the checkpoint id, shortened
- its **step** number
- what was going to run **next** at that point, as chips
- whether an interrupt was pending
- how long ago it was written

The checkpoint currently loaded is outlined in teal.

History is fetched a hundred entries at a time. If a run is longer than that,
the list says so explicitly rather than letting earlier steps look as though
they never existed.

## Forking a run

**resume from here** starts a new run from that checkpoint, using the state as
it was at that moment.

This is how you answer "what if this node had returned something else" — pick
the checkpoint just before it, fork, and watch it play forward again. The
original run is untouched; forking adds new checkpoints alongside the old ones,
so the history grows rather than being rewritten.

The control is disabled when there is no thread selected or a run is already in
flight, because a fork with nothing to fork from is a click that does nothing.

!!! note "What forking cannot do yet"

    You cannot edit the state before forking. The server supports it — it is on
    the roadmap for lgview, and until it lands a fork replays from the state
    exactly as it was recorded.

## Why the checkpoint ids look alike

LangGraph checkpoint ids are UUIDv7-ish: they share a long prefix within a
thread because they are time-ordered. lgview shows the first ten characters,
which is enough to tell adjacent checkpoints apart within one thread, and pairs
them with the step number, which is the part you actually navigate by.

## Threads versus checkpoints

- A **thread** is a conversation or a run's whole lifetime. It holds state.
- A **checkpoint** is one step within it.

Deleting a thread deletes every checkpoint in it, permanently, which is why the
delete control asks before it does anything.
