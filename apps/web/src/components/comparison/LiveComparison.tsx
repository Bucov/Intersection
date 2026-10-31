import { useEffect, useState } from 'react';
import type { ComparisonResponse, SimulationSnapshot } from '@intersection/shared';
import { useServices } from '@/app/services';
import { phaseName } from '@/lib/format';

/** Independent read-only snapshots; never takes over the main scene's websocket. */
export function LiveComparison({ comparison }: { comparison: ComparisonResponse }) {
  const services = useServices();
  const [snapshots, setSnapshots] = useState<SimulationSnapshot[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const transport = services.dataSource.transport();
    if (!transport.getSnapshot) return;
    const poll = async () => {
      try {
        const next = await Promise.all([comparison.traditional.sessionId, comparison.ai.sessionId].map(id => transport.getSnapshot!(id)));
        if (!stopped) { setSnapshots(next); setError(false); }
      } catch { if (!stopped) setError(true); }
      if (!stopped) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [services, comparison.comparisonId]);
  return <section aria-label="Live intersections">
    {error ? <p role="status">Live traffic view disconnected. Retrying…</p> : null}
    <div className="grid grid-cols-2 gap-3">{snapshots.map((s, i) => <figure key={s.sessionId}>
      <figcaption className="text-sm font-medium">{i === 0 ? 'Fixed timing' : 'AI control'}</figcaption>
      <p className="text-xs text-muted-foreground">{phaseName(s.signal.phase)}</p>
      <svg viewBox="-110 -110 220 220" role="img" aria-label={`${i === 0 ? 'Fixed' : 'AI'} live vehicle positions`} className="mt-2 w-full bg-muted">
        <path d="M -12 -110 H 12 V -12 H 110 V 12 H 12 V 110 H -12 V 12 H -110 V -12 H -12 Z" fill="var(--scene-asphalt)" />
        {s.vehicles.map(v => <rect key={v.id} x={v.position.x-1.5} y={v.position.z-v.lengthM/2} width="3" height={v.lengthM} transform={`rotate(${v.headingRadians*180/Math.PI} ${v.position.x} ${v.position.z})`} fill={v.emergency ? 'var(--emergency)' : i === 0 ? 'var(--chart-fixed)' : 'var(--chart-ai)'} />)}
        <text x="0" y="-95" textAnchor="middle" fill="var(--foreground)" fontSize="10">N</text>
      </svg>
      <p className="mt-1 text-xs">{s.metrics.waitingVehicleCount} waiting · {s.metrics.completedVehicleCount} completed</p>
    </figure>)}</div>
  </section>;
}
