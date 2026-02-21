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
  onReplay: (outputSnapshot: string) => void;
  onExitReplay: () => void;
}

export function ReplayBar({ sessionId, onReplay, onExitReplay }: ReplayBarProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [position, setPosition] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;

    fetch(`/api/session/${sessionId}/history`)
      .then((r) => r.json())
      .then((entries: HistoryEntry[]) => {
        setHistory(entries.filter((e) => e.outputSnapshot));
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [sessionId]);

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

  if (isLoading || history.length === 0) return null;

  return (
    <div className="flex items-center gap-4 px-6 py-3 rounded-xl bg-white/[0.04] border border-white/10 backdrop-blur-xl">
      {/* Label */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="text-xs font-mono text-white/40 uppercase tracking-widest">
          Replay
        </span>
      </div>

      {/* Scrub bar */}
      <div className="flex-1 relative h-1 rounded-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-violet-500/60"
          style={{
            width:
              position !== null
                ? `${((position + 1) / history.length) * 100}%`
                : "100%",
          }}
        />
        <input
          type="range"
          min={0}
          max={history.length - 1}
          step={1}
          value={position ?? history.length - 1}
          onChange={(e) => handleScrub(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Replay sculpting history"
        />
      </div>

      {/* Entry count */}
      <span className="text-xs font-mono text-white/25 flex-shrink-0">
        {position !== null ? position + 1 : history.length}/{history.length}
      </span>

      {/* Exit replay */}
      {position !== null && (
        <button
          onClick={() => {
            setPosition(null);
            onExitReplay();
          }}
          className="text-xs font-mono text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
        >
          Live ↑
        </button>
      )}
    </div>
  );
}
