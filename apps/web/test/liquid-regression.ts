import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { LiquidRequestCoordinator } from "../src/lib/liquid/request-coordinator";
import {
  buildCommittedRewriteArtifacts,
  hydrateClientState,
} from "../src/lib/liquid/session-model";
import { analyzeInput } from "../src/server/liquid/analyst";
import { buildRewritePrompt } from "../src/server/liquid/prompts";
import { ControlSchemaSchema } from "../src/server/liquid/schema";

async function testSchemaValidation() {
  const valid = ControlSchemaSchema.parse({
    scalars: [
      {
        id: "blame_assignment",
        label: "Blame Assignment",
        description: "How much fault the speaker assigns.",
        default: 60,
      },
      {
        id: "closure_velocity",
        label: "Closure Velocity",
        description: "How decisively the text closes the loop.",
        default: 70,
      },
      {
        id: "door_left_open",
        label: "Door Left Open",
        description: "How much room remains for a future reply.",
        default: 25,
      },
    ],
    toggles: [
      {
        id: "passive_aggressive",
        label: "Passive Aggressive",
        description: "Whether the text slips in side-eye.",
        default: false,
      },
      {
        id: "soft_landing",
        label: "Soft Landing",
        description: "Whether the ending cushions the blow.",
        default: true,
      },
    ],
  });

  assert.equal(valid.scalars.length, 3);

  assert.throws(() => {
    ControlSchemaSchema.parse({
      scalars: [
        {
          id: "tone",
          label: "Tone",
          description: "Generic label that should fail.",
          default: 50,
        },
        {
          id: "detail",
          label: "Detail",
          description: "Generic label that should fail.",
          default: 50,
        },
        {
          id: "length",
          label: "Length",
          description: "Generic label that should fail.",
          default: 50,
        },
      ],
      toggles: [
        {
          id: "clarity",
          label: "Clarity",
          description: "Generic label that should fail.",
          default: false,
        },
        {
          id: "style",
          label: "Style",
          description: "Generic label that should fail.",
          default: false,
        },
      ],
    });
  });
}

async function testAnalystRetry() {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  process.env.OPENAI_API_KEY = "test-key";
  process.env.LIQUID_ANALYST_MODEL = "gpt-5.4";

  globalThis.fetch = async () => {
    callCount += 1;

    const outputText =
      callCount === 1
        ? JSON.stringify({
            scalars: [
              {
                id: "tone",
                label: "Tone",
                description: "Too generic.",
                default: 50,
              },
              {
                id: "length",
                label: "Length",
                description: "Too generic.",
                default: 50,
              },
              {
                id: "detail",
                label: "Detail",
                description: "Too generic.",
                default: 50,
              },
            ],
            toggles: [
              {
                id: "clarity",
                label: "Clarity",
                description: "Too generic.",
                default: false,
              },
              {
                id: "style",
                label: "Style",
                description: "Too generic.",
                default: false,
              },
            ],
          })
        : JSON.stringify({
            scalars: [
              {
                id: "blame_assignment",
                label: "Blame Assignment",
                description: "How much fault the speaker assigns.",
                default: 60,
              },
              {
                id: "closure_velocity",
                label: "Closure Velocity",
                description: "How decisively the text closes the loop.",
                default: 70,
              },
              {
                id: "door_left_open",
                label: "Door Left Open",
                description: "How much room remains for a future reply.",
                default: 25,
              },
            ],
            toggles: [
              {
                id: "passive_aggressive",
                label: "Passive Aggressive",
                description: "Whether the text slips in side-eye.",
                default: false,
              },
              {
                id: "soft_landing",
                label: "Soft Landing",
                description: "Whether the ending cushions the blow.",
                default: true,
              },
            ],
          });

    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: outputText }],
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const result = await analyzeInput("We need to talk.");
    assert.equal(callCount, 2);
    assert.equal(result.controls.scalars[0]?.label, "Blame Assignment");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRewritePromptShaping() {
  const prompt = buildRewritePrompt(
    "Original text",
    {
      scalars: [
        {
          id: "blame_assignment",
          label: "Blame Assignment",
          description: "How much blame to assign.",
          default: 40,
        },
        {
          id: "closure_velocity",
          label: "Closure Velocity",
          description: "How hard the ending closes.",
          default: 75,
        },
        {
          id: "door_left_open",
          label: "Door Left Open",
          description: "How much future contact remains possible.",
          default: 20,
        },
      ],
      toggles: [
        {
          id: "passive_aggressive",
          label: "Passive Aggressive",
          description: "Whether it carries side-eye.",
          default: false,
        },
        {
          id: "soft_landing",
          label: "Soft Landing",
          description: "Whether it cushions the ending.",
          default: true,
        },
      ],
    },
    {
      blame_assignment: 85,
      closure_velocity: 10,
      door_left_open: 0,
      passive_aggressive: true,
      soft_landing: false,
    },
  );

  assert.match(prompt, /Blame Assignment: 85%/);
  assert.match(prompt, /Passive Aggressive: ON/);
  assert.match(prompt, /Soft Landing: OFF/);
  assert.match(prompt, /Original text/);
}

