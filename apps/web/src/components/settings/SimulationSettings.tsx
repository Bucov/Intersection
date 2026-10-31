import { useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  DEFAULT_SIGNAL_TIMING, DEMAND_PRESETS, SCENARIO_CATALOG,
  type ControllerMode, type ScenarioId, type ScenarioParameters, type SignalTiming,
} from "@intersection/shared";
import { useServices } from "@/app/services";
import { PageSection } from "@/components/common/PageLayout";
import { Square } from "@/components/common/Square";
import { Button } from "@/components/ui/button";
import { createSeed } from "@/lib/ids";
import { defaultRunSettings, RunSettingsSchema, settingsFromRun, type RunSettings } from "@/state/runSettings";
import { useStore } from "@/state/store";

const INPUT = "min-h-11 w-full min-w-0 border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";
const APPROACHES = ["north", "south", "east", "west"] as const;
const TIMINGS: [keyof SignalTiming, string][] = [
  ["minimumGreenMs", "Minimum green"], ["fixedGreenMs", "Fixed-time green"],
  ["maximumGreenMs", "Maximum green"], ["yellowMs", "Yellow"], ["allRedMs", "All red"],
];
const MIX = [["car", "Cars"], ["van", "Vans"], ["bus_truck", "Buses & trucks"], ["ambulance", "Ambulances"], ["police", "Police"]] as const;

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-2">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    {children(id)}
    {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
  </div>;
}

function NumberField({ label, value, onChange, min = 0, max, step = 1, hint }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; hint?: string;
}) {
  return <Field label={label} hint={hint}>{id => <input id={id} className={INPUT} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""} onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />}</Field>;
}

