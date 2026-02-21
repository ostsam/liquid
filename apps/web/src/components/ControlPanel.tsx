"use client";

import { useCallback, useEffect, useRef } from "react";
import { Dial } from "./Dial";
import { Toggle } from "./Toggle";

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

interface ControlPanelProps {
  controls: ControlSchema;
  activeValues: ActiveValues;
  onValuesChange: (newValues: ActiveValues) => void;
  /** Called after debounce — triggers the agent rewriter */
  onTriggerAgent: () => void;
}

const DEBOUNCE_MS = 300;

export function ControlPanel({
  controls,
  activeValues,
  onValuesChange,
  onTriggerAgent,
}: ControlPanelProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fire the agent trigger after DEBOUNCE_MS of no input
  const scheduleAgentTrigger = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      onTriggerAgent();
    }, DEBOUNCE_MS);
  }, [onTriggerAgent]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const handleDialChange = useCallback(
    (id: string, value: number) => {
      const newValues = { ...activeValues, [id]: value };
      onValuesChange(newValues);
      scheduleAgentTrigger();
    },
    [activeValues, onValuesChange, scheduleAgentTrigger]
  );

  const handleToggleChange = useCallback(
    (id: string, value: boolean) => {
      const newValues = { ...activeValues, [id]: value };
      onValuesChange(newValues);
      scheduleAgentTrigger();
    },
    [activeValues, onValuesChange, scheduleAgentTrigger]
  );

  return (
    <div className="flex flex-col gap-6 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-xl p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
          Controls
        </span>
      </div>

      {/* Scalar dials */}
      {controls.scalars.length > 0 && (
        <div className="flex flex-col gap-6">
          {controls.scalars.map((scalar, i) => (
            <div
              key={scalar.id}
              className="control-panel-enter"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <Dial
                id={scalar.id}
                label={scalar.label}
                description={scalar.description}
                value={
                  typeof activeValues[scalar.id] === "number"
                    ? (activeValues[scalar.id] as number)
                    : scalar.default
                }
                onChange={handleDialChange}
              />
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      {controls.scalars.length > 0 && controls.toggles.length > 0 && (
        <div className="border-t border-white/[0.06]" />
      )}

      {/* Toggle switches */}
      {controls.toggles.length > 0 && (
        <div className="flex flex-col gap-4">
          {controls.toggles.map((toggle, i) => (
            <div
              key={toggle.id}
              className="control-panel-enter"
              style={{
                animationDelay: `${(controls.scalars.length + i) * 60}ms`,
              }}
            >
              <Toggle
                id={toggle.id}
                label={toggle.label}
                description={toggle.description}
                value={
                  typeof activeValues[toggle.id] === "boolean"
                    ? (activeValues[toggle.id] as boolean)
                    : toggle.default
                }
                onChange={handleToggleChange}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
