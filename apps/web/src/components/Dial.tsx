"use client";

import { useEffect, useRef, useState } from "react";

interface DialProps {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (id: string, value: number) => void;
}

export function Dial({ id, label, description, value, onChange }: DialProps) {
  const [localValue, setLocalValue] = useState(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Sync parent-driven changes (session load, navigation) only when idle.
  useEffect(() => {
    if (!dragging.current) setLocalValue(value);
  }, [value]);

  const valueFromPointer = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect();
    const clamped = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return Math.round((clamped / rect.width) * 100);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Capture keeps all subsequent pointer events on this element even if the
    // cursor leaves — this is how native range inputs work internally and is the
    // correct way to implement a drag slider in Chromium.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const v = valueFromPointer(e.clientX);
    setLocalValue(v);
    onChange(id, v);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const v = valueFromPointer(e.clientX);
    setLocalValue(v);
    onChange(id, v);
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let v = localValue;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") v = Math.min(100, v + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") v = Math.max(0, v - 1);
    else return;
    e.preventDefault();
    setLocalValue(v);
    onChange(id, v);
  };

  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-white/90 tracking-wide">
          {label}
        </label>
        <span className="text-sm font-mono text-violet-400 tabular-nums w-10 text-right">
          {Math.round(localValue)}
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={localValue}
        tabIndex={0}
        className="relative h-5 flex items-center cursor-pointer select-none touch-none outline-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {/* Track */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/10 pointer-events-none">
          <div
            className="h-full rounded-full bg-violet-500"
            style={{ width: `${localValue}%` }}
          />
        </div>

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-violet-900/50 ring-2 ring-violet-500 pointer-events-none"
          style={{ left: `calc(${localValue}% - 6px)` }}
        />
      </div>

      <p className="text-xs text-white/40 leading-relaxed">{description}</p>
    </div>
  );
}
