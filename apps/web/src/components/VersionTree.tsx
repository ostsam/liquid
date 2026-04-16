"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  Node,
  Edge,
  NodeChange,
  useNodesState,
  useEdgesState,
  NodeProps,
  NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionFlat {
  sessionId: string;
  outputText: string;
  inputText: string;
  controlLabels: string | null;
  createdAt: string;
  parentSessionId: string | null;
  deleted: boolean;
}

type SessionNodeData = {
  sessionId: string;
  outputText: string;
  inputText: string;
  controlLabels: string | null;
  createdAt: string;
  isActive: boolean;
  onNavigate: (id: string) => void;
  onDelete: (id: string) => void;
  onPreload: (id: string) => void;
  [key: string]: unknown;
};

// ─── Layout ───────────────────────────────────────────────────────────────────
// Recursive tree layout: leaves evenly spaced, parents centered over children.

const NODE_W = 240;
const NODE_H = 110;
const GAP_X = 60;
const GAP_Y = 80;

function computeLayout(
  sessions: SessionFlat[]
): Map<string, { x: number; y: number }> {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const childMap = new Map<string, string[]>();
  const roots: string[] = [];

  for (const s of sessions) {
    if (s.parentSessionId && byId.has(s.parentSessionId)) {
      const ch = childMap.get(s.parentSessionId) ?? [];
      ch.push(s.sessionId);
      childMap.set(s.parentSessionId, ch);
    } else {
      roots.push(s.sessionId);
    }
  }

  const sortByTime = (ids: string[]) =>
    ids.sort(
      (a, b) =>
        Number(byId.get(a)?.createdAt ?? 0) -
        Number(byId.get(b)?.createdAt ?? 0)
    );

  sortByTime(roots);
  for (const [, ch] of childMap) sortByTime(ch);

  const positions = new Map<string, { x: number; y: number }>();
  let leafX = 0;

  function place(id: string, depth: number): number {
    const children = childMap.get(id) ?? [];
    if (children.length === 0) {
      const x = leafX * (NODE_W + GAP_X);
      leafX++;
      positions.set(id, { x, y: depth * (NODE_H + GAP_Y) });
      return x;
    }
    const childXs = children.map((cid) => place(cid, depth + 1));
    const cx = (childXs[0] + childXs[childXs.length - 1]) / 2;
    positions.set(id, { x: cx, y: depth * (NODE_H + GAP_Y) });
    return cx;
  }

  roots.forEach((r) => place(r, 0));
  return positions;
}

// ─── Node: looks like a miniature output panel ────────────────────────────────

function SessionNodeComponent({ data }: NodeProps) {
  const [hovered, setHovered] = useState(false);
  const d = data as SessionNodeData;

  const rawText = d.outputText || d.inputText || "";
  const preview = rawText.slice(0, 130) + (rawText.length > 130 ? "…" : "");
  const isActive = d.isActive;

  const dateMs = Number(d.createdAt);
  const timeStr =
    !isNaN(dateMs) && dateMs > 0
      ? new Date(dateMs).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  return (
    <div
      style={{ width: NODE_W }}
      className={[
        "rounded-xl border overflow-hidden cursor-pointer select-none",
        "transition-all duration-150",
        "bg-white/[0.04] backdrop-blur-xl",
        isActive
          ? "border-violet-500/40 shadow-[0_0_24px_rgba(139,92,246,0.22)]"
          : hovered
          ? "border-white/25 shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
          : "border-white/10",
      ].join(" ")}
      onMouseEnter={() => { setHovered(true); d.onPreload(d.sessionId); }}
      onMouseLeave={() => setHovered(false)}
      onClick={() => d.onNavigate(d.sessionId)}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 0, height: 0 }}
      />

      {/* Node header — mirrors GlassPane header */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
        <div
          className={[
            "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all",
            isActive
              ? "bg-violet-400 shadow-[0_0_5px_rgba(167,139,250,0.9)]"
              : "bg-white/15",
          ].join(" ")}
        />
        <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">
          {isActive ? "active" : "output"}
        </span>
        {timeStr && (
          <span className="ml-auto text-[9px] font-mono text-white/15 mr-1">
            {timeStr}
          </span>
        )}
        <button
          style={{ opacity: hovered ? 1 : 0 }}
          // nodrag + nopan: React Flow fires drag-detection on mousedown, before click.
          // Without these classes the mousedown is consumed by React Flow and the click never lands.
          className="nodrag nopan text-white/15 hover:text-red-400/70 font-mono text-sm leading-none transition-all"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            d.onDelete(d.sessionId);
          }}
          tabIndex={-1}
        >
          ×
        </button>
      </div>

      {/* Node body — text preview */}
      <div className="px-3 py-3 space-y-1.5">
        <p
          className={[
            "text-[11px] font-mono leading-relaxed",
            isActive ? "text-white/65" : "text-white/32",
          ].join(" ")}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {preview || <span className="italic text-white/18">—</span>}
        </p>
        {d.controlLabels && (
          <p className="text-[9px] font-mono text-white/15 truncate">
            {d.controlLabels as string}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "transparent", border: "none", width: 0, height: 0 }}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  sessionNode: SessionNodeComponent,
};

