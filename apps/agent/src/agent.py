"""
Liquid Control — LangGraph Agent

Two-node graph with conditional routing:

  [START]
    │
    ▼
  [router] ── inputText set + controls null ──► [analyst_node]
    │                                                 │
    └── controls set + activeValues non-empty ──► [rewriter_node]
                                                       │
                                                    [END]
"""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from src.state import AgentState
from src.nodes.analyst import analyst_node
from src.nodes.rewriter import rewriter_node


def router(state: AgentState) -> str:
    has_input = bool(state.get("inputText", ""))
    has_controls = state.get("controls") is not None
    has_values = bool(state.get("activeValues", {}))

    if has_input and not has_controls:
        return "analyst_node"
    if has_controls and has_values:
        return "rewriter_node"
    return END


workflow = StateGraph(AgentState)
workflow.add_node("analyst_node", analyst_node)
workflow.add_node("rewriter_node", rewriter_node)
workflow.add_conditional_edges(START, router, {
    "analyst_node": "analyst_node",
    "rewriter_node": "rewriter_node",
    END: END,
})
workflow.add_edge("analyst_node", "rewriter_node")
workflow.add_edge("rewriter_node", END)

memory = MemorySaver()
graph = workflow.compile(checkpointer=memory)
