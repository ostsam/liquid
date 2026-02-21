/**
 * Liquid Control — LangGraph Agent
 *
 * Two-node graph with conditional routing:
 *
 *   [START]
 *     │
 *     ▼
 *   [router] ── inputText set + controls null ──► [analyst_node]
 *     │                                                 │
 *     └── controls set + activeValues non-empty ──► [rewriter_node]
 *                                                        │
 *                                                     [END]
 *
 * The frontend triggers runs via useCoAgent's run() after setState().
 * The agent acts purely on state; message content is ignored.
 */

import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation, type AgentState } from "./state";
import { analystNode } from "./nodes/analyst";
import { rewriterNode } from "./nodes/rewriter";

// ─── Router ──────────────────────────────────────────────────────────────────

function router(
  state: AgentState
): "analyst_node" | "rewriter_node" | typeof END {
  const hasInput = Boolean(state.inputText);
  const hasControls = state.controls !== null && state.controls !== undefined;
  const hasValues = Object.keys(state.activeValues ?? {}).length > 0;

  if (hasInput && !hasControls) return "analyst_node";
  if (hasControls && hasValues) return "rewriter_node";
  return END;
}

// ─── Graph ───────────────────────────────────────────────────────────────────

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("analyst_node", analystNode)
  .addNode("rewriter_node", rewriterNode)
  .addConditionalEdges(START, router, {
    analyst_node: "analyst_node",
    rewriter_node: "rewriter_node",
    [END]: END,
  })
  .addEdge("analyst_node", "rewriter_node")
  .addEdge("rewriter_node", END);

const memory = new MemorySaver();

export const graph = workflow.compile({ checkpointer: memory });
