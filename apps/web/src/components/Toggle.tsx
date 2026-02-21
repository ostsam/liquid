"use client";

interface ToggleProps {
  id: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (id: string, value: boolean) => void;
}

export function Toggle({ id, label, description, value, onChange }: ToggleProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(id, !value)}
        className={[
          "relative flex-shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          value ? "bg-violet-500" : "bg-white/15",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200",
            value ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </button>

      <div className="flex flex-col gap-0.5 min-w-0">
        <label
          htmlFor={id}
          className="text-sm font-medium text-white/90 tracking-wide cursor-pointer"
          onClick={() => onChange(id, !value)}
        >
          {label}
        </label>
        <p className="text-xs text-white/40 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
