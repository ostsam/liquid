"""
Rewriter Node — ControlSchema + ActiveValues → rewritten text

Runs when activeValues changes (debounced 300ms on the frontend).
Checks the KV pre-generation cache first; falls back to Claude.
Stores result in KV cache, appends to sculpting history stream,
and updates the session hash.
"""

import asyncio

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from copilotkit.langgraph import copilotkit_emit_state

from src.state import AgentState
from src.redis.timemachine import get_rewrite, set_rewrite
from src.redis.streams import append_event
from src.redis.session import update_session


def build_prompt(input_text: str, controls: dict, active_values: dict) -> str:
    scalar_lines = []
    for s in controls.get("scalars", []):
        val = active_values.get(s["id"], s["default"])
        scalar_lines.append(f"- {s['label']}: {val}% — {s['description']}")

    enabled_toggles = [
        f"- {t['label']}: ON — {t['description']}"
        for t in controls.get("toggles", [])
        if active_values.get(t["id"]) is True
    ]

    disabled_toggles = [
        f"- {t['label']}: OFF"
        for t in controls.get("toggles", [])
        if active_values.get(t["id"]) is not True
    ]

    parts = [
        "Rewrite the text below. Apply each parameter exactly as specified.",
        "For scalars: 0% = none/minimum of that quality; 100% = maximum/extreme.",
        "",
        "Parameters:",
        *scalar_lines,
    ]
    if enabled_toggles:
        parts += ["", "Enabled features:", *enabled_toggles]
    if disabled_toggles:
        parts += ["", "Disabled features:", *disabled_toggles]
    parts += [
        "",
        "Return ONLY the rewritten text — no explanation, no quotes, no prefix.",
        "The output must be the same type of content as the input.",
        "",
        "Original text:",
        input_text,
    ]
    return "\n".join(parts)


async def call_rewriter(input_text: str, controls: dict, active_values: dict) -> str:
    """Standalone rewrite call used by both the node and the warm cache."""
    model = ChatAnthropic(model="claude-haiku-4-5", temperature=0.7)
    prompt = build_prompt(input_text, controls, active_values)
    response = await model.ainvoke([HumanMessage(content=prompt)])
    return response.content if isinstance(response.content, str) else \
        "".join(b.get("text", "") for b in response.content)


async def rewriter_node(state: AgentState, config: RunnableConfig) -> dict:
    input_text = state.get("inputText", "")
    controls = state.get("controls")
    active_values = state.get("activeValues", {})

    if not input_text or not controls or not active_values:
        return {}

    # Step 1: Check KV pre-generation cache
    try:
        cached = await get_rewrite(input_text, active_values)
        if cached:
            print("[rewriter] KV cache hit")
            session_id = state.get("sessionId", "")
            if session_id:
                asyncio.create_task(append_event(session_id, "__cached__", "hit", cached))
                asyncio.create_task(update_session(session_id, {**dict(state), "outputText": cached}))
            return {"outputText": cached}
    except Exception:
        pass  # Fall through to live call

    # Step 2: Stream from Claude, emitting partial outputText on each chunk
    model = ChatAnthropic(model="claude-haiku-4-5", temperature=0.7)
    prompt = build_prompt(input_text, controls, active_values)
    output_text = ""

    async for chunk in model.astream([HumanMessage(content=prompt)]):
        delta = chunk.content if isinstance(chunk.content, str) else \
            "".join(b.get("text", "") for b in chunk.content)
        output_text += delta
        await copilotkit_emit_state(config, {**dict(state), "outputText": output_text})

    # Step 3: Cache result (non-blocking)
    asyncio.create_task(set_rewrite(input_text, active_values, output_text))

    # Step 4: Persist output to Redis and append to sculpting history stream.
    # update_session is awaited directly (not via create_task) so the outputText
    # is guaranteed to be in Redis before this node returns — navigation to this
    # historical session will always find the correct text.
    session_id = state.get("sessionId", "")
    if session_id:
        changed_id = next(iter(active_values), "unknown")
        changed_val = str(active_values.get(changed_id, ""))
        await update_session(session_id, {**dict(state), "outputText": output_text})
        asyncio.create_task(append_event(session_id, changed_id, changed_val, output_text))

    return {"outputText": output_text}
