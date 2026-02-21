"use client";

import { useEffect, useRef, useState } from "react";

interface GlassPaneProps {
  phase: "empty" | "analyzing" | "sculpting";
  inputText: string;
  outputText: string;
  onPaste: (text: string) => void;
}

export function GlassPane({ phase, inputText, outputText, onPaste }: GlassPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show cursor while outputText is actively changing; hide it 800ms after the last update
  useEffect(() => {
    if (!outputText) return;
    setIsStreaming(true);
    if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current);
    streamingTimeoutRef.current = setTimeout(() => setIsStreaming(false), 800);
    return () => {
      if (streamingTimeoutRef.current) clearTimeout(streamingTimeoutRef.current);
    };
  }, [outputText]);

  // ── Empty state: paste prompt ──────────────────────────────────────────────
  if (phase === "empty") {
    return (
      <div className="flex flex-col h-full min-h-[60vh] rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
            Input
          </span>
        </div>
        <textarea
          ref={textareaRef}
          className="flex-1 resize-none bg-transparent px-5 py-5 text-white/80 placeholder-white/20 text-sm leading-relaxed font-mono focus:outline-none"
          placeholder={"Paste anything here.\n\nAn email, a code snippet, a tweet, a breakup text.\nClaude will generate bespoke controls to sculpt it."}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.trim()) {
              e.preventDefault();
              onPaste(text.trim());
            }
          }}
          onChange={(e) => {
            // Also support typed input (on Enter submit)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              const text = (e.target as HTMLTextAreaElement).value.trim();
              if (text) {
                e.preventDefault();
                onPaste(text);
              }
            }
          }}
        />
        <div className="px-5 py-3 border-t border-white/[0.06]">
          <p className="text-xs text-white/20 font-mono">
            Paste to begin — or type and press Shift+Enter
          </p>
        </div>
      </div>
    );
  }

  // ── Analyzing state: loading ───────────────────────────────────────────────
  if (phase === "analyzing") {
    return (
      <div className="flex flex-col h-full min-h-[60vh] rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
            Input
          </span>
        </div>
        <div className="flex-1 px-5 py-5 text-white/50 text-sm leading-relaxed font-mono overflow-auto whitespace-pre-wrap">
          {inputText}
        </div>
        <div className="px-5 py-4 border-t border-white/[0.06] flex items-center gap-3">
          <span className="inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-xs font-mono text-violet-400/70 tracking-widest">
            Extracting latent variables…
          </span>
        </div>
      </div>
    );
  }

  // ── Sculpting state: output text ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-[60vh] rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
          Output
        </span>
        {!outputText && (
          <span className="inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
      </div>
      <div className="flex-1 px-5 py-5 text-white/85 text-sm leading-relaxed font-mono overflow-auto whitespace-pre-wrap">
        {outputText ? (
          <>
            {outputText}
            {isStreaming && (
              <span className="inline-block w-[2px] h-[1em] bg-violet-400 ml-px align-text-bottom animate-pulse" />
            )}
          </>
        ) : (
          <span className="text-white/25 italic">Rewriting…</span>
        )}
      </div>
      <div className="px-5 py-3 border-t border-white/[0.06]">
        <button
          onClick={() => onPaste(inputText)}
          className="text-xs text-white/25 font-mono hover:text-white/50 transition-colors"
        >
          ← New paste
        </button>
      </div>
    </div>
  );
}
