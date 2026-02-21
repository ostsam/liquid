import { Redis } from "@upstash/redis";
import { Index } from "@upstash/vector";

// Singleton KV/Hash/Stream client — used by both agent nodes and session management
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Singleton vector index — semantic cache for Analyst results
// Create in Upstash console: dim=1536, metric=cosine, name=lc-analyst
export const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});
