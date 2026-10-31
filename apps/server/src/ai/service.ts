import { agentInstructions } from "./trafficPolicy.js";
import {
  createAgent,
  createHuman,
  defineRuntime,
  RuntimeState,
  SemanticEvent,
  SituationSpecification,
  ModelMessageItem,
  type SituationContext,
  type InferenceInput,
  type InferenceOutput,
  type InferenceRunner,
  type Agent,
} from "@mozaik-ai/core";
import {
  createJevBridge,
  events,
  eventPayloadSchema,
  MockJevAdapter,
  TypeSafeJevAdapter,
  type ArbitrationProvider,
  type Correlation,
} from "mozaik-jev-adapter";
import { type ProviderStatus } from "@intersection/shared";
import {
  ObservationSchema,
  ProposalSchema,
  arbitrationInstructions,
  type Observation,
  type Proposal,
} from "./schemas.js";
import { type AIConfig, type AgentConfig } from "./config.js";
import { Coordinator } from "./coordinator.js";
import { configureMozaikCloud, type CloudStatus } from "./cloud.js";
import type { ManagedSession } from "../sessions.js";
class State extends RuntimeState {}
class Observe extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext) {
    return (
      event.type === "model.answer" ||
      event.type.startsWith("jev.v1.arbitration.")
    );
  }
}
export interface RunnerTask {
  agentId: "agent-a" | "agent-b";
  config: AgentConfig;
  observation: Observation;
  cycleId: string;
  sessionId: string;
  generation: number;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  coordinator: Coordinator;
  participant: Agent;
  contextId: string;
}
export type AgentRunner = (
  input: InferenceInput,
  task: RunnerTask,
) => Promise<InferenceOutput>;
export class AIService {
  readonly runtime = defineRuntime<State>();
  readonly participant = createHuman({
    name: "Intersection arbitration coordinator",
    capabilities: [],
    handlers: [],
  });
  readonly coordinators = new Map<string, Coordinator>();
  readonly tasks = new Map<string, RunnerTask>();
  readonly producers = new Map<string, RunnerTask>();
  // Logical decision ownership ends before the physical Mozaik loop necessarily does.
  private readonly loops = new Map<string, RunnerTask>();
  readonly bridge: ReturnType<typeof createJevBridge<Observation, Proposal>>;
  activeInference = 0;
  disposed = false;
  jevUnavailable: string | null = null;
  readonly cloud: CloudStatus;
  readonly diagnostics: string[] = [];
  constructor(
    readonly config: AIConfig,
    runner?: AgentRunner,
    providerOverride?: ArbitrationProvider<Observation, Proposal>,
  ) {
    // Obtain the public default inference runner, then contain failures before runLoop's
    // fire-and-forget promise. The empty provider runtime owns no participants or timers.
    // Core 4.1 creates a cloud client for each loop; streaming to Mozaik cloud is
    // opt-in through MOZAIK_CLOUD=on and needs no account otherwise.
    this.cloud = configureMozaikCloud();
    const native = defineRuntime<State>()
      .initializeRuntime({ state: new State() })
      .getInferenceRunner();
    const actual: AgentRunner =
      runner ??
      (config.mode === "live"
        ? (input) => native.run(input)
        : async (_input, task) => {
            await new Promise((r) => setTimeout(r, config.mockLatencyMs));
            return {
              items: [
                ModelMessageItem.rehydrate({
                  text: JSON.stringify({
                    requestedPhase:
                      task.agentId === "agent-a" ? "NS_GREEN" : "EW_GREEN",
                    requestedGreenSeconds: Math.max(
                      task.observation.timing.minimumGreenMs / 1000,
                      Math.min(
                        20,
                        task.observation.timing.maximumGreenMs / 1000,
                      ),
                    ),
                    summary: `Offline proposal prioritizing ${task.agentId === "agent-a" ? "North/South" : "East/West"} demand.`,
                  }),
                }),
              ],
              tokenUsage: undefined,
              rowResponse: null,
            };
          });
    const contained: InferenceRunner = {
      run: async (input) => {
        const task = this.tasks.get(input.context.id);
        if (!task) return answer("{}");
        task.startedAt = Date.now();
        task.coordinator.inferenceStarted(task);
        try {
          if (this.disposed || !task.coordinator.owns(task))
            throw new Error("cancelled");
          const fault = task.coordinator.sim.activeFault("gemini");
          if (fault) throw new Error(fault);
          const output = await actual(input, task);
          const message = output.items.find(
            (i) => i instanceof ModelMessageItem,
          );
          if (!message) throw new Error("invalid_response");
          return { ...output, items: [message] }; // no tools or unrequested additional loop iterations
        } catch (error) {
          task.error = safeFailure(error);
          return answer("{}");
        } finally {
          task.endedAt = Date.now();
          this.activeInference--;
          this.tasks.delete(input.context.id);
          task.coordinator.inferenceEnded(task);
        }
      },
      async *stream() {
        yield SemanticEvent.create("unused", "server", {});
      },
    };
    this.runtime.initializeRuntime({
      state: new State(),
      inferenceRunnerConfig: { runner: contained },
    });
    let live: ArbitrationProvider<Observation, Proposal> | undefined;
    if (config.jevMode === "live")
      try {
        live = new TypeSafeJevAdapter({
          stateSchema: ObservationSchema,
          proposalSchema: ProposalSchema,
          instructions: arbitrationInstructions,
        });
      } catch {
        this.jevUnavailable =
          "TYPESAFE_API_KEY is missing or TypeSafe client construction failed.";
      }
    const provider: ArbitrationProvider<Observation, Proposal> =
      providerOverride ?? {
        arbitrate: async (request, options) => {
          const c = this.coordinators.get(request.sessionId),
            fault = c?.sim.activeFault("jev");
          if (config.jevMode === "mock") {
            const fixture =
              fault === "low_confidence"
                ? "low-confidence"
                : fault === "timeout"
                  ? "timeout"
                  : fault === "invalid_response"
                    ? "malformed"
                    : fault
                      ? "error"
                      : config.fixture;
            return new MockJevAdapter({
              stateSchema: ObservationSchema,
              proposalSchema: ProposalSchema,
              fixture,
              latencyMs: 0,
            }).arbitrate(request, options);
          }
          if (fault) throw new Error("injected_" + fault);
          if (!live) throw new Error("missing_credentials");
          return live.arbitrate(request, options);
        },
      };
    this.bridge = createJevBridge({
      stateSchema: ObservationSchema,
      proposalSchema: ProposalSchema,
      provider,
      runtime: this.runtime,
      participantId: this.participant.getId(),
      isCurrent: (r) => this.isCurrent(r),
      maxConcurrent: 8,
      timeoutMs: config.arbitrationTimeoutMs,
      dedupeSize: 2048,
      dedupeTtlMs: 60000,
      onDiagnostic: (code) => {
        this.diagnostics.push(code);
        if (this.diagnostics.length > 100) this.diagnostics.shift();
      },
    });
    this.participant.setHandlers([
      this.bridge.handler,
      {
        specification: new Observe(),
        processor: {
          apply: ({ event }) => {
            try {
              if (event.type === "model.answer") {
                const task = this.producers.get(event.producerId);
                try {
                  if (task) task.coordinator.answer(task, event.payload);
                } finally {
                  // Core 4.1 publishes to our handlers BEFORE looking up the agent
                  // for cloud telemetry. Keep it joined through that synchronous tail.
                  queueMicrotask(() => this.retireLoop(event.producerId));
                }
              } else if (event.type !== events.requested) {
                const parsed = eventPayloadSchema.safeParse(event.payload);
                if (parsed.success)
                  this.coordinators
                    .get(parsed.data.sessionId)
                    ?.terminal(parsed.data);
              }
            } catch {
              this.diagnostics.push("observer_failed");
              if (this.diagnostics.length > 100) this.diagnostics.shift();
            }
          },
        },
      },
    ]);
    this.runtime.join(this.participant);
  }
  attach(entry: ManagedSession) {
    if (entry.sim.mode !== "ai") return;
    const coordinator = new Coordinator(entry.sim, this);
    this.coordinators.set(entry.sim.sessionId, coordinator);
    entry.sim.adaptive = coordinator;
    entry.poll = () => coordinator.poll();
    entry.settle = () => coordinator.whenIdle();
    entry.dispose = () => {
      coordinator.dispose();
      this.coordinators.delete(entry.sim.sessionId);
    };
  }
  isCurrent(r: Correlation) {
    return (
      !this.disposed &&
      (this.coordinators.get(r.sessionId)?.isCurrent(r) ?? false)
    );
  }
  launch(coordinator: Coordinator, cycleId: string, observation: Observation) {
    if (this.activeInference + 2 > this.config.maxInference) return false;
    const tasks: RunnerTask[] = [];
    for (let i = 0; i < 2; i++) {
      const agentId = i === 0 ? "agent-a" : "agent-b";
      const participant = createAgent({
        name: `${agentId}-${cycleId}`,
        capabilities: [],
        instruction: agentInstructions(i === 0 ? "North/South" : "East/West"),
        tools: [],
        handlers: [],
      });
      const task: RunnerTask = {
        agentId,
        config: this.config.agents[i],
        observation,
        cycleId,
        sessionId: coordinator.sim.sessionId,
        generation: coordinator.sim.generation,
        startedAt: null,
        endedAt: null,
        error: null,
        coordinator,
        participant,
        contextId: participant.getMemory().getContext().id,
      };
      this.tasks.set(task.contextId, task);
      this.producers.set(participant.getId(), task);
      this.loops.set(participant.getId(), task);
      this.runtime.join(participant);
      tasks.push(task);
    }
    this.activeInference += 2;
    // Both genuine Mozaik loops start before either inference is awaited.
    for (const task of tasks)
      this.runtime.runLoop(
        task.participant.getId(),
        JSON.stringify({
          cycleId,
          observation,
          focus: task.agentId === "agent-a" ? "NS" : "EW",
        }),
        {
          model:
            this.config.mode === "mock"
              ? "offline-proposal"
              : task.config.model,
          context: task.participant.getMemory().getContext(),
          tools: [],
          maxOutputTokens: 512,
          // Without a schema Gemini wraps its JSON in markdown fences.
          ...(this.config.mode === "live" && {
            structuredOutput: proposalOutput(task.config.provider),
          }),
        },
      );
    return true;
  }
  release(coordinator: Coordinator, cycleId: string) {
    for (const [id, task] of this.producers)
      if (task.coordinator === coordinator && task.cycleId === cycleId) {
        this.producers.delete(id);
        // A timed-out inference may still publish completed/model.answer later.
        // Stop routing its answer, but retire its participant only after model.answer.
      }
  }
  private retireLoop(id: string) {
    const task = this.loops.get(id);
    if (!task) return;
    this.runtime.leave(task.participant);
    this.loops.delete(id);
    this.producers.delete(id);
    if (this.disposed && this.loops.size === 0) this.retireObserver();
  }
  private retireObserver() {
    this.runtime.leave(this.participant);
    this.participant.setHandlers([]);
  }
  providers(): [ProviderStatus, ProviderStatus] {
    const reason = this.config.agents
      .map((a) => a.reason)
      .filter(Boolean)
      .join(" ");
    return [
      {
        provider: "gemini",
        mode: this.config.mode,
        status: reason ? "unavailable" : "ready",
        model: null,
        reason:
          reason ||
          `Proposal agents: A ${this.config.mode === "mock" ? "mock" : this.config.agents[0].provider}, B ${this.config.mode === "mock" ? "mock" : this.config.agents[1].provider}.`,
      },
      {
        provider: "jev",
        mode: this.config.jevMode,
        status: this.jevUnavailable ? "missing_credentials" : "ready",
        model:
          this.config.jevMode === "mock"
            ? "adapter-mock"
            : process.env.TYPESAFE_DEFAULT_MODEL || null,
        reason:
          this.jevUnavailable ??
          (this.config.jevMode === "mock"
            ? "Adapter mock: synthetic choice measurements."
            : null),
      },
    ];
  }
  close() {
    this.disposed = true;
    this.bridge.dispose();
    for (const c of this.coordinators.values()) c.dispose();
    this.coordinators.clear();
    this.producers.clear();
    if (this.loops.size === 0) this.retireObserver();
  }
}
// Plain JSON Schema shared by both providers; Gemini's responseSchema rejects
// additionalProperties, while Anthropic's json_schema format requires it.
function proposalOutput(provider: AgentConfig["provider"]) {
  return {
    name: "traffic_proposal",
    schema: {
      type: "object",
      properties: {
        requestedPhase: { type: "string", enum: ["NS_GREEN", "EW_GREEN"] },
        requestedGreenSeconds: { type: "integer" },
        summary: { type: "string" },
      },
      required: ["requestedPhase", "requestedGreenSeconds", "summary"],
      ...(provider === "claude" && { additionalProperties: false }),
    },
  };
}
function answer(text: string): InferenceOutput {
  return {
    items: [ModelMessageItem.rehydrate({ text })],
    tokenUsage: undefined,
    rowResponse: null,
  };
}
function safeFailure(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : null;
  if (status === 429) return "rate_limit";
  if (status === 503) return "provider_error";
  if (
    error instanceof Error &&
    ["timeout", "rate_limit", "invalid_response", "cancelled"].includes(
      error.message,
    )
  )
    return error.message;
  return "provider_error";
}