// ─── Canvas — replaces the output panel ──────────────────────────────────────

interface VersionTreeProps {
  rootSessionId: string;
  currentSessionId: string;
  refreshKey?: number;
  onNavigate: (sessionId: string, cachedSession?: unknown) => void;
  onFork: () => void;
  onClose: () => void;
  /** Pre-fetched sessions from parent — skips the loading state entirely when provided */
  initialSessions?: unknown[] | null;
}

export function VersionTree({
  rootSessionId,
  currentSessionId,
  refreshKey = 0,
  onNavigate,
  onFork,
  onClose,
  initialSessions,
}: VersionTreeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Skip loading state when pre-fetched data is already available
  const [loading, setLoading] = useState(() => !initialSessions?.length);
  const [nodeCount, setNodeCount] = useState(0);
  // Silent refresh: re-fetches tree after delete without showing the loading spinner
  const [silentRefreshing, setSilentRefreshing] = useState(false);

  // Full session cache — populated on node hover so clicks are instant
  const sessionCacheRef = useRef<Map<string, unknown>>(new Map());

  // Snapshot of current edges for BFS inside handleDelete (avoids adding `edges` as dep)
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Fetch full session data on hover; no-op if already cached
  const handlePreload = useCallback((sessionId: string) => {
    if (sessionCacheRef.current.has(sessionId)) return;
    fetch(`/api/session/${sessionId}`)
      .then((r) => r.json())
      .then((data) => sessionCacheRef.current.set(sessionId, data))
      .catch(() => {});
  }, []);

  // Navigate wrapper — injects cached session so the caller can skip its own fetch
  const handleNavigate = useCallback(
    (sessionId: string) => onNavigate(sessionId, sessionCacheRef.current.get(sessionId)),
    [onNavigate]
  );

  // Persisted drag positions — survives component unmount and page reload
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Load saved positions from localStorage when rootSessionId is known
  useEffect(() => {
    if (!rootSessionId) return;
    try {
      const raw = localStorage.getItem(`lc:tree-positions:${rootSessionId}`);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, { x: number; y: number }>;
        savedPositionsRef.current = new Map(Object.entries(obj));
      }
    } catch {
      // ignore
    }
  }, [rootSessionId]);

  // Consume pre-fetched sessions immediately — bypasses the fetch effect entirely
  useEffect(() => {
    if (!initialSessions?.length) return;
    buildGraph(initialSessions as SessionFlat[]);
    setLoading(false);
  // buildGraph identity is stable; we only want this when initialSessions reference changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessions]);

  // Intercept node changes — persist final drag positions to localStorage
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let changed = false;
      for (const change of changes) {
        if (change.type === "position" && change.position && !change.dragging) {
          savedPositionsRef.current.set(change.id, change.position);
          changed = true;
        }
      }
      if (changed && rootSessionId) {
        try {
          localStorage.setItem(
            `lc:tree-positions:${rootSessionId}`,
            JSON.stringify(Object.fromEntries(savedPositionsRef.current))
          );
        } catch {
          // ignore
        }
      }
      onNodesChange(changes);
    },
    [onNodesChange, rootSessionId]
  );

  const handleDelete = useCallback(async (sessionId: string) => {
    // Build child map from the current edge snapshot for cascade removal
    const childMap = new Map<string, string[]>();
    for (const edge of edgesRef.current) {
      const children = childMap.get(edge.source) ?? [];
      children.push(edge.target);
      childMap.set(edge.source, children);
    }
    // BFS: collect the target node and all its descendants
    const toRemove = new Set<string>([sessionId]);
    const queue = [sessionId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childMap.get(current) ?? []) {
        if (!toRemove.has(child)) {
          toRemove.add(child);
          queue.push(child);
        }
      }
    }
    // Optimistically remove from the canvas — instant feedback
    setNodes((prev) => prev.filter((n) => !toRemove.has(n.id)));
    setEdges((prev) =>
      prev.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target))
    );
    setNodeCount((prev) => Math.max(0, prev - toRemove.size));
    // Fire the API call, then silently confirm (no loading spinner)
    const res = await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
    if (res.ok) setSilentRefreshing(true);
  }, [setNodes, setEdges, setSilentRefreshing]);

  const buildGraph = useCallback(
    (sessions: SessionFlat[]) => {
      const active = sessions.filter((s) => !s.deleted);
      const positions = computeLayout(active);
      setNodeCount(active.length);

      const newNodes: Node[] = active.map((s) => ({
        id: s.sessionId,
        type: "sessionNode",
        position:
          savedPositionsRef.current.get(s.sessionId) ??
          positions.get(s.sessionId) ?? { x: 0, y: 0 },
        data: {
          sessionId: s.sessionId,
          outputText: s.outputText,
          inputText: s.inputText,
          controlLabels: s.controlLabels,
          createdAt: s.createdAt,
          isActive: s.sessionId === currentSessionId,
          onNavigate: handleNavigate,
          onDelete: handleDelete,
          onPreload: handlePreload,
        } satisfies SessionNodeData,
      }));

      const byId = new Set(active.map((s) => s.sessionId));
      const newEdges: Edge[] = active
        .filter((s) => s.parentSessionId && byId.has(s.parentSessionId))
        .map((s) => ({
          id: `${s.parentSessionId}->${s.sessionId}`,
          source: s.parentSessionId!,
          target: s.sessionId,
          type: "smoothstep",
          style: {
            stroke: "rgba(255, 255, 255, 0.12)",
            strokeWidth: 1.5,
          },
        }));

      setNodes(newNodes);
      setEdges(newEdges);
    },
    [currentSessionId, handleNavigate, handleDelete, handlePreload, setNodes, setEdges]
  );

  // Fetch tree whenever loading is true
  useEffect(() => {
    if (!rootSessionId || !loading) return;
    let cancelled = false;

    fetch(`/api/tree/${rootSessionId}`)
      .then((r) => r.json())
      .then((sessions: SessionFlat[]) => {
        if (!cancelled) {
          buildGraph(sessions);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rootSessionId, loading, buildGraph]);

  // Silently confirm tree state after a delete — no loading spinner
  useEffect(() => {
    if (!silentRefreshing || !rootSessionId) return;
    let cancelled = false;
    fetch(`/api/tree/${rootSessionId}`)
      .then((r) => r.json())
      .then((sessions: SessionFlat[]) => {
        if (!cancelled) {
          buildGraph(sessions);
          setSilentRefreshing(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSilentRefreshing(false);
      });
    return () => { cancelled = true; };
  }, [silentRefreshing, rootSessionId, buildGraph]);

  useEffect(() => {
    if (!rootSessionId || refreshKey === 0 || loading || silentRefreshing) {
      return;
    }

    let cancelled = false;

    fetch(`/api/tree/${rootSessionId}`)
      .then((r) => r.json())
      .then((sessions: SessionFlat[]) => {
        if (!cancelled) {
          buildGraph(sessions);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [buildGraph, loading, refreshKey, rootSessionId, silentRefreshing]);

  // Keep active-node highlight in sync without full re-fetch
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isActive: n.id === currentSessionId,
          onNavigate: handleNavigate,
          onDelete: handleDelete,
          onPreload: handlePreload,
        },
      }))
    );
  }, [currentSessionId, handleNavigate, handleDelete, handlePreload, setNodes]);

  return (
    // Same container shape as GlassPane — seamless visual swap
    // h-[70vh] gives React Flow a concrete height to render into
    <div className="flex flex-col rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl overflow-hidden" style={{ height: "70vh" }}>
      {/* Header — mirrors GlassPane's header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
            Versions
          </span>
          {nodeCount > 0 && (
            <span className="text-[10px] font-mono text-white/20">
              {nodeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5">
          <button
            onClick={() => {
              onFork();
              onClose();
            }}
            className="text-xs font-mono text-white/25 hover:text-violet-400 transition-colors"
          >
            fork current ↗
          </button>
          <button
            onClick={onClose}
            className="text-white/25 hover:text-white/55 transition-colors font-mono text-base leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Canvas — min-h-0 lets flex-1 respect the parent's explicit height */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-violet-400/60 animate-pulse" />
              <span className="text-xs font-mono text-white/25">Loading…</span>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.28 }}
            minZoom={0.15}
            maxZoom={2.5}
            style={{ background: "transparent" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(255,255,255,0.04)"
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
