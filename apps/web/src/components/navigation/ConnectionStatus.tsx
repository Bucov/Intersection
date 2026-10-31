import { RefreshCw } from "lucide-react";
import { useServices } from "@/app/services";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Square } from "@/components/common/Square";
import { cn } from "@/lib/utils";
import { WebSocketIntersectionTransport } from "@/transport/WebSocketIntersectionTransport";
import { shallowEqual, useStore } from "@/state/store";
import { summarizeConnection, type ConnectionTone } from "./connection";

const TONE: Record<ConnectionTone, string> = {
  neutral: "text-subtle-foreground",
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-destructive",
};

/** Where the data comes from, as a square: it blinks while the connection is still settling. */
export function StatusSquare({ tone, pulsing = false, className }: { tone: ConnectionTone; pulsing?: boolean; className?: string }) {
  return <Square className={cn(TONE[tone], className)} blink={pulsing} />;
}

export function ConnectionStatus() {
  const services = useServices();
  const source = useStore(services.dataSource.store, s => s);
  const meta = useStore(services.session.meta, m => m);
  const providers = useStore(services.session.store, s => s.providers, shallowEqual);
  const summary = summarizeConnection(source, meta, providers);
  const transport = services.session.activeTransport;
  const healthProviders = providers ?? source.health?.providers ?? null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 px-1 font-[450] tracking-[-0.01em] text-foreground/72 transition-colors hover:text-foreground"
            data-testid="connection-status"
          />
        }
      >
        <StatusSquare tone={summary.tone} pulsing={summary.pulsing} />
        <span className="max-sm:max-w-28 max-sm:truncate max-sm:text-xs">{summary.label.toLowerCase()}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <div className="flex flex-col gap-1">
          <PopoverTitle className="flex items-center gap-2 text-sm">
            <StatusSquare tone={summary.tone} pulsing={summary.pulsing} />
            {summary.label}
          </PopoverTitle>
          <PopoverDescription className="text-sm leading-relaxed">{summary.detail}</PopoverDescription>
        </div>
        {healthProviders ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-sm">
            {healthProviders.map(p => (
              <div key={p.provider} className="contents">
                <dt className="text-muted-foreground">{p.provider === "gemini" ? "Proposal agents" : "JEV"}</dt>
                <dd>
                  {p.mode === "mock" ? "Mock" : "Live"} ⋅ {p.status.replaceAll("_", " ")}
                  {p.model ? <span className="text-subtle-foreground"> ⋅ {p.model}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {meta.connection?.source === "backend" && (meta.connection.state === "error" || meta.connection.state === "reconnecting") && transport instanceof WebSocketIntersectionTransport ? (
            <Button size="sm" variant="secondary" onClick={() => transport.retry()}>
              <RefreshCw data-icon="inline-start" />
              Reconnect now
            </Button>
          ) : null}
          {source.preference !== "mock" ? (
            <Button size="sm" variant="secondary" onClick={() => void services.dataSource.refresh()} disabled={source.probing}>
              <RefreshCw data-icon="inline-start" />
              Check backend
            </Button>
          ) : null}
          {source.preference !== "mock" ? (
            <Button size="sm" variant="ghost" onClick={() => services.preferences.setState(p => ({ ...p, dataSource: "mock" }))}>
              Use offline demo
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => services.preferences.setState(p => ({ ...p, dataSource: "auto" }))}>
              Look for a backend
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
