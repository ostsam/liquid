"use client";

import { useEffect, useState, useCallback } from "react";

interface HistoryEntry {
  id: string;
  controlId: string;
  value: string;
  outputSnapshot: string;
  timestamp: string;
}

interface ReplayBarProps {
  sessionId: string;
  refreshKey?: number;
  onReplay: (outputSnapshot: string) => void;
  onExitReplay: () => void;
}

export function ReplayBar({
  sessionId,
  refreshKey = 0,
  onReplay,
  onExitReplay,
}: ReplayBarProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [position, setPosition] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    setIsLoading(true);

    fetch(`/api/session/${sessionId}/history`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Unable to load history");
        return r.json();
      })
      .then((entries: HistoryEntry[]) => {
        if (controller.signal.aborted) return;
        setHistory(entries.filter((e) => e.outputSnapshot));
        setIsLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, sessionId]);

  const handleScrub = useCallback(
    (index: number) => {
      setPosition(index);
      const entry = history[index];
      if (entry?.outputSnapshot) {
        onReplay(entry.outputSnapshot);
      }
    },
    [history, onReplay]
  );

  return (
    <div aria-busy={isLoading} className="flex min-h-12 items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-xl">
      {/* Label */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="text-xs font-mono text-white/40 uppercase tracking-widest">
          Replay
        </span>
      </div>

      {/* Scrub bar */}
      <div className="min-w-0 flex-1 relative h-1 rounded-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-violet-500/60"
          style={{
            width:
              position !== null
                ? `${((position + 1) / history.length) * 100}%`
                : history.length > 0
                  ? "100%"
                  : "0%",
          }}
        />
        <input
          type="range"
          min={0}
          max={Math.max(0, history.length - 1)}
          step={1}
          value={position ?? Math.max(0, history.length - 1)}
          disabled={history.length === 0}
          onChange={(e) => handleScrub(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Replay sculpting history"
        />
      </div>

      {/* Entry count */}
      <span className="text-xs font-mono text-white/25 flex-shrink-0 tabular-nums min-w-9 text-right">
        {position !== null ? position + 1 : history.length}/{history.length}
      </span>

      {/* Exit replay */}
      <button
        disabled={position === null}
        aria-hidden={position === null}
        style={{ visibility: position === null ? "hidden" : "visible" }}
        onClick={() => {
          setPosition(null);
          onExitReplay();
        }}
        className="text-xs font-mono text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
      >
        Live ↑
      </button>
    </div>
  );
}
