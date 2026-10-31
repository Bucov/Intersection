/** No credentials or model calls. Exercises the actual missing-provider backup path. */
import { Simulation } from '../src/simulation/engine.js';
import { AIService } from '../src/ai/service.js';
import { readConfig } from '../src/ai/config.js';
import { SCENARIO_CATALOG, DEFAULT_SIGNAL_TIMING } from '@intersection/shared';
import type { ManagedSession } from '../src/sessions.js';
const seeds = process.argv.includes('--holdout') ? [7, 29, 257, 2026, 8191] : [1, 17, 42, 103, 991];
const results = [];
for (const scenarioId of ['normal-traffic', 'rush-hour', 'reverse-rush', 'sudden-surge', 'ambulance-priority']) {
  for (const seed of seeds) {
    const sides = [];
    for (const mode of ['traditional', 'ai'] as const) {
      const service = new AIService(readConfig({ DEMO_MODE: 'live', JEV_MODE: 'mock' }));
      service.jevUnavailable = "Benchmark disables JEV to isolate deterministic backup.";
      const sim = new Simulation({ sessionId: 'benchmark', mode, scenarioId: SCENARIO_CATALOG.find(s => s.id === scenarioId)!.id,
        parameters: SCENARIO_CATALOG.find(s => s.id === scenarioId)!.defaults, signalTiming: DEFAULT_SIGNAL_TIMING, seed, demoMode: 'live', jevMode: 'mock' });
      const entry: ManagedSession = { sim, accumulator: 0, readOnly: false, listeners: new Set() };
      try {
        service.attach(entry);
        sim.control('start', 0);
        for (let step = 0; step < 3000; step++) { sim.advance(1); entry.poll?.(); sim.drain(); }
        sides.push(sim.currentMetrics());
      } finally { service.close(); }
    }
    results.push({ scenarioId, seed, fixed: sides[0], backup: sides[1] });
  }
}
console.log(JSON.stringify({ scope: 'Five-minute fixed versus deterministic backup; no inference, no live AI claim', seeds, results }, null, 2));
