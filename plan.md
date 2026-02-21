# Liquid — Build Plan

## What We're Starting From

The starter gives us a working CopilotKit ↔ LangGraph pipe with a single node (`chat_node`), a shared `proverbs` array, and a `CopilotSidebar`. All of that is demo scaffolding. We keep the pipe; we gut everything else.

**Keep:**
- `apps/web/src/app/api/copilotkit/route.ts` — CopilotRuntime + LangGraphAgent bridge (rename agent)
- `apps/web/src/app/layout.tsx` — CopilotKit provider (rename agent, strip copilot CSS import)
- `apps/agent/src/agent.ts` — graph skeleton (full rewrite, but the shape stays)

**Delete/replace:**
- `CopilotSidebar` — there is no chat UI
- `proverbs` state — replaced by our state shape
- `getWeather` tool — removed
- `setThemeColor`, `addProverb` frontend actions — removed
- `ChatOpenAI` — replaced by `ChatAnthropic`

---

## Final File Tree

```
apps/
├── agent/src/
│   ├── types.ts              ← Zod schemas + TS types (source of truth)
│   ├── state.ts              ← LangGraph AgentState annotation
│   ├── agent.ts              ← Graph definition (rewrite)
│   ├── redis/
│   │   ├── client.ts         ← Singleton Upstash clients
│   │   ├── timemachine.ts    ← Strategy 1: KV pre-generation cache
│   │   ├── semantic.ts       ← Strategy 2: Vector semantic cache
│   │   ├── streams.ts        ← Strategy 3: Sculpting history
│   │   └── session.ts        ← Strategy 4: Session store
│   └── nodes/
│       ├── analyst.ts        ← LangGraph node: text → ControlSchema
│       └── rewriter.ts       ← LangGraph node: ControlSchema + values → text
└── web/src/
    ├── app/
    │   ├── layout.tsx                    ← Update agent name + metadata
    │   ├── page.tsx                      ← Full rewrite
    │   ├── globals.css                   ← Add glass-shatter keyframes
    │   └── api/
    │       ├── copilotkit/route.ts       ← Rename agent to liquidAgent
    │       └── session/[id]/route.ts     ← GET/POST session via Redis
    └── components/
        ├── GlassPane.tsx       ← Input + output text display
        ├── ControlPanel.tsx    ← Renders controls from ControlSchema JSON
        ├── Dial.tsx            ← Scalar control (0–100 slider)
        └── Toggle.tsx          ← Boolean control
```

---

## Phase 1 — Contracts

**Touch:** `apps/agent/src/types.ts` (create)

Define all shared types here first. Nothing imports from agent nodes or Redis yet — this file has zero dependencies. Everything else imports from here.

```typescript
import { z } from "zod";

export const ScalarControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  default: z.number().min(0).max(100),
});

export const ToggleControlSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  default: z.boolean(),
});

export const ControlSchemaSchema = z.object({
  scalars: z.array(ScalarControlSchema).min(3).max(5),
  toggles: z.array(ToggleControlSchema).min(2).max(3),
});

export type ScalarControl = z.infer<typeof ScalarControlSchema>;
export type ToggleControl = z.infer<typeof ToggleControlSchema>;
export type ControlSchema = z.infer<typeof ControlSchemaSchema>;

export type ActiveValues = Record<string, number | boolean>;

// The full agent state shape — must match LangGraph annotation and useCoAgent
export type LiquidAgentState = {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  sessionId: string;
};
```

**Why Zod here:** the Analyst prompt returns raw JSON. Zod parses AND validates it. If Claude returns `"Tone"` as a label, that still passes — but if it returns fewer than 3 scalars we catch it and retry. Zod is the contract enforcement layer.

---

## Phase 2 — Agent State

**Touch:** `apps/agent/src/state.ts` (create)

