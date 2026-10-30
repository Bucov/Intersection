import { useState, type ReactNode } from "react";
import { Ambulance, BrainCircuit, ChevronDown, CloudOff, Gauge, Siren, Zap } from "lucide-react";
import type { Approach, InjectedEvent } from "@intersection/shared";
import { useServices } from "@/app/services";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shallowEqual, useStore } from "@/state/store";

const APPROACHES: readonly { id: Approach; label: string }[] = [
  { id: "north", label: "N" },
  { id: "east", label: "E" },
  { id: "south", label: "S" },
  { id: "west", label: "W" },
];

function Row({ icon, title, description, disabledReason, children }: { icon: ReactNode; title: string; description: string; disabledReason?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground [&_svg]:size-4" aria-hidden="true">{icon}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-[0.8125rem] leading-snug text-muted-foreground">{disabledReason ?? description}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-6.5">{children}</div>
    </div>
  );
}

/** Presenter actions. Each one is a contract injection; unsupported ones say why. */
export function EventMenu() {
  const services = useServices();
  const [open, setOpen] = useState(false);
  const info = useStore(services.session.store, s => ({
    mode: s.snapshot?.config.mode ?? null,
    demoMode: s.snapshot?.config.demoMode ?? null,
    status: s.status,
    hasSession: s.sessionId !== null,
  }), shallowEqual);
  const busy = useStore(services.session.meta, m => m.busy);
  const faultsEnabled = useStore(services.dataSource.store, s => s.catalog?.config.faultInjectionEnabled ?? false);
  const [last, setLast] = useState<string | null>(null);

  const finished = info.status === "completed";
  const unavailable = !info.hasSession ? "Waiting for the session to start." : finished ? "The session has finished. Reset to run it again." : null;
  const aiOnly = info.mode !== "ai" ? "Only the AI controller has agents to trigger. The fixed-time controller ignores decision triggers." : null;
  const noFaults = !faultsEnabled ? "Fault injection is disabled on this server." : null;
  const mockOnly = info.demoMode === "live" ? "Low confidence can only be injected into the mock JEV, so live confidence is never fabricated." : null;

  const send = async (label: string, ...events: InjectedEvent[]) => {
    for (const event of events) {
      const response = await services.session.inject(event);
      if (!response) return;
    }
    setLast(label);
  };

  const approachButtons = (label: string, make: (approach: Approach) => InjectedEvent, disabled: boolean) =>
    APPROACHES.map(a => (
      <Button key={a.id} size="sm" variant="secondary" className="w-10 font-mono" disabled={disabled || busy} onClick={() => void send(`${label} from the ${a.id}`, make(a.id))} aria-label={`${label} from the ${a.id}`}>
        {a.label}
      </Button>
    ));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="secondary" className="h-9" data-testid="events-menu" />}>
        <Zap data-icon="inline-start" />
        Events
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[22rem] gap-0 divide-y p-4">
        <Row icon={<Ambulance />} title="Spawn ambulance" description="A responding ambulance joins the chosen approach, ahead of waiting demand." disabledReason={unavailable}>
          {approachButtons("Ambulance", approach => ({ type: "emergency", approach, vehicleType: "ambulance", responding: true }), !!unavailable)}
        </Row>
        <Row icon={<Siren />} title="Spawn police car" description="A responding police car; it only gets priority because it is responding." disabledReason={unavailable}>
          {approachButtons("Police car", approach => ({ type: "emergency", approach, vehicleType: "police", responding: true }), !!unavailable)}
        </Row>
        <Row icon={<Gauge />} title="Traffic surge" description="Four times the arrival rate on one approach for 60 seconds." disabledReason={unavailable}>
          {approachButtons("Traffic surge", approach => ({ type: "demand_surge", approach, multiplier: 4, durationMs: 60_000 }), !!unavailable)}
        </Row>
        <Row icon={<BrainCircuit />} title="AI demonstrations" description="Trigger both agents now, or force JEV to report low confidence." disabledReason={unavailable ?? aiOnly}>
          <Button size="sm" variant="secondary" disabled={!!(unavailable ?? aiOnly) || busy} onClick={() => void send("Conflict trigger", { type: "decision_boundary", reason: "simultaneous_proposals" })}>
            Trigger a decision now
          </Button>
          <Button
            size="sm"
            variant="secondary"
            title={mockOnly ?? noFaults ?? undefined}
            disabled={!!(unavailable ?? aiOnly ?? noFaults ?? mockOnly) || busy}
            onClick={() => void send("Low-confidence demonstration", { type: "provider_fault", provider: "jev", fault: "low_confidence", durationMs: 30_000 }, { type: "decision_boundary", reason: "ambiguous_arbitration" })}
          >
            Low JEV confidence
          </Button>
        </Row>
        <Row icon={<CloudOff />} title="Simulate a provider failure" description="Inject a timeout or provider error for 30 seconds and watch the safe fallback." disabledReason={unavailable ?? aiOnly ?? noFaults}>
          <Button size="sm" variant="secondary" disabled={!!(unavailable ?? aiOnly ?? noFaults) || busy} onClick={() => void send("JEV timeout", { type: "provider_fault", provider: "jev", fault: "timeout", durationMs: 30_000 }, { type: "decision_boundary", reason: "simultaneous_proposals" })}>
            JEV timeout
          </Button>
          <Button size="sm" variant="secondary" disabled={!!(unavailable ?? aiOnly ?? noFaults) || busy} onClick={() => void send("Gemini provider error", { type: "provider_fault", provider: "gemini", fault: "provider_error", durationMs: 30_000 }, { type: "decision_boundary", reason: "simultaneous_proposals" })}>
            Gemini error
          </Button>
        </Row>
        {last ? <p className="pt-3 text-[0.8125rem] text-muted-foreground" role="status">Scheduled: {last}. It applies at the next simulation step.</p> : null}
      </PopoverContent>
    </Popover>
  );
}
