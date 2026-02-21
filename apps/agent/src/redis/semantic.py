"""
Strategy 2: Semantic Cache — vector-based Analyst result cache

Embeds the input text and finds semantically similar past analyses
via cosine similarity. Two different breakup texts likely resolve
to the same control schema without touching Claude at all.

Index: lc-analyst (Upstash Vector, dim=1536, cosine)
Threshold: 0.92 cosine similarity
"""

import hashlib
import json
from typing import Optional, List

from src.redis.client import vector_index

SIMILARITY_THRESHOLD = 0.92


async def find_similar_schema(embedding: List[float]) -> Optional[dict]:
    try:
        results = await vector_index.query(
            vector=embedding,
            top_k=1,
            include_metadata=True,
        )
        if results and results[0].score >= SIMILARITY_THRESHOLD and results[0].metadata:
            schema_str = results[0].metadata.get("schema")
            if schema_str:
                return json.loads(schema_str)
        return None
    except Exception:
        return None


async def store_schema(input_text: str, embedding: List[float], schema: dict) -> None:
    try:
        id_ = hashlib.sha256(input_text.encode()).hexdigest()
        await vector_index.upsert(
            vectors=[{
                "id": id_,
                "vector": embedding,
                "metadata": {
                    "schema": json.dumps(schema),
                    "preview": input_text[:100],
                },
            }]
        )
    except Exception:
        pass  # Non-critical — silently ignore cache write failures
