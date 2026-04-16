# Liquid

Liquid is a single-app Next.js project that turns pasted text into a bespoke control surface.
The app analyzes the input, generates text-specific sliders/toggles, and rewrites the text with GPT based on the current control state.

## Architecture

The repo is now web-only:

```text
apps/
  web/   Next.js 16 app router app
```

Key runtime pieces:

- `apps/web/src/app/page.tsx`
  Plain React client state plus a single rewrite request coordinator
- `apps/web/src/server/liquid/*`
  GPT prompts, schema validation, OpenAI calls, and Redis-backed persistence helpers
- `apps/web/src/app/api/analyze/route.ts`
  Control-schema generation for pasted text
- `apps/web/src/app/api/rewrite/route.ts`
  Current-state rewrite generation only
- `apps/web/src/app/api/session/[id]/*`
  Session persistence, replay history, and version-tree APIs

Removed from the active architecture:

- CopilotKit
- LangChain / LangGraph
- Python agent server
- speculative rewrite pre-generation

## Requirements

- Node.js 18+
- pnpm 9+
- `OPENAI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional model overrides:

- `LIQUID_ANALYST_MODEL`
- `LIQUID_REWRITER_MODEL`

## Development

Install dependencies:

```bash
pnpm install
```

Run the app:

```bash
pnpm dev
```

Run the web app directly:

```bash
pnpm --filter web dev
```

## Verification

Regression checks:

```bash
pnpm --filter web test
```

Production build:

```bash
pnpm --filter web exec next build --webpack
```

## Notes

- Rewrites are generated only for the currently requested control state.
- Shared sessions and replay history are persisted in Upstash Redis.
- The current route/test coverage protects the client coordinator invariants and the session/history persistence contract.
