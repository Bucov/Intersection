import { createSeed } from "@/lib/ids";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { ControllerMode, ScenarioDefinition, ScenarioId } from "@intersection/shared";
import { useServices } from "@/app/services";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatSpeed } from "@/lib/format";
import { shallowEqual, useStore } from "@/state/store";
import { EventMenu } from "./EventMenu";

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

interface ControlBarProps {
  mode: ControllerMode;
  scenarioId: ScenarioId;
  seed: number;
  scenarios: readonly ScenarioDefinition[];
}

export function ControlBar({ mode, scenarioId, seed, scenarios }: ControlBarProps) {
  const services = useServices();
  const navigate = useNavigate();
  const state = useStore(services.session.store, s => ({ status: s.status, speed: s.speedMultiplier, demoMode: s.snapshot?.config.demoMode ?? null }), shallowEqual);
  const meta = useStore(services.session.meta, m => ({ busy: m.busy, opening: m.opening }), shallowEqual);
  const disabled = meta.opening || !state.status;

  const primary = state.status === "running"
    ? { label: "Pause", icon: <Pause />, run: () => services.session.control("pause") }
    : state.status === "paused"
      ? { label: "Resume", icon: <Play />, run: () => services.session.control("resume") }
      : state.status === "completed"
        ? { label: "Run again", icon: <RotateCcw />, run: () => navigate(`/simulate/${mode}?scenario=${scenarioId}&seed=${createSeed()}`, { replace: true }) }
        : { label: "Start", icon: <Play />, run: () => services.session.control("start") };

  // Space toggles play/pause for presenters, unless focus is in a form control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, button, [role='listbox'], [role='menu'], [contenteditable='true']"))) return;
      event.preventDefault();
      if (!disabled && !meta.busy) void primary.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const go = (nextMode: ControllerMode, nextScenario: ScenarioId) =>
    navigate(`/simulate/${nextMode}?scenario=${nextScenario}&seed=${nextScenario === scenarioId ? seed : createSeed()}`, { replace: true });

  const current = scenarios.find(s => s.id === scenarioId);

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Simulation controls">
      <Button className="h-9 min-w-[6.5rem]" onClick={() => void primary.run()} disabled={disabled || meta.busy} data-testid="playback">
        {primary.icon}
        {primary.label}
      </Button>
      <Tooltip>
        <TooltipTrigger render={<Button variant="secondary" size="icon" className="size-9" aria-label="Reset to the start" onClick={() => void services.session.control("reset")} disabled={disabled || meta.busy || state.status === "ready"} data-testid="reset" />}>
          <RotateCcw />
        </TooltipTrigger>
        <TooltipContent>Reset to time zero with the same seed and traffic</TooltipContent>
      </Tooltip>

      <span className="mx-1 h-6 w-px bg-border max-sm:hidden" aria-hidden="true" />

      <ToggleGroup
        value={[String(state.speed)]}
        onValueChange={value => {
          const next = Number(value[0]);
          if (next && next !== state.speed) void services.session.setSpeed(next);
        }}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Simulation speed"
        disabled={disabled || state.status === "completed"}
      >
        {SPEEDS.map(speed => (
          <ToggleGroupItem key={speed} value={String(speed)} className="h-9 px-2.5 font-mono text-xs tabular" aria-label={`${speed} times speed`}>
            {formatSpeed(speed)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <span className="mx-1 h-6 w-px bg-border max-sm:hidden" aria-hidden="true" />

      <ToggleGroup
        value={[mode]}
        onValueChange={value => {
          const next = value[0] as ControllerMode | undefined;
          if (!next || next === mode) return;
          const supported = scenarios.find(s => s.id === scenarioId)?.supportedModes.includes(next);
          go(next, supported ? scenarioId : "normal-traffic");
        }}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Controller"
      >
        <ToggleGroupItem value="traditional" className="h-9 px-3 text-[0.8125rem]">Fixed-time</ToggleGroupItem>
        <ToggleGroupItem value="ai" className="h-9 px-3 text-[0.8125rem]">AI</ToggleGroupItem>
      </ToggleGroup>

      <Select value={scenarioId} onValueChange={value => { if (value && value !== scenarioId) go(mode, value as ScenarioId); }}>
        <SelectTrigger className="h-9 min-w-[12.5rem]" aria-label="Scenario" data-testid="scenario-select">
          <SelectValue>{current?.name ?? "Scenario"}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} side="top" className="w-80">
          {scenarios.map(scenario => {
            const supported = scenario.supportedModes.includes(mode);
            return (
              <SelectItem key={scenario.id} value={scenario.id} disabled={!supported} className="items-start py-2">
                <span className="flex flex-col gap-0.5 whitespace-normal">
                  <span>{scenario.name}{!supported ? " ⋅ AI only" : ""}</span>
                  <span className="text-xs text-muted-foreground">{scenario.description}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <EventMenu />

      {state.demoMode === "live" && mode === "ai" && state.speed !== 1 ? (
        <span className="text-xs text-warning">1× is recommended with live models; faster runs can miss decisions.</span>
      ) : null}
    </div>
  );
}