async function testRequestCoordinatorSemantics() {
  const debounceExecutions: string[] = [];
  const debounceCommits: string[] = [];
  const debouncedCoordinator = new LiquidRequestCoordinator<string, string>({
    delayMs: 25,
    execute: async (payload) => {
      debounceExecutions.push(payload);
      return payload;
    },
    onCommit: async (payload) => {
      debounceCommits.push(payload);
    },
  });

  debouncedCoordinator.schedule("first");
  await sleep(5);
  debouncedCoordinator.schedule("second");
  await sleep(60);
  debouncedCoordinator.dispose();

  assert.deepEqual(debounceExecutions, ["second"]);
  assert.deepEqual(debounceCommits, ["second"]);

  const committed: string[] = [];
  const aborted: string[] = [];

  const latestCoordinator = new LiquidRequestCoordinator<string, string>({
    delayMs: 0,
    execute: async (payload, { signal }) => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), payload === "slow" ? 40 : 5);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            aborted.push(payload);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });

      return payload;
    },
    onCommit: async (payload) => {
      committed.push(payload);
    },
  });

  latestCoordinator.runNow("slow");
  await sleep(5);
  latestCoordinator.runNow("fast");
  await sleep(60);
  latestCoordinator.dispose();

  assert.deepEqual(aborted, ["slow"]);
  assert.deepEqual(committed, ["fast"]);
}

async function testHydrationAndHistoryArtifacts() {
  const hydrated = hydrateClientState(
    {
      inputText: "hello",
      controls: null,
      activeValues: { blame_assignment: 50 },
      outputText: "hello again",
      createdAt: "1000",
    },
    "session-1",
  );

  assert.equal(hydrated.sessionId, "session-1");
  assert.equal(hydrated.createdAt, "1000");

  const initial = buildCommittedRewriteArtifacts({
    currentSessionId: "session-1",
    rootSessionId: "session-1",
    inputText: "hello",
    controls: {
      scalars: [
        {
          id: "blame_assignment",
          label: "Blame Assignment",
          description: "desc",
          default: 50,
        },
        {
          id: "closure_velocity",
          label: "Closure Velocity",
          description: "desc",
          default: 50,
        },
        {
          id: "door_left_open",
          label: "Door Left Open",
          description: "desc",
          default: 50,
        },
      ],
      toggles: [
        {
          id: "passive_aggressive",
          label: "Passive Aggressive",
          description: "desc",
          default: false,
        },
        {
          id: "soft_landing",
          label: "Soft Landing",
          description: "desc",
          default: false,
        },
      ],
    },
    activeValues: { blame_assignment: 50 },
    outputText: "first rewrite",
    isInitialCommit: true,
    currentCreatedAt: "1000",
    change: null,
    now: 2000,
  });

  assert.equal(initial.nextSessionId, "session-1");
  assert.equal(initial.sessionPayload.createdAt, "1000");
  assert.equal(initial.historyEntry.controlId, "__initial__");

  const child = buildCommittedRewriteArtifacts({
    currentSessionId: "session-1",
    rootSessionId: "root-1",
    inputText: "hello",
    controls: initial.sessionPayload.controls!,
    activeValues: { blame_assignment: 80 },
    outputText: "second rewrite",
    isInitialCommit: false,
    change: { controlId: "blame_assignment", value: 80 },
    makeId: () => "session-2",
    now: 3000,
  });

  assert.equal(child.nextSessionId, "session-2");
  assert.equal(child.historySessionId, "root-1");
  assert.equal(child.sessionPayload.parentSessionId, "session-1");
  assert.equal(child.historyEntry.controlId, "blame_assignment");
}

const tests: Array<[string, () => Promise<void>]> = [
  ["schema validation", testSchemaValidation],
  ["analyst retry", testAnalystRetry],
  ["rewrite prompt shaping", testRewritePromptShaping],
  ["request coordinator semantics", testRequestCoordinatorSemantics],
  ["hydration and history artifacts", testHydrationAndHistoryArtifacts],
];

let failures = 0;

for (const [name, test] of tests) {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}
