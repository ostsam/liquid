"""
Strategy 4: Session Store + Shareable URLs — Redis Hash

Stores the full session state (input, controls, active values,
output) in a Redis Hash. Generates a short URL-safe ID.
Powers collaboration and session hydration on page reload.

Key: lc:session:{sessionId} (TTL: 24h)
"""

import json
import secrets
import time
from typing import Optional

from src.redis.client import redis

TTL = 86400  # 24 hours


async def create_session(state: dict) -> str:
    session_id = secrets.token_urlsafe(8)
    await update_session(session_id, state)
    return session_id


async def update_session(session_id: str, state: dict) -> None:
    try:
        key = f"lc:session:{session_id}"
        await redis.hset(key, mapping={
            "inputText": state.get("inputText", ""),
            "controlsJson": json.dumps(state.get("controls")),
            "activeValuesJson": json.dumps(state.get("activeValues", {})),
            "outputText": state.get("outputText", ""),
            "updatedAt": str(int(time.time() * 1000)),
        })
        await redis.expire(key, TTL)
    except Exception:
        pass  # Non-critical


async def get_session(session_id: str) -> Optional[dict]:
    try:
        key = f"lc:session:{session_id}"
        raw = await redis.hgetall(key)
        if not raw or not raw.get("inputText"):
            return None
        return {
            "inputText": raw.get("inputText", ""),
            "controls": json.loads(raw["controlsJson"]) if raw.get("controlsJson") else None,
            "activeValues": json.loads(raw["activeValuesJson"]) if raw.get("activeValuesJson") else {},
            "outputText": raw.get("outputText", ""),
            "sessionId": session_id,
        }
    except Exception:
        return None