```typescript
import { Annotation } from "@langchain/langgraph";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";
import { ControlSchema, ActiveValues } from "./types";

export const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  inputText:    Annotation<string>({ default: () => "" }),
  controls:     Annotation<ControlSchema | null>({ default: () => null }),
  activeValues: Annotation<ActiveValues>({ default: () => ({}) }),
  outputText:   Annotation<string>({ default: () => "" }),
  sessionId:    Annotation<string>({ default: () => "" }),
});

export type AgentState = typeof AgentStateAnnotation.State;
```

**CopilotKitStateAnnotation** includes `messages` and `copilotkit` (frontend actions). We spread it in, then add our own fields. The frontend's `useCoAgent` reads and writes the non-`messages` fields.

---

## Phase 3 — Redis Infrastructure

Build all four Redis files before the nodes. Nodes will import from here.

### 3a. `redis/client.ts`

Singleton exports. Import these everywhere; never instantiate Redis inline.

```typescript
import { Redis } from "@upstash/redis";
import { Index } from "@upstash/vector";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Vector index: create in Upstash console with dim=1536, metric=cosine
export const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});
```

### 3b. `redis/timemachine.ts` — KV Pre-generation Cache

```
Key:   lc:v:{sha256(inputText)}:{sha256(JSON.stringify(sortedActiveValues))}
Value: rewritten text string
TTL:   1 hour
```

**API to implement:**
```typescript
getRewrite(inputText: string, activeValues: ActiveValues): Promise<string | null>
setRewrite(inputText: string, activeValues: ActiveValues, output: string): Promise<void>
warmCache(inputText: string, controls: ControlSchema, rewriteFn: (v: ActiveValues) => Promise<string>): Promise<void>
```

`warmCache` fires in the background immediately after controls appear. It generates:
- Every scalar at 0, 50, 100 (3^N combinations is too many — instead generate N×3 single-axis extremes, holding others at default)
- All toggle combinations up to 8 (2^N, capped)

This gives the slider pre-warmed endpoints without a combinatorial explosion.

### 3c. `redis/semantic.ts` — Vector Semantic Cache

```
Index: lc-analyst (Upstash Vector, dim=1536, cosine)
ID:    sha256(inputText)
Meta:  { schema: string (JSON), preview: string }
```

**API to implement:**
```typescript
findSimilarSchema(embedding: number[]): Promise<ControlSchema | null>
storeSchema(inputText: string, embedding: number[], schema: ControlSchema): Promise<void>
```

Similarity threshold: `0.92`. Below that, treat as a miss and call the Analyst.

**Embedding source:** `OpenAIEmbeddings` from `@langchain/openai` using `text-embedding-3-small`. It's 1536-dimensional, ~$0.00002 per call, fast. Fits the Upstash Vector index config.

### 3d. `redis/streams.ts` — Sculpting History

```
Key:   lc:session:{sessionId}:history  (Redis Stream)
Entry: { controlId, value, outputSnapshot, timestamp }
TTL:   24h (set on first XADD via EXPIRE)
```

**API to implement:**
```typescript
appendEvent(sessionId: string, controlId: string, value: string, outputSnapshot: string): Promise<void>
getHistory(sessionId: string): Promise<HistoryEntry[]>
```

`getHistory` returns the full stream via `XRANGE ... - +`. This is what powers the scrub-bar replay in the UI — pure Redis reads, no LLM calls.

### 3e. `redis/session.ts` — Session Store

```
Key:   lc:session:{sessionId}  (Redis Hash)
Fields: inputText, controlsJson, activeValuesJson, outputText, createdAt, updatedAt
TTL:   24h
```

**API to implement:**
```typescript
createSession(state: Partial<LiquidAgentState>): Promise<string>  // returns sessionId
updateSession(sessionId: string, patch: Partial<LiquidAgentState>): Promise<void>
getSession(sessionId: string): Promise<LiquidAgentState | null>
```

Session ID generation: `crypto.randomBytes(6).toString('base64url')` — 8 chars, URL-safe, no dependency needed.

---

## Phase 4 — Agent Nodes

### 4a. `nodes/analyst.ts`

This node runs when `inputText` is set and `controls` is null.

