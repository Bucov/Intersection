import { SCENARIO_CATALOG, type ScenarioParameters, type ScheduledEvent } from "@intersection/shared";
import { MockDriver } from "@/transport/mock/driver";
import { MockSimulation } from "@/transport/mock/engine";
import { SnapshotInterpolator, type RenderVehicle, type SceneFeed, type SceneSample } from "./interpolation";

const PREVIEW_DURATION_MS = 3_600_000;

/** Home-page traffic: the fixed-time controller on livelier, looping demo demand. */
function previewParameters(): ScenarioParameters {
  const base = SCENARIO_CATALOG.find(s => s.id === "normal-traffic")!.defaults;
  const approaches = ["north", "east", "south", "west"] as const;
  const ambulances: ScheduledEvent[] = [];
  for (let at = 24_000, i = 0; at < PREVIEW_DURATION_MS; at += 75_000, i++) {
    ambulances.push({ id: `preview-ambulance-${i}`, atSimMs: at, event: { type: "emergency", approach: approaches[i % 4], vehicleType: "ambulance", responding: true } });
    if (ambulances.length >= 40) break;
  }
  return {
    ...base,
    durationMs: PREVIEW_DURATION_MS,
    demandPreset: "heavy-all-round",
    arrivalRatesVehPerHour: { north: 360, south: 360, east: 320, west: 320 },
    initialQueueByApproach: { north: 4, south: 3, east: 5, west: 4 },
    initialGreen: "EW_GREEN",
    scheduledEvents: ambulances,
  };
}

/**
 * Drives the looping intersection on the home page with the same mock engine
 * and interpolation as a real session, so the preview and the simulation are
 * the same scene with a different data adapter.
 */
export class PreviewFeed implements SceneFeed {
  private sim: MockSimulation | null = null;
  private driver: MockDriver | null = null;
  private readonly interpolator = new SnapshotInterpolator();

  start() {
    if (this.driver?.running) return;
    if (!this.sim || this.sim.status === "completed") this.create();
    this.driver = new MockDriver(this.sim!, events => {
      for (const event of events) if (event.type === "simulation.snapshot") this.interpolator.push(event.payload, performance.now());
      if (this.sim?.status === "completed") this.restart();
    });
    this.driver.start();
  }

  stop() {
    this.driver?.stop();
    this.driver = null;
  }

  sample(now: number, out: RenderVehicle[]): SceneSample {
    return this.interpolator.sample(now, out);
  }

  private create() {
    this.sim = new MockSimulation({
      sessionId: "preview",
      mode: "traditional",
      scenarioId: "normal-traffic",
      parameters: previewParameters(),
      signalTiming: { minimumGreenMs: 8000, maximumGreenMs: 45000, yellowMs: 3000, allRedMs: 2000, fixedGreenMs: 14000 },
      seed: 7,
      retainEvents: 0,
    });
    this.sim.control("start", 0);
    // Pre-roll so the first visible frame already has traffic in motion.
    this.sim.advance(80);
    this.sim.drain();
    this.interpolator.clear();
    this.interpolator.push(this.sim.snapshot(), performance.now());
  }

  private restart() {
    this.stop();
    this.create();
    this.start();
  }
}
