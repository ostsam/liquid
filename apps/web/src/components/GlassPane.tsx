"use client";

import { memo, useRef } from "react";

interface GlassPaneProps {
  phase: "empty" | "analyzing" | "sculpting";
  inputText: string;
  outputText: string;
  isPending: boolean;
  onPaste: (text: string) => void;
}

export const GlassPane = memo(function GlassPane({
  phase,
  inputText,
  outputText,
  isPending,
  onPaste,
}: GlassPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Empty state: paste prompt ──────────────────────────────────────────────
  if (phase === "empty") {
    return (
      <div className="workspace-pane flex flex-col rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
            Input
          </span>
        </div>
        <textarea
          ref={textareaRef}
          className="workspace-text flex-1 resize-none bg-transparent px-5 py-5 text-white/80 placeholder-white/20 text-sm leading-relaxed font-mono focus:outline-none"
          placeholder={"Paste anything here.\n\nAn email, a code snippet, a tweet, a breakup text.\nGPT will generate bespoke controls to sculpt it."}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.trim()) {
              e.preventDefault();
              onPaste(text.trim());
            }
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
      <div className="workspace-pane flex flex-col rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
            Input
          </span>
        </div>
        <div className="workspace-text flex-1 px-5 py-5 text-white/50 text-sm leading-relaxed font-mono overflow-auto whitespace-pre-wrap">
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
    <div className="workspace-pane flex flex-col rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
          Output
        </span>
        {isPending && (
          <span className="inline-flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
      </div>
      <div className="workspace-text flex-1 px-5 py-5 text-white/85 text-sm leading-relaxed font-mono overflow-auto whitespace-pre-wrap">
        {outputText ? (
          <>
            {outputText}
            {isPending && (
              <span aria-hidden="true" className="relative inline-block w-0">
                <span className="absolute bottom-0 left-px h-[1em] w-[2px] bg-violet-400 animate-pulse" />
              </span>
            )}
          </>
        ) : (
          <span className="text-white/25 italic">
            {isPending ? "Rewriting…" : "No output yet."}
          </span>
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
});