function Group({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return <details className="group border-t py-4">
    <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      {title}<span className="ml-2 font-normal text-muted-foreground">{summary}</span>
    </summary>
    <div className="flex flex-col gap-5 pt-5">{children}</div>
  </details>;
}

export function SimulationSettings() {
  const services = useServices();
  const navigate = useNavigate();
  const stored = useStore(services.runSettings, s => s);
  const source = useStore(services.dataSource.store, s => s);
  const scenarios = source.catalog?.scenarios ?? SCENARIO_CATALOG;
  const [draft, setDraft] = useState<RunSettings>(() => structuredClone(stored.settings));
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const scenario = scenarios.find(s => s.id === draft.scenarioId) ?? SCENARIO_CATALOG[0];
  const parameters = draft.scenarioOverrides[scenario.id] ?? scenario.defaults;
  const timing = draft.signalTiming ?? source.catalog?.config.signalTiming ?? DEFAULT_SIGNAL_TIMING;
  const update = (next: RunSettings) => { setDraft(next); setNotice(""); setErrors([]); };
  const patch = (change: Partial<RunSettings>) => update({ ...draft, ...change });
  const setParameters = (change: Partial<ScenarioParameters>) => patch({ scenarioOverrides: { ...draft.scenarioOverrides, [scenario.id]: { ...parameters, ...change } } });
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored.settings);
  const mixTotal = Object.values(parameters.vehicleMix).reduce((sum, value) => sum + value, 0) * 100;
  const latestEvent = Math.max(-100, ...parameters.scheduledEvents.map(e => e.atSimMs));

  function save(mode?: ControllerMode) {
    const result = RunSettingsSchema.safeParse(draft);
    if (!result.success) {
      setErrors(result.error.issues.map(issue => {
        if (issue.path.includes("vehicleMix")) return "Vehicle mix: enter percentages between 0 and 100 that total exactly 100%.";
        if (issue.path.includes("signalTiming")) return "Signal timing: use seconds in 0.1 s steps, at least 1 s each, with minimum green ≤ fixed green ≤ maximum green.";
        if (issue.path.includes("scheduledEvents")) return "Duration must extend beyond every scheduled scenario event. Increase the duration or restore the scenario defaults.";
        if (issue.path.includes("seed")) return "Seed must be a whole number from 0 to 4294967295, or blank for a random seed.";
        return `${issue.path.join(" / ")}: ${issue.message}`;
      }));
      setNotice("");
      return;
    }
    services.runSettings.setState(s => ({ ...s, settings: result.data }));
    setErrors([]);
    setNotice("Saved for new simulations and comparisons.");
    if (mode) {
      const seed = result.data.seed ?? createSeed();
      navigate(`/simulate/${mode}?scenario=${result.data.scenarioId}&seed=${seed}`);
    }
  }

  return <PageSection title="Simulation & debugging" description="Save defaults for new runs in this browser. Existing runs keep their configuration.">
    <form noValidate onSubmit={e => { e.preventDefault(); save(); }} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Default scenario">{id => <select id={id} className={INPUT} value={scenario.id} onChange={e => patch({ scenarioId: e.target.value as ScenarioId })}>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>}</Field>
        <NumberField label="Run duration (seconds)" min={1} max={3600} step={0.1} value={parameters.durationMs / 1000} onChange={v => setParameters({ durationMs: Math.round(v * 1000) })} hint={latestEvent >= 0 ? `Scheduled events require a duration greater than ${latestEvent / 1000} seconds.` : "1–3600 seconds, in 0.1 s steps."} />
        <Field label="Seed" hint="Paste a previous seed, including 0. Leave blank for fresh traffic on each new run.">{id => <input id={id} className={INPUT} type="number" min={0} max={0xffff_ffff} step={1} placeholder="Random each run" value={draft.seed === null || !Number.isFinite(draft.seed) ? "" : draft.seed} onChange={e => patch({ seed: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
        <NumberField label="Starting speed" value={draft.speedMultiplier} onChange={speedMultiplier => patch({ speedMultiplier })} min={0.1} max={20} step={0.1} hint="0.1×–20×. Use 1× with live models; faster runs can miss decisions." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => patch({ seed: createSeed() })}>Generate seed</Button>
        <Button type="button" variant="ghost" onClick={() => patch({ seed: null })} disabled={draft.seed === null}>Use random seeds</Button>
        {stored.lastRun ? <Button type="button" variant="secondary" onClick={() => {
          update(settingsFromRun(draft, stored.lastRun!));
          setNotice(`Loaded ${stored.lastRun!.scenarioId}, seed ${stored.lastRun!.seed}, and its traffic and timing settings. Save or start a run to use them.`);
        }}>Use last run · {stored.lastRun.seed}</Button> : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">The same seed, scenario and parameters reproduce traffic inputs on the same data source. Live AI decisions and manually injected events can differ.</p>

      <div>
        <Group title="Traffic demand" summary={`${scenario.name}`}>
          <Field label="Demand preset" hint="Selecting a preset fills the four arrival rates below. You can then adjust each approach.">{id => <select id={id} className={INPUT} value={parameters.demandPreset} onChange={e => {
            const demandPreset = e.target.value as ScenarioParameters["demandPreset"];
            setParameters({ demandPreset, arrivalRatesVehPerHour: { ...DEMAND_PRESETS[demandPreset] } });
          }}>{Object.keys(DEMAND_PRESETS).map(p => <option key={p} value={p}>{p.replaceAll("-", " ")}</option>)}</select>}</Field>
          <div className="grid grid-cols-2 gap-4">{APPROACHES.map(a => <NumberField key={a} label={`${a[0].toUpperCase()}${a.slice(1)} arrivals (veh/h)`} value={parameters.arrivalRatesVehPerHour[a]} max={7200} onChange={v => setParameters({ arrivalRatesVehPerHour: { ...parameters.arrivalRatesVehPerHour, [a]: v } })} />)}</div>
          <h3 className="text-sm font-medium">Vehicles initially queued</h3>
          <div className="grid grid-cols-2 gap-4">{APPROACHES.map(a => <NumberField key={a} label={`${a[0].toUpperCase()}${a.slice(1)} queue`} value={parameters.initialQueueByApproach[a]} max={12} onChange={v => setParameters({ initialQueueByApproach: { ...parameters.initialQueueByApproach, [a]: v } })} />)}</div>
          <Field label="Initial green">{id => <select id={id} className={INPUT} value={parameters.initialGreen} onChange={e => setParameters({ initialGreen: e.target.value as ScenarioParameters["initialGreen"] })}><option value="NS_GREEN">North / South</option><option value="EW_GREEN">East / West</option></select>}</Field>
        </Group>
        <Group title="Signal timing" summary={draft.signalTiming ? "Custom · all new runs" : "Server defaults"}>
          <p className="text-sm leading-relaxed text-muted-foreground">Seconds in 0.1 s steps. Minimum green ≤ fixed-time green ≤ maximum green. The safety gate still enforces clearance and occupancy.</p>
          <div className="grid grid-cols-2 gap-4">{TIMINGS.map(([key, label]) => <NumberField key={key} label={`${label} (seconds)`} value={timing[key] / 1000} min={1} step={0.1} onChange={v => patch({ signalTiming: { ...timing, [key]: Math.round(v * 1000) } })} />)}</div>
          <Button type="button" variant="secondary" className="self-start" disabled={!draft.signalTiming} onClick={() => patch({ signalTiming: null })}>Use server timing defaults</Button>
        </Group>
        <Group title="Vehicle mix & emergencies" summary={`${Number.isFinite(mixTotal) ? Number(mixTotal.toFixed(3)) : "—"}% total`}>
          <p className="text-sm text-muted-foreground">Shares must add up to 100%. Scenario-scheduled emergency vehicles are additional to this random mix.</p>
          <div className="grid grid-cols-2 gap-4">{MIX.map(([key, label]) => <NumberField key={key} label={`${label} (%)`} value={Number((parameters.vehicleMix[key] * 100).toFixed(6))} max={100} step={0.1} onChange={v => setParameters({ vehicleMix: { ...parameters.vehicleMix, [key]: v / 100 } })} />)}</div>
          <NumberField label="Police responding probability (%)" value={parameters.policeRespondingProbability * 100} max={100} step={0.1} onChange={v => setParameters({ policeRespondingProbability: v / 100 })} hint="Chance that a randomly generated police vehicle requests emergency priority." />
        </Group>
        <Group title="Random events" summary={parameters.randomEvents.enabled ? "Enabled" : "Disabled"}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input className="size-4 accent-foreground" type="checkbox" checked={parameters.randomEvents.enabled} onChange={e => setParameters({ randomEvents: { ...parameters.randomEvents, enabled: e.target.checked } })} />Enable random demand surges and congestion</label>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Event interval (seconds)" value={parameters.randomEvents.intervalMs / 1000} min={0.1} step={0.1} onChange={v => setParameters({ randomEvents: { ...parameters.randomEvents, intervalMs: Math.round(v * 1000) } })} />
            <NumberField label="Surge probability (%)" value={parameters.randomEvents.surgeProbability * 100} max={100} step={0.1} onChange={v => setParameters({ randomEvents: { ...parameters.randomEvents, surgeProbability: v / 100 } })} />
            <NumberField label="Congestion probability (%)" value={parameters.randomEvents.congestionProbability * 100} max={100} step={0.1} onChange={v => setParameters({ randomEvents: { ...parameters.randomEvents, congestionProbability: v / 100 } })} />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">These probabilities apply at each event interval. The selected scenario’s scheduled events remain in place.</p>
        </Group>
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <Button type="button" variant="secondary" onClick={() => {
            const next = { ...draft.scenarioOverrides };
            delete next[scenario.id];
            patch({ scenarioOverrides: next });
          }}>Restore {scenario.name} defaults</Button>
          <Button type="button" variant="ghost" onClick={() => update(defaultRunSettings())}>Reset all run settings</Button>
        </div>
      </div>
      {errors.length ? <div role="alert" className="text-sm leading-relaxed text-destructive"><p className="font-medium">Check these settings before saving:</p><ul className="mt-2 list-disc pl-5">{[...new Set(errors)].map(e => <li key={e}>{e}</li>)}</ul></div> : null}
      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t bg-background py-4">
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Save settings</Button>
          <Button type="button" variant="secondary" disabled={source.blocked} onClick={() => save("ai")}>Save & run AI</Button>
          <Button type="button" variant="secondary" disabled={source.blocked || !scenario.supportedModes.includes("traditional")} onClick={() => save("traditional")}>Save & run fixed-time</Button>
        </div>
        <p role="status" className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
          <Square className={`mt-1.5 size-[7px] ${notice && !dirty ? "text-positive animate-[square-in_0.42s_both] motion-reduce:animate-none" : "text-subtle-foreground"}`} />
          {notice || (dirty ? "Unsaved changes" : "Saved defaults apply to new runs, including runs started from Home.")}
        </p>
      </div>
    </form>
  </PageSection>;
}
