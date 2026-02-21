"use client";

interface DialProps {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (id: string, value: number) => void;
}

export function Dial({ id, label, description, value, onChange }: DialProps) {
  return (
    <div className="group flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-white/90 tracking-wide">
          {label}
        </label>
        <span className="text-sm font-mono text-violet-400 tabular-nums w-10 text-right">
          {Math.round(value)}
        </span>
      </div>

      <div className="relative h-1.5 rounded-full bg-white/10">
        {/* Filled track */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-violet-500 transition-all duration-75"
          style={{ width: `${value}%` }}
        />
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(id, Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
        {/* Thumb indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md shadow-violet-900/50 ring-2 ring-violet-500 transition-all duration-75 pointer-events-none"
          style={{ left: `calc(${value}% - 6px)` }}
        />
      </div>

      <p className="text-xs text-white/40 leading-relaxed">{description}</p>
    </div>
  );
}
