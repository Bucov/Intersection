import { useNavigate } from "react-router";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { useServices } from "@/app/services";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { WebSocketIntersectionTransport } from "@/transport/WebSocketIntersectionTransport";
import { shallowEqual, useStore } from "@/state/store";

/**
 * Says plainly when the screen is not live: a dropped stream, a failed command
 * or an unavailable backend. Stale data is never presented as live.
 */
export function ConnectionBanner() {
  const services = useServices();
  const navigate = useNavigate();
  const meta = useStore(services.session.meta, m => m, shallowEqual);
  const time = useStore(services.session.store, s => s.simulationTimeMs);
  const connection = meta.connection;
  const transport = services.session.activeTransport;
  const stale = connection?.source === "backend" && (connection.state === "reconnecting" || connection.state === "error");

  if (!stale && !meta.error) return null;

  const useOffline = () => {
    services.preferences.setState(p => ({ ...p, dataSource: "mock" }));
    void services.dataSource.refresh("mock").then(() => navigate(0));
  };

  return (
    <div role="alert" className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-lg border border-warning/40 bg-panel px-3.5 py-3 text-sm shadow-lg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="leading-snug">
          {stale
            ? `${connection?.state === "error" ? "Live updates stopped." : "Live updates paused."} ${connection?.message ?? ""} The scene is frozen at ${formatClock(time)}.`
            : meta.error}
        </p>
        <div className="flex flex-wrap gap-2">
          {stale && transport instanceof WebSocketIntersectionTransport ? (
            <Button size="sm" variant="secondary" onClick={() => transport.retry()}>
              <RefreshCw data-icon="inline-start" />
              Reconnect now
            </Button>
          ) : null}
          {stale || meta.error?.includes("backend") ? (
            <Button size="sm" variant="ghost" onClick={useOffline}>Switch to the offline demo</Button>
          ) : null}
        </div>
      </div>
      {!stale ? (
        <button type="button" onClick={() => services.session.clearError()} className="-m-1 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
