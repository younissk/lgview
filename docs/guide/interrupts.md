# Interrupts

A graph that calls `interrupt()` stops and waits for a human. lgview surfaces
that as a question you can answer without leaving the page.

## What it looks like

When the run reaches an `interrupt()`:

- The run status becomes **interrupted**.
- The node that paused turns violet with a ⏸.
- An interrupt card appears under the input box, showing whatever the node
  passed to `interrupt()`.
- The thread's status in the list becomes `interrupted`.

If the interrupt payload looks like a question with options — an object with a
`question` string and an `options` array — lgview renders the options as
buttons. Anything else is shown as raw JSON, because guessing at the shape of an
arbitrary payload would be worse than showing it plainly.

```python
# Rendered as a question with two buttons
answer = interrupt({
    "question": f"Approve {state['request']} for {state['amount']}?",
    "options": ["approve", "reject"],
})
```

## Answering

Click one of the options, or type a value into the box and press **Resume**.

A typed value is coerced when it obviously should be: `42` becomes a number,
`true` a boolean, `null` null, and anything starting with `{` or `[` is parsed
as JSON. Everything else is sent as a string.

Resuming issues a run with `Command(resume=<your value>)` against the same
thread. The nodes that already ran keep their colouring — resuming continues a
run, it does not start a new one.

!!! warning "Run does not resume"

    While a thread is parked, the **Run** button is disabled and says why.

    This is deliberate. Running would start the graph again from `START` rather
    than continuing from the interrupt, silently discarding the pause and
    re-executing every node before it. That was a real bug in an earlier version;
    now the only way forward from an interrupt is to answer it.

    ++cmd+enter++ respects this too.

## Coming back later

An interrupt lives in the thread on the server, not in the browser. Close the
tab, restart lgview, come back tomorrow — reopen the thread and the interrupt
card is still there, with the graph coloured up to the point it paused.

## Interrupts you did not write

`interrupt_before` and `interrupt_after` at compile time pause a graph without
any payload. lgview shows those as a paused run with the pending node marked,
and **Resume** with an empty value continues it.
