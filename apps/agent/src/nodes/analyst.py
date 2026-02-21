"""
Analyst Node — text → ControlSchema

Runs when inputText is set and controls is null.
Checks the semantic cache first (Upstash Vector).
Falls back to Claude with a strict JSON prompt.
Validates output with Pydantic; retries once on schema failure.
Fires background warm-cache jobs after successful analysis.
"""

import json
import asyncio
from typing import Optional

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import OpenAIEmbeddings

from src.state import AgentState
from src.types import ControlSchema
from src.redis.semantic import find_similar_schema, store_schema
from src.redis.timemachine import warm_cache
from src.redis.session import update_session

ANALYST_SYSTEM_PROMPT = """You are a latent variable extractor. Your job is to decompose the provided text into its hidden control dimensions — the underlying axes of variation that, if altered, would meaningfully transform the text.

Output ONLY a JSON object. No explanation. No markdown. No code fences. Raw JSON only.

Schema:
{
  "scalars": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence describing what this dimension controls.", "default": 50 }
  ],
  "toggles": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence describing what flipping this changes.", "default": false }
  ]
}

Rules:
- Exactly 3 to 5 scalars (no more, no fewer)
- Exactly 2 to 3 toggles (no more, no fewer)
- Names MUST be specific to this exact text. Generic names are strictly forbidden.
- FORBIDDEN labels: "Tone", "Length", "Formality", "Clarity", "Detail", "Complexity", "Style", "Sentiment", "Register", "Politeness"
- REQUIRED: Names that reveal something surprising or specific about THIS piece of text
- GOOD examples for a breakup text: "Blame Assignment", "Passive Aggressive", "Closure Velocity", "Door Left Open"
- GOOD examples for code: "Comment Density", "Junior vs Senior Dev", "Optimization Aggression", "Magic Number Tolerance"
- GOOD examples for an email: "Corporate Buzzword Density", "Urgency Escalation", "Plausible Deniability", "Enthusiasm Sincerity"
- Each scalar: at value 0 the text transforms dramatically one way; at value 100 it transforms the opposite extreme
- The "default" value (0-100) reflects exactly where THIS text currently sits on that dimension
- Toggle defaults: true if the feature is actively present in the current text, false if absent"""


def build_default_active_values(schema: ControlSchema) -> dict:
    values: dict = {}
    for s in schema.scalars:
        values[s.id] = s.default
    for t in schema.toggles:
        values[t.id] = t.default
    return values


async def analyst_node(state: AgentState, config: RunnableConfig) -> dict:
    if not state.get("inputText"):
        return {}

    input_text: str = state["inputText"]

    # Step 1: Embed the input for semantic cache lookup
    embedding: list = []
    try:
        embeddings_model = OpenAIEmbeddings(model="text-embedding-3-small")
        embedding = await embeddings_model.aembed_query(input_text)

        # Step 2: Check semantic cache
        cached = await find_similar_schema(embedding)
        if cached:
            print("[analyst] Semantic cache hit — skipping Claude call")
            schema = ControlSchema(**cached)
            active_values = build_default_active_values(schema)
            schema_dict = schema.model_dump()

            async def _rewrite_fn_cached(values: dict) -> str:
                from src.nodes.rewriter import call_rewriter
                return await call_rewriter(input_text, schema_dict, values)

            asyncio.create_task(warm_cache(input_text, schema_dict, _rewrite_fn_cached))
            return {"controls": schema_dict, "activeValues": active_values}
    except Exception as e:
        print(f"[analyst] Embedding/semantic cache failed: {e}")

    # Step 3: Call Claude — up to 2 attempts
    model = ChatAnthropic(model="claude-haiku-4-5", temperature=1)
    controls: Optional[ControlSchema] = None

    for attempt in range(2):
        try:
            if attempt == 0:
                user_content = input_text
            else:
                user_content = (
                    f"{input_text}\n\n"
                    "[IMPORTANT: Your previous response failed JSON validation. "
                    "Output ONLY raw JSON — no markdown fences, no explanation, no prefix text.]"
                )

            response = await model.ainvoke(
                [SystemMessage(content=ANALYST_SYSTEM_PROMPT), HumanMessage(content=user_content)],
                config,
            )

            raw = response.content if isinstance(response.content, str) else \
                "".join(b.get("text", "") for b in response.content)

            # Strip markdown fences if Claude adds them despite instructions
            clean = raw.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
            if clean.endswith("```"):
                clean = clean[:-3]
            clean = clean.strip()

            parsed = json.loads(clean)
            controls = ControlSchema(**parsed)
            break
        except Exception as e:
            print(f"[analyst] Attempt {attempt + 1}/2 failed: {e}")

    if not controls:
        print("[analyst] Failed to produce valid ControlSchema after 2 attempts")
        return {}

    controls_dict = controls.model_dump()

    # Step 4: Store in semantic cache (non-blocking)
    if embedding:
        asyncio.create_task(store_schema(input_text, embedding, controls_dict))

    # Step 5: Fire warm cache in background (non-blocking)
    async def _rewrite_fn(values: dict) -> str:
        from src.nodes.rewriter import call_rewriter
        return await call_rewriter(input_text, controls_dict, values)

    asyncio.create_task(warm_cache(input_text, controls_dict, _rewrite_fn))

    active_values = build_default_active_values(controls)

    # Persist controls + activeValues so page refresh can restore the cockpit
    session_id = state.get("sessionId", "")
    if session_id:
        asyncio.create_task(update_session(session_id, {
            **dict(state),
            "controls": controls_dict,
            "activeValues": active_values,
        }))

    return {"controls": controls_dict, "activeValues": active_values}