**Flow:**
1. Embed `inputText` with `text-embedding-3-small`
2. Check semantic cache → if hit, return cached `ControlSchema` immediately (no Claude call)
3. Call Claude with the rigid analyst prompt
4. Parse + validate with `ControlSchemaSchema.parse()`
5. If Zod throws, retry once with an appended "fix your JSON" message
6. Store result in vector index
7. Return `{ controls: parsed, activeValues: defaultsFromSchema }`

**The Analyst system prompt** (this is the most important string in the project — iterate on it):
```
You are a text analyst. Your only job is to identify the latent variables of the text the user provides.

Output ONLY a JSON object. No explanation. No markdown. No code fences. Raw JSON only.

Schema:
{
  "scalars": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence.", "default": 50 }
  ],
  "toggles": [
    { "id": "snake_case_id", "label": "Display Name", "description": "One sentence.", "default": false }
  ]
}

Rules:
- 3 to 5 scalars. 2 to 3 toggles. No more, no less.
- Names must be SPECIFIC to this exact text. Never generic.
- BAD: "Tone", "Length", "Formality". GOOD: "Blame Assignment", "Passive Aggressive", "Closure Velocity".
- Each variable must, if changed, meaningfully alter the content in a surprising way.
- The "default" for scalars reflects where this text currently sits (0=none, 100=maximum).
```

### 4b. `nodes/rewriter.ts`

This node runs when `activeValues` changes (debounced at the frontend).

**Flow:**
1. Hash `inputText` + `activeValues` → check KV cache
2. If cache hit → return cached output immediately
3. Call Claude with the rewriter prompt + current values injected
4. Store result in KV cache
5. Append to sculpting history stream
6. Update session hash
7. Return `{ outputText: rewritten }`

**The Rewriter system prompt:**
```
Rewrite the text below. Apply the parameters exactly as specified.
Return ONLY the rewritten text. No explanation, no commentary, no quotes.

Parameters:
{{scalars}}
{{toggles}}

Original text:
{{inputText}}
```

Inject scalar values as `"Label": 85%` and active toggles as `"Label": ON`.

---

## Phase 5 — Graph (Rewrite `agent.ts`)

**Two nodes, conditional routing:**

```
[START]
   │
   ▼
[router] ──── controls is null + inputText set ────► [analyst_node]
   │                                                        │
   └──── controls set + activeValues changed ──► [rewriter_node]
                                                            │
                                                          [END]
```

**Routing function:**
```typescript
function router(state: AgentState): "analyst_node" | "rewriter_node" | "__end__" {
  if (state.inputText && !state.controls) return "analyst_node";
  if (state.controls && Object.keys(state.activeValues).length > 0) return "rewriter_node";
  return "__end__";
}
```

**Triggering the graph from the frontend:** LangGraph runs when CopilotKit sends a request. Since there's no chat input, trigger agent runs programmatically using `useCopilotChat`'s `appendMessage` from the frontend — a hidden no-op message (`role: "user", content: "__trigger__"`). The agent ignores message content and acts purely on state. Use this to trigger both the Analyst (on paste) and Rewriter (debounced slider moves).

Replace `MemorySaver` with a proper persistent checkpointer if deploying to LangGraph Cloud. For local dev, `MemorySaver` is fine.

Change `graphId` in `route.ts` from `"starterAgent"` to `"liquidAgent"`. Update `agent` prop in `layout.tsx` to match.

---

## Phase 6 — Web: Cleanup

**Modify `apps/web/src/app/layout.tsx`:**
- Remove `import "@copilotkit/react-ui/styles.css"` (no sidebar, no need)
- Change `agent="starterAgent"` → `agent="liquidAgent"`
- Update `<title>` and `<meta>` description

**Modify `apps/web/src/app/api/copilotkit/route.ts`:**
- Change `starterAgent:` key → `liquidAgent:`
- Change `graphId: "starterAgent"` → `graphId: "liquidAgent"`

