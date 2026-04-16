"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { GlassPane } from "@/components/GlassPane";
import { ControlPanel } from "@/components/ControlPanel";
import { ReplayBar } from "@/components/ReplayBar";
import { VersionTree } from "@/components/VersionTree";
import {
  buildCommittedRewriteArtifacts,
  buildInitialSessionPayload,
  buildSessionPayload,
  hydrateClientState,
  makeSessionId,
} from "@/lib/liquid/session-model";
import { LiquidRequestCoordinator } from "@/lib/liquid/request-coordinator";
import type {
  ActiveValues,
  LiquidClientState,
  LiquidSessionSnapshot,
  RewriteChange,
  RewritePayload,
} from "@/lib/liquid/types";

type Phase = "empty" | "analyzing" | "sculpting";

const EMPTY_STATE: LiquidClientState = {
  inputText: "",
  controls: null,
  activeValues: {},
  outputText: "",
  sessionId: "",
};

function findChangedControl(
  previousValues: ActiveValues,
  nextValues: ActiveValues,
): RewriteChange | null {
  for (const [controlId, value] of Object.entries(nextValues)) {
    if (previousValues[controlId] !== value) {
      return {
        controlId,
        value,
      };
    }
  }

  return null;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload;
}

export default function LiquidPage() {
  const [state, setState] = useState<LiquidClientState>(EMPTY_STATE);
  const [rootSessionId, setRootSessionId] = useState("");
  const [replayText, setReplayText] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [prefetchedSessions, setPrefetchedSessions] = useState<unknown[] | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  const stateRef = useRef(state);
  const sessionIdRef = useRef("");
  const rootSessionIdRef = useRef("");
  const latestValuesRef = useRef<ActiveValues>({});
  const lastChangeRef = useRef<RewriteChange | null>(null);
  const prefetchingRef = useRef(false);
  const coordinatorRef = useRef<LiquidRequestCoordinator<RewritePayload, string> | null>(
    null,
  );

  useEffect(() => {
    stateRef.current = state;
    sessionIdRef.current = state.sessionId;
    latestValuesRef.current = state.activeValues;
  }, [state]);

  useEffect(() => {
    rootSessionIdRef.current = rootSessionId;
  }, [rootSessionId]);

  useEffect(() => {
    setPrefetchedSessions(null);
    prefetchingRef.current = false;
  }, [state.sessionId]);

  const persistSession = useCallback(
    async (sessionId: string, body: ReturnType<typeof buildSessionPayload>) => {
      await fetch(`/api/session/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [],
  );

  const persistHistory = useCallback(
    async (
      historySessionId: string,
      body: ReturnType<typeof buildCommittedRewriteArtifacts>["historyEntry"],
    ) => {
      await fetch(`/api/session/${historySessionId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [],
  );

  if (!coordinatorRef.current) {
    coordinatorRef.current = new LiquidRequestCoordinator<RewritePayload, string>({
      delayMs: 300,
      execute: async (payload, context) => {
        const response = await fetch("/api/rewrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: context.signal,
        });

        if (!response.ok) {
          let errorMsg = "Rewrite failed";
          try {
            const errBody = (await response.json()) as { error?: string };
            errorMsg = errBody.error ?? errorMsg;
          } catch {}
          throw new Error(errorMsg);
        }

        if (!response.body) {
          throw new Error("Response body is empty");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          context.onChunk(accumulated);
        }

        accumulated += decoder.decode();

        if (!accumulated.trim()) {
          throw new Error("Rewrite produced no output");
        }

        return accumulated.trim();
      },
      onPendingChange: setIsPending,
      onChunk: (text) => {
        setStreamingText(text);
      },
      onCommit: async (outputText) => {
        setStreamingText("");
        const current = stateRef.current;
        if (!current.controls) {
          return;
        }

        const rootId = rootSessionIdRef.current || current.sessionId;
        const artifacts = buildCommittedRewriteArtifacts({
          currentSessionId: current.sessionId,
          rootSessionId: rootId,
          inputText: current.inputText,
          controls: current.controls,
          activeValues: latestValuesRef.current,
          outputText,
          isInitialCommit: !current.outputText,
          currentCreatedAt: current.createdAt,
          change: lastChangeRef.current,
        });

        await persistSession(artifacts.nextSessionId, artifacts.sessionPayload);
        await persistHistory(artifacts.historySessionId, artifacts.historyEntry);

        sessionIdRef.current = artifacts.nextSessionId;
        rootSessionIdRef.current = rootId;
        lastChangeRef.current = null;
        setErrorMessage(null);
        setReplayText(null);
        setRootSessionId(rootId);
        setHistoryRefreshKey((value) => value + 1);
        setTreeRefreshKey((value) => value + 1);
        setState((previous) => ({
          ...previous,
          outputText,
          sessionId: artifacts.nextSessionId,
          createdAt: artifacts.sessionPayload.createdAt,
        }));
        window.history.replaceState({}, "", `?session=${artifacts.nextSessionId}`);
      },
      onError: (error) => {
        setStreamingText("");
        setErrorMessage(error instanceof Error ? error.message : "Rewrite failed");
      },
    });
  }

  useEffect(() => {
    return () => {
      coordinatorRef.current?.dispose();
    };
  }, []);

  const phase: Phase = !state.inputText
    ? "empty"
    : !state.controls
      ? "analyzing"
      : "sculpting";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (!sid) {
      return;
    }

    fetch(`/api/session/${sid}`)
      .then((response) => parseJsonResponse<LiquidSessionSnapshot>(response))
      .then((session) => {
        const nextState = hydrateClientState(session, sid);
        sessionIdRef.current = sid;
        rootSessionIdRef.current = session.rootSessionId ?? sid;
        latestValuesRef.current = nextState.activeValues;
        setRootSessionId(session.rootSessionId ?? sid);
        setState(nextState);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load session");
      });
  }, []);

  const runAnalyze = useCallback(
    async (inputText: string, sessionId: string, createdAt: string) => {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputText }),
      });
      const result = await parseJsonResponse<{
        controls: LiquidClientState["controls"];
        activeValues: ActiveValues;
      }>(response);

      latestValuesRef.current = result.activeValues;
      setState((previous) => ({
        ...previous,
        controls: result.controls,
        activeValues: result.activeValues,
        outputText: "",
        createdAt,
      }));

      await persistSession(
        sessionId,
        buildSessionPayload({
          inputText,
          controls: result.controls,
          activeValues: result.activeValues,
          outputText: "",
          rootSessionId: sessionId,
          parentSessionId: null,
          createdAt,
        }),
      );

      await coordinatorRef.current?.runNow({
        inputText,
        controls: result.controls!,
        activeValues: result.activeValues,
      });
    },
    [persistSession],
  );

  const resetToEmpty = useCallback(() => {
    coordinatorRef.current?.cancel();
    sessionIdRef.current = "";
    rootSessionIdRef.current = "";
    latestValuesRef.current = {};
    lastChangeRef.current = null;
    setErrorMessage(null);
    setReplayText(null);
    setStreamingText("");
    setShowTree(false);
    setRootSessionId("");
    setHistoryRefreshKey(0);
    setTreeRefreshKey(0);
    setState(EMPTY_STATE);
    window.history.pushState({}, "", "/");
  }, []);

  const handlePaste = useCallback(
    async (text: string) => {
      const current = stateRef.current;
      if (current.controls && text === current.inputText) {
        resetToEmpty();
        return;
      }

      coordinatorRef.current?.cancel();

      const sessionId = makeSessionId();
      const createdAt = Date.now().toString();

      sessionIdRef.current = sessionId;
      rootSessionIdRef.current = sessionId;
      latestValuesRef.current = {};
      lastChangeRef.current = null;

      setErrorMessage(null);
      setReplayText(null);
      setShowTree(false);
      setRootSessionId(sessionId);
      setHistoryRefreshKey(0);
      setTreeRefreshKey(0);
      setState({
        inputText: text,
        controls: null,
        activeValues: {},
        outputText: "",
        sessionId,
        createdAt,
      });
      window.history.pushState({}, "", `?session=${sessionId}`);

      await persistSession(sessionId, {
        ...buildInitialSessionPayload(text),
        rootSessionId: sessionId,
        createdAt,
      });

      try {
        await runAnalyze(text, sessionId, createdAt);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Analyze failed");
      }
    },
    [persistSession, resetToEmpty, runAnalyze],
  );

  const handleValuesChange = useCallback((newValues: ActiveValues) => {
    const change = findChangedControl(latestValuesRef.current, newValues);
    if (change) {
      lastChangeRef.current = change;
    }

    latestValuesRef.current = newValues;
    setState((previous) => ({
      ...previous,
      activeValues: newValues,
    }));
  }, []);

  const handleTriggerAgent = useCallback(() => {
    const current = stateRef.current;
    if (!current.controls) {
      return;
    }

    coordinatorRef.current?.schedule({
      inputText: current.inputText,
      controls: current.controls,
      activeValues: latestValuesRef.current,
    });
  }, []);

  const handleFork = useCallback(async () => {
    const current = stateRef.current;
    if (!current.sessionId) {
      return;
    }

    const rootId = rootSessionIdRef.current || current.sessionId;
    const sessionId = makeSessionId();
    const createdAt = Date.now().toString();

    await persistSession(
      sessionId,
      buildSessionPayload({
        inputText: current.inputText,
        controls: current.controls,
        activeValues: current.activeValues,
        outputText: current.outputText,
        rootSessionId: rootId,
        parentSessionId: current.sessionId,
        createdAt,
      }),
    );

    sessionIdRef.current = sessionId;
    rootSessionIdRef.current = rootId;
    setReplayText(null);
    setRootSessionId(rootId);
    setTreeRefreshKey((value) => value + 1);
    setState((previous) => ({
      ...previous,
      sessionId,
      createdAt,
    }));
    window.history.pushState({}, "", `?session=${sessionId}`);
  }, [persistSession]);

  const handleNavigateToSession = useCallback(async (targetSessionId: string) => {
    try {
      const response = await fetch(`/api/session/${targetSessionId}`);
      const session = await parseJsonResponse<LiquidSessionSnapshot>(response);
      const nextState = hydrateClientState(session, targetSessionId);

      coordinatorRef.current?.cancel();
      sessionIdRef.current = targetSessionId;
      rootSessionIdRef.current = session.rootSessionId ?? targetSessionId;
      latestValuesRef.current = nextState.activeValues;
      lastChangeRef.current = null;
      setReplayText(null);
      setStreamingText("");
      setShowTree(false);
      setRootSessionId(session.rootSessionId ?? targetSessionId);
      setState(nextState);
      window.history.pushState({}, "", `?session=${targetSessionId}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load version");
    }
  }, []);

  return (
    <main className="min-h-screen bg-[#080810] relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-indigo-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="px-8 py-6 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-violet-400" />
          <span className="text-sm font-mono text-white/40 tracking-widest uppercase">
            Liquid
          </span>

          {phase === "sculpting" && sessionIdRef.current && (
            <div className="ml-auto flex items-center gap-4">
              <button
                onClick={() => setShowTree((value) => !value)}
                onMouseEnter={() => {
                  const rootId = rootSessionIdRef.current || sessionIdRef.current;
                  if (!rootId || prefetchingRef.current || prefetchedSessions) {
                    return;
                  }

                  prefetchingRef.current = true;
                  fetch(`/api/tree/${rootId}`)
                    .then((response) => response.json())
                    .then((data) => setPrefetchedSessions(data))
                    .catch(() => {
                      prefetchingRef.current = false;
                    });
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

        {errorMessage && (
          <div className="px-8 pb-4">
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-xs font-mono text-red-200/80">
              {errorMessage}
            </div>
          </div>
        )}

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
          <div
            className={[
              "flex flex-col gap-4",
              phase !== "sculpting" ? "w-full max-w-2xl" : "",
            ].join(" ")}
          >
            {showTree && phase === "sculpting" ? (
              <VersionTree
                rootSessionId={rootSessionIdRef.current || sessionIdRef.current}
                currentSessionId={state.sessionId}
                refreshKey={treeRefreshKey}
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
                  outputText={replayText ?? (streamingText || state.outputText)}
                  isPending={isPending}
                  onPaste={handlePaste}
                />
                {phase === "sculpting" && rootSessionIdRef.current && (
                  <ReplayBar
                    sessionId={rootSessionIdRef.current}
                    refreshKey={historyRefreshKey}
                    onReplay={(snapshot) => setReplayText(snapshot)}
                    onExitReplay={() => setReplayText(null)}
                  />
                )}
              </>
            )}
          </div>

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
