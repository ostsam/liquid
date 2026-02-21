"""
Strategy 3: Sculpting History — Redis Streams

Every control change is appended as an event to a Redis Stream.
This is the "DNA" of the editing session — a complete event log.
Powers the Replay feature: scrub back through every decision
the user made, replaying text morphs without any LLM calls.

Key: lc:session:{sessionId}:history (TTL: 24h)
"""

import time
from typing import List

from src.redis.client import redis


async def append_event(
    session_id: str,
    control_id: str,
    value: str,
    output_snapshot: str,
) -> None:
    try:
        key = f"lc:session:{session_id}:history"
        await redis.xadd(key, {
            "controlId": control_id,
            "value": value,
            "outputSnapshot": output_snapshot,
            "timestamp": str(int(time.time() * 1000)),
        })
        await redis.expire(key, 86400)
    except Exception:
        pass  # Non-critical


async def get_history(session_id: str) -> List[dict]:
    try:
        key = f"lc:session:{session_id}:history"
        raw = await redis.xrange(key, "-", "+")
        if not raw:
            return []
        entries = []
        for stream_id, message in raw:
            entries.append({
                "id": stream_id,
                "controlId": message.get("controlId", ""),
                "value": message.get("value", ""),
                "outputSnapshot": message.get("outputSnapshot", ""),
                "timestamp": message.get("timestamp", ""),
            })
        return entries
    except Exception:
        return []
