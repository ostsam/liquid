"""
Strategy 1: Pre-generation KV Cache — the "Time Machine"

Eliminates slider latency by speculatively computing outputs
before the user drags. On first load, fires N×3 background
rewrite jobs for every scalar at {0, 50, 100} and all toggle
permutations (capped at 8). Cache hit target: >80% after 5s.

Key schema: lc:v:{contentHash}:{paramHash} → rewritten_text (TTL: 1h)
"""

import asyncio
import hashlib
import json
from typing import Optional, Callable, Awaitable

from src.redis.client import redis

TTL = 3600  # 1 hour


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _quantize(value: float) -> int:
    return round(value / 10) * 10


def _build_key(input_text: str, active_values: dict) -> str:
    content_hash = _sha256(input_text)
    sorted_values = dict(sorted(active_values.items()))
    param_hash = _sha256(json.dumps(sorted_values))
    return f"lc:v:{content_hash}:{param_hash}"


def _quantize_values(active_values: dict) -> dict:
    out = {}
    for id_, val in active_values.items():
        if isinstance(val, (int, float)):
            out[id_] = _quantize(val)
        else:
            out[id_] = val
    return out


async def get_rewrite(input_text: str, active_values: dict) -> Optional[str]:
    try:
        quantized = _quantize_values(active_values)
        key = _build_key(input_text, quantized)
        cached = await redis.get(key)
        return cached if cached else None
    except Exception:
        return None


async def set_rewrite(input_text: str, active_values: dict, output: str) -> None:
    try:
        quantized = _quantize_values(active_values)
        key = _build_key(input_text, quantized)
        await redis.set(key, output, ex=TTL)
    except Exception:
        pass  # Non-critical


async def warm_cache(
    input_text: str,
    controls: dict,
    rewrite_fn: Callable[[dict], Awaitable[str]],
) -> None:
    """
    Fire background pre-generation jobs after controls first appear.
    Generates N×3 single-axis extremes for scalars + all toggle combos.
    """
    default_values: dict = {}
    for s in controls.get("scalars", []):
        default_values[s["id"]] = s["default"]
    for t in controls.get("toggles", []):
        default_values[t["id"]] = t["default"]

    jobs = []

    # Single-axis extremes: each scalar at 0, 50, 100 with others at default
    for scalar in controls.get("scalars", []):
        for target in [0, 50, 100]:
            values = {**default_values, scalar["id"]: target}

            async def _job(v: dict = values) -> None:
                try:
                    existing = await get_rewrite(input_text, v)
                    if existing:
                        return
                    output = await rewrite_fn(v)
                    await set_rewrite(input_text, v, output)
                except Exception:
                    pass

            jobs.append(_job())

    # All toggle combinations (capped at 8)
    toggle_ids = [t["id"] for t in controls.get("toggles", [])]
    combo_cap = min(2 ** len(toggle_ids), 8)
    for i in range(combo_cap):
        values = {**default_values}
        for bit, tid in enumerate(toggle_ids):
            values[tid] = bool(i & (1 << bit))

        async def _toggle_job(v: dict = values) -> None:
            try:
                existing = await get_rewrite(input_text, v)
                if existing:
                    return
                output = await rewrite_fn(v)
                await set_rewrite(input_text, v, output)
            except Exception:
                pass

        jobs.append(_toggle_job())

    await asyncio.gather(*jobs, return_exceptions=True)