**Replace `apps/web/src/app/page.tsx`** entirely. Remove all demo components.

---

## Phase 7 — Web: Components

### `components/Dial.tsx`

A styled range input for scalar controls (0–100).

Props: `id`, `label`, `description`, `value: number`, `onChange: (id: string, value: number) => void`

Key detail: debounce `onChange` by **300ms** at the call site (in ControlPanel), not inside Dial. Dial should be dumb and fast. The debounce is on the agent trigger, not the visual update — the slider should move instantly while the rewrite request fires 300ms after the user stops dragging.

### `components/Toggle.tsx`

Props: `id`, `label`, `description`, `value: boolean`, `onChange: (id: string, value: boolean) => void`

### `components/ControlPanel.tsx`

Receives `controls: ControlSchema` and `activeValues: ActiveValues`.
Renders `controls.scalars.map(s => <Dial .../>)` and `controls.toggles.map(t => <Toggle .../>)`.

Owns the debounce logic. When any control changes, batch the update to `activeValues` via `setState`, then fire the `__trigger__` message after the debounce settles.

**The appearance animation** lives here. Use a CSS class that triggers on mount:

```css
/* globals.css */
@keyframes shatter-in {
  0%   { opacity: 0; transform: scale(0.92) translateY(8px); filter: blur(4px); }
  60%  { opacity: 1; transform: scale(1.01) translateY(-2px); filter: blur(0); }
  100% { transform: scale(1) translateY(0); }
}

.control-panel-enter {
  animation: shatter-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
```

Apply `.control-panel-enter` to each control with a staggered `animation-delay` (`index * 60ms`) so they cascade in.

### `components/GlassPane.tsx`

Two modes: **input** (empty state, textarea for pasting) and **output** (displays `outputText`, transitions on change).

When `outputText` changes, apply a brief fade-through: opacity 0 → 1 over 200ms. This makes text morphing feel smooth without an animation library.

---

## Phase 8 — Web: Main Page

**`apps/web/src/app/page.tsx`** — the entire product lives here.

```typescript
"use client";

// State machine: EMPTY → ANALYZING → SCULPTING
type Phase = "empty" | "analyzing" | "sculpting";
```

**useCoAgent** connects to `"liquidAgent"` with initial state matching `LiquidAgentState`.

**useCopilotChat** — used only for `appendMessage` to trigger agent runs. Never render the chat UI.

**Derived phase:**
```typescript
const phase: Phase =
  !state.inputText ? "empty" :
  !state.controls  ? "analyzing" :
  "sculpting";
```

**On paste handler:**
1. `setState({ inputText: pasted, controls: null, activeValues: {}, outputText: '' })`
2. Create/update session: `POST /api/session` → get `sessionId`
3. Push `sessionId` to URL: `window.history.pushState({}, '', '/' + sessionId)`
4. `appendMessage({ role: 'user', content: '__trigger__' })` → agent runs analyst

**On activeValues change** (from ControlPanel):
1. `setState({ activeValues: newValues })`
2. Debounced `appendMessage` → agent runs rewriter

**Layout:** full-screen, two-column when in `sculpting` phase:
- Left: GlassPane (input/output text, ~60% width)
- Right: ControlPanel (controls, ~40% width, slides in when phase becomes `sculpting`)

---

## Phase 9 — Session API

**`apps/web/src/app/api/session/[id]/route.ts`**

```typescript
// GET  /api/session/[id]  → return session state from Redis (for collaboration polling)
// POST /api/session/[id]  → upsert session state to Redis
```

Both routes use `@upstash/redis` via the client from... note: the web app has its own Redis client instance (same env vars, separate import). Do not import from `apps/agent`.

**Session hydration on page load** (in `page.tsx`):
```typescript
// If URL has a sessionId segment:
useEffect(() => {
  const id = window.location.pathname.slice(1);
  if (!id) return;
  fetch(`/api/session/${id}`)
    .then(r => r.json())
    .then(session => setState(session));   // rehydrates full cockpit
}, []);
```

