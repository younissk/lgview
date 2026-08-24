"""A human-in-the-loop graph: it stops on `interrupt()` and waits for a decision.

Used to exercise interrupt rendering and resume-with-Command in the UI.
"""

from __future__ import annotations

import time
from typing import Annotated, Literal

from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import interrupt
from typing_extensions import TypedDict


class State(TypedDict):
    messages: Annotated[list, add_messages]
    request: str
    amount: float
    decision: str
    log: Annotated[list[str], lambda a, b: a + b]


def prepare(state: State) -> dict:
    time.sleep(0.4)
    request = state.get("request") or "refund order #4417"
    amount = state.get("amount") or 240.0
    return {
        "request": request,
        "amount": amount,
        "log": [f"prepared {request} for {amount}"],
        "messages": [{"role": "assistant", "content": f"Ready to {request} ({amount})."}],
    }


def ask_human(state: State) -> dict:
    """Pause here. Resume with Command(resume="approve") or "reject"."""
    answer = interrupt(
        {
            "question": f"Approve {state['request']} for {state['amount']}?",
            "options": ["approve", "reject"],
        }
    )
    decision = str(answer).strip().lower() if answer is not None else "reject"
    return {"decision": decision, "log": [f"human said {decision}"]}


def execute(state: State) -> dict:
    time.sleep(0.5)
    return {
        "log": ["executed"],
        "messages": [{"role": "assistant", "content": f"Executed: {state['request']}."}],
    }


def reject(state: State) -> dict:
    time.sleep(0.2)
    return {
        "log": ["rejected"],
        "messages": [{"role": "assistant", "content": "Rejected. Nothing was executed."}],
    }


def route_decision(state: State) -> Literal["execute", "reject"]:
    return "execute" if state.get("decision") == "approve" else "reject"


def build_graph():
    g = StateGraph(State)
    g.add_node("prepare", prepare)
    g.add_node("ask_human", ask_human)
    g.add_node("execute", execute)
    g.add_node("reject", reject)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "ask_human")
    g.add_conditional_edges("ask_human", route_decision, {"execute": "execute", "reject": "reject"})
    g.add_edge("execute", END)
    g.add_edge("reject", END)
    return g.compile()


graph = build_graph()
