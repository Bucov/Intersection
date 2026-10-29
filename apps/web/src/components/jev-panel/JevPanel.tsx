import { Check } from "lucide-react";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { choiceName, formatLatency, formatPercent, humanize, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DecisionCycle } from "@/state/session";
import { choicePhase, jevState } from "./jevState";

const TONE = { neutral: "border-border text-muted-foreground", positive: "border-positive/40 text-positive", warning: "border-warning/40 text-warning", negative: "border-destructive/50 text-destructive" } as const;

function ConfidenceMeter({ confidence, high, medium }: { confidence: number; high: number; medium: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-2 rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(confidence * 100)} aria-label="JEV confidence">
        <div className={cn("absolute inset-y-0 left-0 rounded-full", confidence >= high ? "bg-positive" : confidence >= medium ? "bg-warning" : "bg-destructive")} style={{ width: `${confidence * 100}%` }} />
        {[medium, high].map(mark => (
          <span key={mark} className="absolute -inset-y-1 w-px bg-foreground/50" style={{ left: `${mark * 100}%` }} aria-hidden="true" />
        ))}
      </div>
      <div className="relative h-3.5 font-mono text-[0.625rem] text-subtle-foreground" aria-hidden="true">
        <span className="absolute -translate-x-1/2" style={{ left: `${medium * 100}%` }}>{formatPercent(medium)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${high * 100}%` }}>{formatPercent(high)}</span>
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
  const provenance = result?.provenance ?? a?.provenance ?? null;

  return (
    <section aria-labelledby="jev-title" className="flex flex-col gap-3.5 rounded-lg border bg-card p-3.5" data-testid="jev-panel">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 id="jev-title" className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">
            <span className="size-2 rounded-full bg-jev" aria-hidden="true" />
            JEV arbitration
          </h3>
          <p className="text-xs text-subtle-foreground">Decides only when the agents ask for different greens</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {provenance ? <ProvenanceBadge provenance={provenance} /> : null}
        </div>
      </header>

      <p className={cn("w-fit rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[state.tone])} role="status" data-testid="jev-state">{state.label}</p>

      {arbitration && a && b ? (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">
          Called because Agent A asked for <span className="text-foreground">{phaseName(a.requestedPhase)}</span> and Agent B asked for{" "}
          <span className="text-foreground">{phaseName(b.requestedPhase)}</span>. Only one can be served.
        </p>
      ) : state.kind === "not-needed" ? (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">The agents did not conflict in the latest round, so the safety gate checked their request directly.</p>
      ) : (
        <p className="text-[0.8125rem] leading-snug text-muted-foreground">JEV is called when Agent A and Agent B request different greens at the same time.</p>
      )}

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
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className={cn("block h-full rounded-full", chosen ? "bg-jev" : "bg-subtle-foreground/60")} style={{ width: `${p.probability * 100}%` }} />
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
        <dd className="font-mono tabular">{result ? `${formatLatency(result.latencyMs)}${result.provenance === "mock" ? " (simulated)" : ""}` : "—"}</dd>
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