**Collaboration polling** (optional, for the demo moment):
```typescript
useEffect(() => {
  if (!sessionId || phase !== 'sculpting') return;
  const interval = setInterval(async () => {
    const res = await fetch(`/api/session/${sessionId}`);
    const remote = await res.json();
    if (remote.updatedAt > localUpdatedAt) {
      setState(remote);
    }
  }, 500);
  return () => clearInterval(interval);
}, [sessionId, phase]);
```

---

## Phase 10 — Replay Feature

**`components/ReplayBar.tsx`** — only renders in `sculpting` phase.

On mount, `GET /api/session/${sessionId}/history` → returns the sculpting stream from Redis.

The scrub bar is a range input from 0 to `history.length - 1`. On change, display `history[index].outputSnapshot` directly in GlassPane — no LLM, no network, pure array access.

**API route `apps/web/src/app/api/session/[id]/history/route.ts`:**
```typescript
// GET /api/session/[id]/history
// → redis.xrange(`lc:session:${id}:history`, '-', '+')
// → return array of { controlId, value, outputSnapshot, timestamp }
```

---

## Build Order

Follow this sequence to avoid broken imports at each step:

```
1.  apps/agent/src/types.ts
2.  apps/agent/src/state.ts
3.  apps/agent/src/redis/client.ts
4.  apps/agent/src/redis/timemachine.ts
5.  apps/agent/src/redis/semantic.ts
6.  apps/agent/src/redis/streams.ts
7.  apps/agent/src/redis/session.ts
8.  apps/agent/src/nodes/analyst.ts
9.  apps/agent/src/nodes/rewriter.ts
10. apps/agent/src/agent.ts             (rewrite)
11. apps/web/src/app/api/copilotkit/route.ts  (rename agent)
12. apps/web/src/app/layout.tsx               (rename agent)
13. apps/web/src/components/Dial.tsx
14. apps/web/src/components/Toggle.tsx
15. apps/web/src/components/GlassPane.tsx
16. apps/web/src/components/ControlPanel.tsx
17. apps/web/src/app/globals.css              (add animations)
18. apps/web/src/app/page.tsx                 (full rewrite)
19. apps/web/src/app/api/session/[id]/route.ts
20. apps/web/src/components/ReplayBar.tsx
21. apps/web/src/app/api/session/[id]/history/route.ts
```

---

## Key Decisions & Gotchas

**The analyst prompt is the product.** Spend 30% of your time here. Test it with 10 different inputs. If it ever returns "Tone" or "Length", the prompt has failed. Keep tightening until it surprises you every time.

**Quantized cache lookup.** When checking the KV cache on slider drag, round the slider value to the nearest 10 before hashing. This means slider position 73 checks the cache for 70, not 73. Cache hits are far more frequent; the live result replaces it when it arrives.

**`controls: null` as the reset signal.** When the user pastes new text, set `controls: null` before setting `inputText`. This is what tells the router to run the Analyst, not the Rewriter. Order matters.

**Don't store the full `outputText` in the Stream entry.** For the sculpting history, only store the output if it differs from the previous entry. Add a quick string equality check before `XADD` to avoid filling the stream with duplicate snapshots from rapid slider moves.

**Two Redis clients, same credentials.** The agent (`apps/agent`) and the web (`apps/web`) each instantiate their own `@upstash/redis` client pointing at the same Upstash database. This is correct. Do not try to share a singleton across apps — they're separate processes.

**Agent name consistency.** The string `"liquidAgent"` appears in three places: `agent.ts` (exported graph name via LangGraph CLI config), `route.ts` (the `agents:` key and `graphId`), and `layout.tsx` (`agent=` prop on `<CopilotKit>`). All three must match exactly or nothing connects.

**LangGraph CLI graph registration.** The CLI picks up exported graphs by name from `src/agent.ts`. The export must be named `graph`. The `graphId` in `route.ts` maps to the graph's registered name in the LangGraph server — confirm this in `langgraph.json` if it exists.
