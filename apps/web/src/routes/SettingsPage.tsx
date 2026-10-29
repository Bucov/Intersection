import { useNavigate } from "react-router";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useServices } from "@/app/services";
import { PageLayout, PageSection } from "@/components/common/PageLayout";
import { StatusDot } from "@/components/navigation/ConnectionStatus";
import { summarizeConnection } from "@/components/navigation/connection";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DataSourcePreference, QualityPreference } from "@/state/preferences";
import { shallowEqual, useStore } from "@/state/store";

const SOURCES: { value: DataSourcePreference; label: string; description: string }[] = [
  { value: "auto", label: "Automatic", description: "Use the backend when it answers; otherwise run the offline demo." },
  { value: "mock", label: "Offline demo", description: "Never contact a backend. Agents and JEV are simulated in this browser." },
  { value: "backend", label: "Backend only", description: "Require the backend. Sessions will not start while it is unreachable." },
];

const QUALITY: { value: QualityPreference; label: string; description: string }[] = [
  { value: "auto", label: "Automatic", description: "Starts high and lowers quality if the frame rate drops." },
  { value: "high", label: "High", description: "Shadows and a sharper image." },
  { value: "low", label: "Low", description: "No shadows, standard pixel density. Best for older laptops." },
];

const LATER = [
  "Traffic arrival rates and vehicle mix",
  "Signal durations: minimum, maximum and fixed green, yellow, all red",
  "Emergency event probabilities",
  "How often the agents are asked for proposals",
  "JEV confidence thresholds",
  "Visual theme",
];

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; description: string }[]; onChange: (value: T) => void }) {
  return (
    <RadioGroup value={value} onValueChange={next => onChange(next as T)} aria-label={name} className="gap-1">
      {options.map(option => (
        <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted has-[[data-checked]]:bg-muted">
          <RadioGroupItem value={option.value} className="mt-0.5" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[0.9375rem] font-medium">{option.label}</span>
            <span className="text-sm leading-snug text-muted-foreground">{option.description}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

export function SettingsPage() {
  const services = useServices();
  const navigate = useNavigate();
  const preferences = useStore(services.preferences, p => p, shallowEqual);
  const source = useStore(services.dataSource.store, s => s);
  const meta = useStore(services.session.meta, m => m);
  const summary = summarizeConnection(source, meta, null);

  return (
    <PageLayout title="Settings" lead="Presentation preferences for this browser. Simulation parameters will join them once the backend exposes them.">
      <PageSection title="Data source" description="Where new sessions come from. The home preview always runs locally.">
        <Choice name="Data source" value={preferences.dataSource} options={SOURCES} onChange={dataSource => services.preferences.setState(p => ({ ...p, dataSource }))} />
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <StatusDot tone={summary.tone} pulsing={summary.pulsing} />
          <span className="font-medium">{summary.label}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">{summary.detail}</span>
          {preferences.dataSource !== "mock" ? (
            <Button size="sm" variant="secondary" onClick={() => void services.dataSource.refresh()} disabled={source.probing}>
              <RefreshCw data-icon="inline-start" />
              Check now
            </Button>
          ) : null}
        </div>
      </PageSection>

      <PageSection title="Rendering quality" description="For the 3D scene. Lower it if the animation stutters on this machine.">
        <Choice name="Rendering quality" value={preferences.quality} options={QUALITY} onChange={quality => services.preferences.setState(p => ({ ...p, quality }))} />
      </PageSection>

      <PageSection title="Opening sequence" description="The intro plays once when the site is opened. Replay it here.">
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              services.intro.setState(s => ({ phase: "title", run: s.run + 1 }));
              navigate("/");
            }}
          >
            <RotateCcw data-icon="inline-start" />
            Replay the intro
          </Button>
        </div>
      </PageSection>

      <PageSection title="Coming later" description="Advanced configuration will be added when the backend supports it:">
        <ul className="flex flex-col gap-2 text-[0.9375rem] text-muted-foreground">
          {LATER.map(item => (
            <li key={item} className="flex gap-2.5">
              <span className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-subtle-foreground" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </PageSection>
    </PageLayout>
  );
}
