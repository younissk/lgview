# Keyboard and accessibility

lgview is usable without a mouse and without sight. Where that is not yet true,
this page says so.

## Shortcuts

| keys | what it does |
| --- | --- |
| ++cmd+enter++ / ++ctrl+enter++ | Run the graph. Ignored while a run is active or the thread is parked on an interrupt. |
| ++escape++ | Close the servers dialog, or the open drawer on a narrow window. |
| ++tab++ / ++shift+tab++ | Move through the interface, including the graph nodes. |
| ++enter++ on a node | Select it, filling the inspector with what that node last returned. |

## Resizing the panels

The dividers between the panels are real controls, not drag-only affordances.
Focus one with ++tab++ and:

| keys | what it does |
| --- | --- |
| ++left++ / ++right++ | Move the divider in 16px steps |
| ++shift+left++ / ++shift+right++ | Move it a single pixel |
| ++home++ / ++end++ | Jump to the minimum or maximum width |
| ++enter++ or double-click | Reset to the default width |

Widths are remembered per panel.

## The canvas

Graph nodes are reachable with ++tab++ and announce themselves as, for example,
"critique, finished". Selecting one with ++enter++ populates the inspector — the
same as clicking it.

The canvas is a spatial view of a directed graph, and that is genuinely hard to
convey linearly. Today the honest description is: every node is individually
reachable and announced with its status, but the *shape* of the graph — which
node leads to which — is not exposed as text. The **events** tab is the linear
equivalent and does carry execution order.

## Announcements

Run status changes are announced through a live region: run started, run
finished, run failed with its message, and "the graph is waiting for your
input". Without that, a run's entire progress would be silent, since everything
else about it is colour on a canvas.

## Colour

No state is signalled by colour alone. Every node status carries a distinct
glyph (✓ finished, ✕ failed, ⏸ waiting, ■ stopped, … queued) and a
screen-reader-only text label. This matters most for finished versus failed,
which sit at about 1.12:1 against each other for a protanope.

Text and background pairs meet WCAG 2.2 AA contrast.

## Motion

Node pulses and animated edges respect `prefers-reduced-motion`. With it set,
transitions are reduced to effectively nothing.

## Known gaps

Reported honestly rather than left to be discovered:

- **The graph's structure has no text alternative.** Nodes are individually
  announced; the edges between them are not.
- **No screen reader has actually been driven against it.** The behaviour above
  is correct by construction and verified in the accessibility tree, which is
  not the same as someone listening to it. If you use one and something is
  wrong, [an issue](https://github.com/younissk/lgview/issues) would be
  genuinely useful.
- **The minimap is decorative** and offers nothing to a keyboard user.
