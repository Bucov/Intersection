import { Check } from "lucide-react";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { Square } from "@/components/common/Square";
import { choiceName, formatLatency, formatPercent, humanize, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DecisionCycle } from "@/state/session";
import { choicePhase, jevState } from "./jevState";

const TONE = { neutral: "text-muted-foreground", positive: "text-positive", warning: "text-warning", negative: "text-destructive" } as const;
const UNITS = 20;

/** A probability as twenty squares, five percent each; `tone` colours the filled ones. */
function UnitBar({ value, tone, marks = [] }: { value: number; tone: string; marks?: number[] }) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * UNITS);
  return (
    <span className="relative flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: UNITS }, (_, i) => (
        <span key={i} className={cn("size-[9px] shrink-0", i < filled ? tone : "bg-(--cell)")} />
      ))}
      {marks.map(mark => (
        <span key={mark} className="absolute -inset-y-1 w-px bg-foreground/60" style={{ left: `calc(${mark * UNITS} * 12px - 2px)` }} />
      ))}
    </span>
  );
}

function ConfidenceMeter({ confidence, high, medium }: { confidence: number; high: number; medium: number }) {
  return (
    <div className="flex flex-col gap-1" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(confidence * 100)} aria-label="JEV confidence">
      <UnitBar value={confidence} tone={confidence >= high ? "bg-positive" : confidence >= medium ? "bg-warning" : "bg-destructive"} marks={[medium, high]} />
      <div className="relative h-3.5 w-[237px] font-mono text-[0.625rem] text-subtle-foreground" aria-hidden="true">
        <span className="absolute -translate-x-1/2" style={{ left: `calc(${medium * UNITS} * 12px - 2px)` }}>{formatPercent(medium)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `calc(${high * UNITS} * 12px - 2px)` }}>{formatPercent(high)}</span>
      </div>
    </div>
  );
}

