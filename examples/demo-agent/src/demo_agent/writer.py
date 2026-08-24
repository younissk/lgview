"""A deterministic draft/critique/revise loop.

No LLM calls, no API keys — every node is plain Python with a small sleep so
that streaming and node-by-node execution are actually visible in a UI.
"""

from __future__ import annotations

import time
from typing import Annotated, Literal

from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

MAX_REVISIONS = 3


class State(TypedDict):
    messages: Annotated[list, add_messages]
    topic: str
    outline: list[str]
    draft: str
    score: float
    revisions: int
    notes: Annotated[list[str], lambda a, b: a + b]


def plan(state: State) -> dict:
    time.sleep(0.6)
    topic = state.get("topic") or "the unreasonable effectiveness of small tools"
    outline = [f"why {topic} matters", f"how {topic} works", f"what breaks in {topic}"]
    return {
        "topic": topic,
        "outline": outline,
        "revisions": 0,
        "score": 0.0,
        "notes": [f"planned {len(outline)} sections"],
        "messages": [{"role": "assistant", "content": f"Planned an outline for {topic!r}."}],
    }


def write_draft(state: State) -> dict:
    time.sleep(0.9)
    revision = state.get("revisions", 0)
    sections = "\n".join(f"## {s.title()}\n\nSomething substantive about {s}." for s in state["outline"])
    draft = f"# {state['topic'].title()}\n\n{sections}\n\n_(revision {revision})_"
    return {
        "draft": draft,
        "notes": [f"wrote draft at revision {revision}"],
        "messages": [{"role": "assistant", "content": f"Draft v{revision} is {len(draft)} chars."}],
    }


def critique(state: State) -> dict:
    """Score the draft. Deterministic: each revision improves it by a fixed step."""
    time.sleep(0.7)
    score = round(min(1.0, 0.45 + 0.2 * state.get("revisions", 0)), 2)
    return {
        "score": score,
        "notes": [f"scored {score}"],
        "messages": [{"role": "assistant", "content": f"Critique scored the draft {score}."}],
    }


def revise(state: State) -> dict:
    time.sleep(0.5)
    return {
        "revisions": state.get("revisions", 0) + 1,
        "notes": ["asked for a revision"],
    }


def finalize(state: State) -> dict:
    time.sleep(0.3)
    return {
        "notes": ["finalized"],
        "messages": [{"role": "assistant", "content": "Good enough. Shipping it."}],
    }


def route_after_critique(state: State) -> Literal["revise", "finalize"]:
    """The canvas knows the branches; the condition lives here in code."""
    if state.get("score", 0.0) >= 0.8 or state.get("revisions", 0) >= MAX_REVISIONS:
        return "finalize"
    return "revise"


def build_graph():
    g = StateGraph(State)
    g.add_node("plan", plan)
    g.add_node("write_draft", write_draft)
    g.add_node("critique", critique)
    g.add_node("revise", revise)
    g.add_node("finalize", finalize)

    g.add_edge(START, "plan")
    g.add_edge("plan", "write_draft")
    g.add_edge("write_draft", "critique")
    g.add_conditional_edges(
        "critique",
        route_after_critique,
        {"revise": "revise", "finalize": "finalize"},
    )
    g.add_edge("revise", "write_draft")
    g.add_edge("finalize", END)
    return g.compile()


graph = build_graph()
