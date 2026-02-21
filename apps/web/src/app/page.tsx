"use client";

import { useCoAgent, useCopilotChatInternal } from "@copilotkit/react-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassPane } from "@/components/GlassPane";
import { ControlPanel } from "@/components/ControlPanel";
import { ReplayBar } from "@/components/ReplayBar";
import { VersionTree } from "@/components/VersionTree";

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

function makeSessionId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

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

  const { agent } = useCopilotChatInternal();

  const sessionIdRef = useRef<string>("");
  const collaborationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [rootSessionId, setRootSessionId] = useState<string>("");
  const [replayText, setReplayText] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);

  // Pre-fetched tree data — populated on button hover so it's ready before mount
  const [prefetchedSessions, setPrefetchedSessions] = useState<unknown[] | null>(null);
  const prefetchingRef = useRef(false);

  // Invalidate pre-fetched data whenever the active session changes (new rewrite = new node in tree)
  useEffect(() => {
    setPrefetchedSessions(null);
    prefetchingRef.current = false;
  }, [state.sessionId]);

  // Holds session fetched from URL — separate from CopilotKit state so we can
  // reapply it if CopilotKit's backend sync overwrites our hydration.
  type UrlSession = Partial<LiquidAgentState> & { rootSessionId?: string; _sid: string };
  const [urlSession, setUrlSession] = useState<UrlSession | null>(null);

  // ── Derived phase ─────────────────────────────────────────────────────────

  const phase: Phase = !state.inputText
    ? "empty"
    : !state.controls
    ? "analyzing"
    : "sculpting";

  // ── Reactive agent trigger ────────────────────────────────────────────────

  const prevPhaseRef = useRef<Phase>("empty");
  useEffect(() => {
    if (phase === "analyzing" && prevPhaseRef.current !== "analyzing") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (agent as any)?.runAgent();
    }
    prevPhaseRef.current = phase;
  }, [phase, agent]);

  // ── Session hydration from URL ────────────────────────────────────────────
  // Two-effect strategy:
  //  1. Fetch eagerly on mount — no dependency on agent readiness.
  //  2. Apply to CopilotKit state whenever the agent is ready AND the
  //     CopilotKit state is still empty (guards against CopilotKit's own
  //     backend-sync overwriting an earlier hydration attempt).

  // Effect 1: fetch
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (!sid) return;

    fetch(`/api/session/${sid}`)
      .then((r) => r.json())
      .then((session: Partial<LiquidAgentState> & { rootSessionId?: string }) => {
        if (session.inputText) {
          setUrlSession({ ...session, _sid: sid });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: apply once agent is ready and CopilotKit state is still empty
  useEffect(() => {
    if (!urlSession || !agent || state.inputText) return;

    const { _sid: sid, ...session } = urlSession;
    sessionIdRef.current = sid;
    setRootSessionId(session.rootSessionId ?? sid);
    setState({
      inputText: session.inputText ?? "",
      controls: session.controls ?? null,
      activeValues: session.activeValues ?? {},
      outputText: session.outputText ?? "",
      sessionId: sid,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSession, agent, state.inputText]);

  // ── Collaboration polling ─────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "sculpting") {
      if (collaborationPollRef.current) {
        clearInterval(collaborationPollRef.current);
        collaborationPollRef.current = null;
      }
      return;
    }

    let lastSid = "";
    let lastUpdatedAt = 0;

    collaborationPollRef.current = setInterval(async () => {
      const sid = sessionIdRef.current; // read fresh every tick — never stale
      if (!sid) return;
      if (sid !== lastSid) {
        lastSid = sid;
        lastUpdatedAt = 0; // reset timestamp when session changes
      }
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
        // ignore
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
      // "New paste" button passes the current inputText back — treat as a reset
      if (state.controls && text === state.inputText) {
        sessionIdRef.current = "";
        setRootSessionId("");
        setReplayText(null);
        setShowTree(false);
        setUrlSession(null);
        setState({ inputText: "", controls: null, activeValues: {}, outputText: "", sessionId: "" });
        window.history.pushState({}, "", "/");
        return;
      }

      const sid = makeSessionId();
      sessionIdRef.current = sid;
      setRootSessionId(sid);
      setReplayText(null);
      setShowTree(false);

      setUrlSession(null); // new paste supersedes any URL-loaded session
      setState({
        inputText: text,
        controls: null,
        activeValues: {},
        outputText: "",
        sessionId: sid,
      });

      window.history.pushState({}, "", `?session=${sid}`);

      fetch(`/api/session/${sid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: text,
          controls: null,
          activeValues: {},
          outputText: "",
          rootSessionId: sid,
          parentSessionId: null,
          createdAt: Date.now().toString(),
        }),
      }).catch(() => {});
    },
    [setState]
  );

  // ── Control changes ───────────────────────────────────────────────────────

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
    // Each user-triggered rewrite automatically becomes a new child version.
    // Advance sessionId BEFORE calling runAgent() so the rewriter writes
    // its output directly into the new child session, not the parent.
    const parentSid = sessionIdRef.current;
    if (parentSid) {
      const rootId = rootSessionId || parentSid;
      const childSid = makeSessionId();

      sessionIdRef.current = childSid;
      setUrlSession(null);

      fetch(`/api/session/${childSid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputText: state.inputText,
          controls: state.controls,
          activeValues: state.activeValues,
          outputText: "",
          rootSessionId: rootId,
          parentSessionId: parentSid,
          createdAt: Date.now().toString(),
        }),
      }).catch(() => {});

      setState((prev) => ({ ...prev, sessionId: childSid } as LiquidAgentState));
      window.history.replaceState({}, "", `?session=${childSid}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent as any)?.runAgent();
  }, [agent, rootSessionId, state.inputText, state.controls, state.activeValues, setState]);

  // ── Fork ──────────────────────────────────────────────────────────────────

  const handleFork = useCallback(async () => {
    const parentSid = sessionIdRef.current;
    const rootId = rootSessionId || parentSid;
    const newSid = makeSessionId();

    await fetch(`/api/session/${newSid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText: state.inputText,
        controls: state.controls,
        activeValues: state.activeValues,
        outputText: state.outputText,
        rootSessionId: rootId,
        parentSessionId: parentSid,
        createdAt: Date.now().toString(),
      }),
    }).catch(() => {});

    sessionIdRef.current = newSid;
    setRootSessionId(rootId);
    setReplayText(null);
    setUrlSession(null);

    setState((prev) => ({
      inputText: prev?.inputText ?? "",
      controls: prev?.controls ?? null,
      activeValues: prev?.activeValues ?? {},
      outputText: prev?.outputText ?? "",
      sessionId: newSid,
    }));

    window.history.pushState({}, "", `?session=${newSid}`);
  }, [state, rootSessionId, setState]);

  // ── Navigate to a session from the tree ──────────────────────────────────

  const handleNavigateToSession = useCallback(
    async (targetSessionId: string, cachedSession?: unknown) => {
      try {
        const session = cachedSession
          ? (cachedSession as Partial<LiquidAgentState> & { rootSessionId?: string })
          : ((await fetch(`/api/session/${targetSessionId}`).then((r) =>
              r.json()
            )) as Partial<LiquidAgentState> & { rootSessionId?: string });
        if (session.inputText) {
          sessionIdRef.current = targetSessionId;
          setRootSessionId(session.rootSessionId ?? targetSessionId);
          setReplayText(null);
          setShowTree(false); // zoom back in
          setUrlSession(null); // navigating away from URL-loaded session
          setState({
            inputText: session.inputText ?? "",
            controls: session.controls ?? null,
            activeValues: session.activeValues ?? {},
            outputText: session.outputText ?? "",
            sessionId: targetSessionId,
          });
          window.history.pushState({}, "", `?session=${targetSessionId}`);
        }
      } catch {
        // ignore
      }
    },
    [setState]
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
            <div className="ml-auto flex items-center gap-4">
              {/* Version tree icon */}
              <button
                onClick={() => setShowTree((v) => !v)}
                onMouseEnter={() => {
                  const rootId = rootSessionId || sessionIdRef.current;
                  if (!rootId || prefetchingRef.current || prefetchedSessions) return;
                  prefetchingRef.current = true;
                  fetch(`/api/tree/${rootId}`)
                    .then((r) => r.json())
                    .then((data) => setPrefetchedSessions(data))
                    .catch(() => { prefetchingRef.current = false; });
                }}
                title="Version tree"
                className={[
                  "transition-colors",
                  showTree
                    ? "text-violet-400"
                    : "text-white/25 hover:text-violet-400/70",
                ].join(" ")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="2.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="4" cy="13.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="14" cy="13.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="9" y1="4.5" x2="9" y2="7" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="9" y1="11" x2="4" y2="11.5" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="9" y1="11" x2="14" y2="11.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>

              <button
                onClick={() =>
                  navigator.clipboard.writeText(window.location.href).catch(() => {})
                }
                className="text-xs font-mono text-white/25 hover:text-white/50 transition-colors"
              >
                copy link
              </button>
            </div>
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
          {/* Left column: output panel ↔ version tree (same space, clean swap) */}
          <div
            className={[
              "flex flex-col gap-4",
              phase !== "sculpting" ? "w-full max-w-2xl" : "",
            ].join(" ")}
          >
            {showTree && phase === "sculpting" ? (
              // The output panel zooms out to become the version tree canvas
              <VersionTree
                rootSessionId={rootSessionId || sessionIdRef.current}
                currentSessionId={state.sessionId}
                onNavigate={handleNavigateToSession}
                onFork={handleFork}
                onClose={() => setShowTree(false)}
                initialSessions={prefetchedSessions}
              />
            ) : (
              <>
                <GlassPane
                  phase={phase}
                  inputText={state.inputText}
                  outputText={replayText ?? state.outputText}
                  onPaste={handlePaste}
                />
                {phase === "sculpting" && sessionIdRef.current && (
                  <ReplayBar
                    sessionId={sessionIdRef.current}
                    onReplay={(snapshot) => setReplayText(snapshot)}
                    onExitReplay={() => setReplayText(null)}
                  />
                )}
              </>
            )}
          </div>

          {/* Right: ControlPanel — stays visible even in tree mode */}
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
