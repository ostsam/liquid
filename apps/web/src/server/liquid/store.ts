import { Redis } from "@upstash/redis";

import type {
  LiquidSessionSnapshot,
  PersistedSessionPayload,
  SessionHistoryEntry,
} from "../../lib/liquid/types";

const TTL = 86400;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === "object") {
    return value as T;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export async function getSession(sessionId: string): Promise<LiquidSessionSnapshot | null> {
  const raw = await redis.hgetall<Record<string, unknown>>(`lc:session:${sessionId}`);

  if (!raw) {
    return null;
  }

  return {
    inputText: String(raw.inputText ?? ""),
    controls: raw.controlsJson ? safeParseJson(raw.controlsJson, null) : null,
    activeValues: safeParseJson(raw.activeValuesJson, {}),
    outputText: String(raw.outputText ?? ""),
    sessionId,
    updatedAt: String(raw.updatedAt ?? "0"),
    createdAt: String(raw.createdAt ?? raw.updatedAt ?? "0"),
    rootSessionId: String(raw.rootSessionId ?? sessionId),
    parentSessionId:
      raw.parentSessionId && raw.parentSessionId !== ""
        ? String(raw.parentSessionId)
        : null,
    deleted: raw.deleted === "true" || raw.deleted === true,
  };
}

export async function upsertSession(
  sessionId: string,
  payload: PersistedSessionPayload,
) {
  await redis.hset(`lc:session:${sessionId}`, {
    inputText: payload.inputText,
    controlsJson: JSON.stringify(payload.controls),
    activeValuesJson: JSON.stringify(payload.activeValues),
    outputText: payload.outputText,
    updatedAt: Date.now().toString(),
    createdAt: payload.createdAt,
    rootSessionId: payload.rootSessionId || sessionId,
    parentSessionId: payload.parentSessionId ?? "",
  });
  await redis.expire(`lc:session:${sessionId}`, TTL);
  await redis.sadd(`lc:tree:${payload.rootSessionId || sessionId}:sessions`, sessionId);
  await redis.expire(`lc:tree:${payload.rootSessionId || sessionId}:sessions`, TTL);
}

export async function patchSession(
  sessionId: string,
  patch: Partial<Pick<PersistedSessionPayload, "outputText" | "controls" | "activeValues">>,
) {
  const fields: Record<string, string> = {
    updatedAt: Date.now().toString(),
  };

  if (patch.outputText !== undefined) {
    fields.outputText = patch.outputText;
  }

  if (patch.controls !== undefined) {
    fields.controlsJson = JSON.stringify(patch.controls);
  }

  if (patch.activeValues !== undefined) {
    fields.activeValuesJson = JSON.stringify(patch.activeValues);
  }

  await redis.hset(`lc:session:${sessionId}`, fields);
  await redis.expire(`lc:session:${sessionId}`, TTL);
}

export async function appendHistory(sessionId: string, entry: SessionHistoryEntry) {
  await redis.xadd(`lc:session:${sessionId}:history`, "*", {
    controlId: entry.controlId,
    value: entry.value,
    outputSnapshot: entry.outputSnapshot,
    timestamp: entry.timestamp,
  });
  await redis.expire(`lc:session:${sessionId}:history`, TTL);
}

export async function getHistory(sessionId: string) {
  const raw = await redis.xrange(`lc:session:${sessionId}:history`, "-", "+");

  if (!raw) {
    return [];
  }

  return Object.entries(raw as Record<string, Record<string, unknown>>).map(
    ([streamId, message]) => ({
      id: streamId,
      controlId: String(message.controlId ?? ""),
      value: String(message.value ?? ""),
      outputSnapshot: String(message.outputSnapshot ?? ""),
      timestamp: String(message.timestamp ?? ""),
    }),
  );
}

export async function getTreeSessions(rootId: string) {
  const sessionIds = await redis.smembers<string[]>(`lc:tree:${rootId}:sessions`);

  if (!sessionIds || sessionIds.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  for (const sessionId of sessionIds) {
    pipeline.hgetall(`lc:session:${sessionId}`);
  }

  const rawResults = (await pipeline.exec()) as (Record<string, unknown> | null)[];

  return sessionIds
    .map((sessionId, index) => {
      const raw = rawResults[index];
      if (!raw) {
        return null;
      }

      const controls = raw.controlsJson
        ? safeParseJson<{ scalars?: { label: string }[] } | null>(raw.controlsJson, null)
        : null;

      return {
        sessionId,
        outputText: String(raw.outputText ?? "").slice(0, 200),
        inputText: String(raw.inputText ?? "").slice(0, 200),
        controlLabels: controls?.scalars?.map((scalar) => scalar.label).join(", ") ?? null,
        createdAt: raw.createdAt ?? raw.updatedAt ?? "0",
        updatedAt: raw.updatedAt ?? "0",
        parentSessionId:
          raw.parentSessionId && raw.parentSessionId !== ""
            ? String(raw.parentSessionId)
            : null,
        rootSessionId: raw.rootSessionId ?? rootId,
        deleted: raw.deleted === "true" || raw.deleted === true,
      };
    })
    .filter(Boolean);
}

export async function softDeleteSessionTree(sessionId: string) {
  const session = await redis.hgetall<Record<string, string>>(`lc:session:${sessionId}`);
  const rootId = session?.rootSessionId ?? sessionId;
  const allIds = (await redis.smembers<string[]>(`lc:tree:${rootId}:sessions`)) ?? [sessionId];

  const parentPipeline = redis.pipeline();
  for (const id of allIds) {
    parentPipeline.hget(`lc:session:${id}`, "parentSessionId");
  }

  const parentResults = (await parentPipeline.exec()) as (string | null)[];
  const childMap = new Map<string, string[]>();

  allIds.forEach((id, index) => {
    const parentId = parentResults[index];
    if (!parentId) {
      return;
    }

    const children = childMap.get(parentId) ?? [];
    children.push(id);
    childMap.set(parentId, children);
  });

  const toDelete = new Set<string>([sessionId]);
  const queue = [sessionId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const child of childMap.get(current) ?? []) {
      if (toDelete.has(child)) {
        continue;
      }

      toDelete.add(child);
      queue.push(child);
    }
  }

  const deletePipeline = redis.pipeline();
  for (const id of toDelete) {
    deletePipeline.hset(`lc:session:${id}`, { deleted: "true" });
  }

  await deletePipeline.exec();

  return toDelete.size;
}
