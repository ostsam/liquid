"use client";

import { useCoAgent, useCopilotChatInternal } from "@copilotkit/react-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPane } from "@/components/GlassPane";
import { ControlPanel } from "@/components/ControlPanel";
import { ReplayBar } from "@/components/ReplayBar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScalarControl {
  id: string;
  label: string;
  description: string;
  default: number;
}

interface ToggleControl {
  id: string;
  label: string;
  description: string;
  default: boolean;
}

interface ControlSchema {
  scalars: ScalarControl[];
  toggles: ToggleControl[];
}

type ActiveValues = Record<string, number | boolean>;

interface LiquidAgentState {
  inputText: string;
  controls: ControlSchema | null;
  activeValues: ActiveValues;
  outputText: string;
  sessionId: string;
}

type Phase = "empty" | "analyzing" | "sculpting";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LiquidPage() {
  const { state, setState } = useCoAgent<LiquidAgentState>({
    name: "liquidAgent",
    initialState: {
      inputText: "",
      controls: null,
      activeValues: {},
      outputText: "",
      sessionId: "",
    },
  });

  // useCoAgent returns `run: agent.runAgent` as an UNBOUND prototype method.
  // Calling run() standalone sets this=undefined and throws on this.abortController.
  // useCopilotChatInternal exposes the actual agent instance so we can call
  // agent.runAgent() as a proper method call (this=agent), which is how
  // CopilotKit's own internal chat UI triggers runs.
  const { agent } = useCopilotChatInternal();

  const sessionIdRef = useRef<string>("");
  const collaborationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // When the user scrubs the replay bar, show the snapshot instead of live outputText
  const [replayText, setReplayText] = useState<string | null>(null);

  // ── Derived phase ─────────────────────────────────────────────────────────

  const phase: Phase = !state.inputText
    ? "empty"
    : !state.controls
    ? "analyzing"
    : "sculpting";

  // ── Reactive agent trigger ────────────────────────────────────────────────
  // Trigger the agent when entering the "analyzing" phase (new text pasted, no
  // controls yet). The useEffect ensures React has committed the state before
  // we hit the CopilotKit runtime.
  const prevPhaseRef = useRef<Phase>("empty");
  useEffect(() => {
    if (phase === "analyzing" && prevPhaseRef.current !== "analyzing") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agent as any)?.runAgent();
    }
    prevPhaseRef.current = phase;
  }, [phase, agent]);

  // ── Session management ───────────────────────────────────────────────────

  // Hydrate from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (!sid) return;

    fetch(`/api/session/${sid}`)
      .then((r) => r.json())
      .then((session: Partial<LiquidAgentState>) => {
        if (session.inputText) {
          sessionIdRef.current = sid;
          setState({
            inputText: session.inputText ?? "",
            controls: session.controls ?? null,
            activeValues: session.activeValues ?? {},
            outputText: session.outputText ?? "",
            sessionId: sid,
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collaboration polling: sync outputText from other users on same session
  useEffect(() => {
    if (phase !== "sculpting" || !sessionIdRef.current) {
      if (collaborationPollRef.current) {
        clearInterval(collaborationPollRef.current);
        collaborationPollRef.current = null;
      }
      return;
    }

    const sid = sessionIdRef.current;
    let lastUpdatedAt = 0;

    collaborationPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/session/${sid}`);
        const remote = (await res.json()) as Partial<LiquidAgentState> & {
          updatedAt?: string;
        };
        const remoteTs = Number(remote.updatedAt ?? 0);
        if (remoteTs > lastUpdatedAt && remote.outputText) {
          lastUpdatedAt = remoteTs;
          setState((prev) => ({
            inputText: prev?.inputText ?? "",
            controls: prev?.controls ?? null,
            activeValues: prev?.activeValues ?? {},
            outputText: remote.outputText ?? prev?.outputText ?? "",
            sessionId: prev?.sessionId ?? "",
          }));
        }
      } catch {
        // Ignore polling failures
      }
    }, 500);

    return () => {
      if (collaborationPollRef.current) {
        clearInterval(collaborationPollRef.current);
        collaborationPollRef.current = null;
      }
    };
  }, [phase, setState]);

  // ── Paste handler ─────────────────────────────────────────────────────────

  const handlePaste = useCallback(
    async (text: string) => {
      // Generate a short URL-safe session ID
      const sid =
        Math.random().toString(36).slice(2, 8) +
        Math.random().toString(36).slice(2, 6);
      sessionIdRef.current = sid;

      // controls: null is the signal that makes the router run the analyst
      setState({
        inputText: text,
        controls: null,
        activeValues: {},
        outputText: "",
        sessionId: sid,
      });

      // Push session to URL (enables shareable link + hydration)
      window.history.pushState({}, "", `?session=${sid}`);

      // Create session in Redis (non-blocking)
      fetch(`/api/session/${sid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: text,
          controls: null,
          activeValues: {},
          outputText: "",
        }),
      }).catch(() => {});

      // Agent is triggered reactively by the phase→"analyzing" effect above
    },
    [setState]
  );

  // ── Control change handler (ControlPanel manages the debounce) ────────────

  const handleValuesChange = useCallback(
    (newValues: ActiveValues) => {
      setState((prev) => ({
      inputText: prev?.inputText ?? "",
      controls: prev?.controls ?? null,
      activeValues: newValues,
      outputText: prev?.outputText ?? "",
      sessionId: prev?.sessionId ?? "",
    }));
    },
    [setState]
  );

  const handleTriggerAgent = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent as any)?.runAgent();
  }, [agent]);

  // ── Reset handler ─────────────────────────────────────────────────────────

  const handleReset = useCallback(
    (existingText: string) => {
      // Re-paste the same text to force analyst re-run
      handlePaste(existingText);
    },
    [handlePaste]
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#080810] relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-8 py-6 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-violet-400" />
          <span className="text-sm font-mono text-white/40 tracking-widest uppercase">
            Liquid Control
          </span>
          {phase === "sculpting" && sessionIdRef.current && (
            <button
              onClick={() => {
                navigator.clipboard
                  .writeText(window.location.href)
                  .catch(() => {});
              }}
              className="ml-auto text-xs font-mono text-white/25 hover:text-white/50 transition-colors"
            >
              Copy session link
            </button>
          )}
        </header>

        {/* Main content */}
        <div
          className={[
            "flex-1 px-8 pb-8 transition-all duration-500",
            phase === "sculpting"
              ? "grid gap-6 items-start"
              : "flex items-center justify-center",
          ].join(" ")}
          style={
            phase === "sculpting"
              ? { gridTemplateColumns: "1fr 380px" }
              : undefined
          }
        >
          {/* Left / center: GlassPane + ReplayBar */}
          <div
            className={[
              "flex flex-col gap-4",
              phase !== "sculpting" ? "w-full max-w-2xl" : "",
            ].join(" ")}
          >
            <GlassPane
              phase={phase}
              inputText={state.inputText}
              outputText={replayText ?? state.outputText}
              onPaste={handleReset}
            />
            {phase === "sculpting" && sessionIdRef.current && (
              <ReplayBar
                sessionId={sessionIdRef.current}
                onReplay={(snapshot) => setReplayText(snapshot)}
                onExitReplay={() => setReplayText(null)}
              />
            )}
          </div>

          {/* Right: ControlPanel (only in sculpting phase) */}
          {phase === "sculpting" && state.controls && (
            <div className="panel-slide-in sticky top-8">
              <ControlPanel
                controls={state.controls}
                activeValues={state.activeValues}
                onValuesChange={handleValuesChange}
                onTriggerAgent={handleTriggerAgent}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