/** JEV's part of the latest round: why it was called, its distribution, confidence and what happened next. */
export function JevPanel({ cycle, jevModel }: { cycle: DecisionCycle | null; jevModel: string | null }) {
  const state = jevState(cycle);
  const arbitration = cycle?.arbitration ?? null;
  const result = arbitration?.result ?? null;
  const decision = cycle?.decisions[cycle.decisions.length - 1] ?? null;
  const a = cycle?.proposals["agent-a"] ?? arbitration?.proposalA ?? null;
  const b = cycle?.proposals["agent-b"] ?? arbitration?.proposalB ?? null;
  const raw = arbitration?.adapterResult;
  const provenance = raw ? (raw.source === "mock" ? "mock" : "live") : result?.provenance ?? a?.provenance ?? null;

  return (
    <section aria-labelledby="jev-title" className="flex flex-col gap-3.5 border-t pt-3.5" data-testid="jev-panel">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 id="jev-title" className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">
            <Square className="size-2 text-jev" />
            JEV arbitration
          </h3>
          <p className="text-xs text-subtle-foreground">Chooses a safe action when agents disagree or fail</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
        </div>
      </header>

      <p className={cn("flex w-fit items-center gap-1.5 text-xs font-medium", TONE[state.tone])} role="status" data-testid="jev-state">
        <Square className="size-[7px]" />
        {state.label}
      </p>

      {arbitration?.recoveryReason ? <p className="text-sm">An agent could not provide a plan ({humanize(arbitration.recoveryReason)}). JEV is reviewing the current traffic.</p> : arbitration && a && b ? (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">
          Called because Agent A asked for <span className="text-foreground">{phaseName(a.requestedPhase)} for {a.requestedGreenSeconds} s</span> and Agent B asked for{" "}
          <span className="text-foreground">{phaseName(b.requestedPhase)} for {b.requestedGreenSeconds} s</span>. One plan can be scheduled.
        </p>
      ) : state.kind === "not-needed" ? (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">The agents did not conflict in the latest round, so the safety gate checked their request directly.</p>
      ) : (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">JEV is called when Agent A and Agent B propose different service plans.</p>
      )}

      {arbitration?.controllerActions ? <ul className="space-y-2 text-sm" aria-label="Available controller actions">{arbitration.controllerActions.map(action => <li key={action.id}>{raw?.selectedCandidateId === action.id ? <strong>Selected: {action.label}</strong> : action.label} {raw?.probabilities?.[action.id] !== undefined ? <span className="font-mono text-xs">{formatPercent(raw.probabilities[action.id])}</span> : null}</li>)}</ul> : null}
      {raw?.measurements === "synthetic" ? <p className="text-xs text-subtle-foreground">Synthetic confidence and probabilities from the adapter mock.</p> : null}
      {raw && !result && !arbitration?.controllerActions && arbitration?.status === "completed" ? <p className="text-[0.8125rem] text-muted-foreground">{raw.status === "abstained" ? "JEV abstained. " : "A recommendation was returned. "}Confidence: {raw.confidence === null ? "unavailable" : formatPercent(raw.confidence)}. {raw.probabilities === null ? "Choice probabilities unavailable." : `Candidate probabilities: ${Object.entries(raw.probabilities).map(([id, p]) => `${arbitration?.controllerActions?.find(action => action.id === id)?.label ?? (id === a?.proposalId ? "Agent A" : "Agent B")} ${formatPercent(p)}`).join(", ")}; abstain ${raw.abstainProbability === null ? "unavailable" : formatPercent(raw.abstainProbability)}.`}</p> : null}
      {result && cycle ? (
        <>
          <ul className="flex flex-col gap-1.5" aria-label="Choice distribution">
            {result.probabilities.map(p => {
              const chosen = p.choice === result.choice;
              const phase = choicePhase(p.choice, cycle);
              return (
                <li key={p.choice} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[0.8125rem]">
                  <span className={cn("flex items-center gap-1.5", chosen ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {chosen ? <Check className="size-3.5" aria-label="Selected" /> : <span className="size-3.5" aria-hidden="true" />}
                    {choiceName(p.choice)}
                    {phase ? <span className="text-subtle-foreground">⋅ {phaseName(phase)}</span> : null}
                  </span>
                  <span className="font-mono tabular text-xs">{formatPercent(p.probability)}</span>
                  <span className="col-span-2">
                    <UnitBar value={p.probability} tone={chosen ? "bg-jev" : "bg-subtle-foreground/70"} />
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.8125rem] text-muted-foreground">Confidence</span>
              <span className="text-sm">
                <span className="font-mono tabular font-medium">{formatPercent(result.confidence)}</span>
                <span className="text-muted-foreground"> ⋅ {humanize(result.confidenceBand)}</span>
              </span>
            </div>
            <ConfidenceMeter confidence={result.confidence} high={result.confidencePolicy.highThreshold} medium={result.confidencePolicy.mediumThreshold} />
            <p className="text-xs leading-snug text-subtle-foreground">
              Reported by {result.provenance === "mock" ? "the mock arbiter" : "JEV"}, not derived from the top probability.{" "}
              {result.confidenceBand === "high" ? "High still requires the safety gate." : result.confidenceBand === "medium" ? "Medium adds a deterministic check." : "Low hands the decision to the fallback rules."}
            </p>
          </div>
        </>
      ) : arbitration?.status === "pending" ? (
        <p className="text-[0.8125rem] text-muted-foreground">Waiting for JEV. The current signal keeps its authorised phase meanwhile.</p>
      ) : arbitration?.status === "failed" ? (
        <p className="text-[0.8125rem] text-muted-foreground">No result: {humanize(arbitration.fallbackReason ?? "provider_error").toLowerCase()}. A timeout is not a 0% answer; no confidence is shown.</p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
        <dt className="text-subtle-foreground">Latency</dt>
        <dd className="font-mono tabular">{raw ? `${formatLatency(raw.latencyMs)} (measured wall time)` : result ? `${formatLatency(result.latencyMs)}${result.provenance === "mock" ? " (simulated)" : ""}` : "—"}</dd>
        <dt className="text-subtle-foreground">Model</dt>
        <dd className="truncate">{result?.model ?? jevModel ?? "Not reported"}{result?.modelVersion ? ` ⋅ ${result.modelVersion}` : ""}</dd>
        <dt className="text-subtle-foreground">Safety gate</dt>
        <dd>{decision ? `${humanize(decision.status)} ⋅ ${humanize(decision.reason).toLowerCase()}` : arbitration?.status === "pending" ? "Waiting" : "—"}</dd>
        <dt className="text-subtle-foreground">Fallback</dt>
        <dd>{cycle?.fallback ? `${humanize(cycle.fallback.reason)} → ${phaseName(cycle.fallback.selectedPhase)}` : cycle ? "Not needed" : "—"}</dd>
      </dl>
    </section>
  );
}
