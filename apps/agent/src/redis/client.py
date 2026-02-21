import os
from upstash_redis.asyncio import Redis
from upstash_vector import AsyncIndex

# Singleton KV/Hash/Stream client
redis = Redis(
    url=os.environ["UPSTASH_REDIS_REST_URL"],
    token=os.environ["UPSTASH_REDIS_REST_TOKEN"],
)

# Singleton vector index — semantic cache for Analyst results
# Create in Upstash console: dim=1536, metric=cosine, name=lc-analyst
vector_index = AsyncIndex(
    url=os.environ["UPSTASH_VECTOR_REST_URL"],
    token=os.environ["UPSTASH_VECTOR_REST_TOKEN"],
)
