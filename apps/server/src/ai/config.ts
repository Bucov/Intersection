import { supportedModels } from "@mozaik-ai/core";
import { mockFixtures, type MockFixture } from "mozaik-jev-adapter";
export interface AgentConfig {
  provider: "gemini" | "claude";
  model: string;
  reason: string | null;
}
export interface AIConfig {
  mode: "mock" | "live";
  jevMode: "mock" | "live";
  agents: [AgentConfig, AgentConfig];
  fixture: MockFixture;
  deadlineMs: number;
  arbitrationTimeoutMs: number;
  maxInference: number;
  mockLatencyMs: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const mode = env.DEMO_MODE ?? "mock",
    jevMode = env.JEV_MODE ?? mode;
  if (!["mock", "live"].includes(mode) || !["mock", "live"].includes(jevMode))
    throw Error("DEMO_MODE and JEV_MODE must be mock or live.");
  const agents = ["A", "B"].map((letter, i) => {
    const provider =
        env[`AGENT_${letter}_PROVIDER`] ?? (i === 0 ? "gemini" : "claude"),
      model = env[`AGENT_${letter}_MODEL`]?.trim() ?? "";
    if (provider !== "gemini" && provider !== "claude")
      throw Error(`AGENT_${letter}_PROVIDER must be gemini or claude.`);
    const expected = provider === "gemini" ? "google" : "anthropic",
      key = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    const reason =
      mode === "mock"
        ? null
        : !model
          ? `AGENT_${letter}_MODEL must be manually selected.`
          : !supportedModels.some(
                (m) =>
                  m.specification.name === model &&
                  m.specification.provider === expected,
              )
            ? `AGENT_${letter}_MODEL is not supported for ${provider} by Mozaik 4.1.0.`
            : !env[key]?.trim()
              ? `${key} is missing.`
              : null;
    return { provider, model, reason } as AgentConfig;
  }) as [AgentConfig, AgentConfig];
  const fixture = env.JEV_MOCK_FIXTURE ?? "agent-a";
  if (!mockFixtures.includes(fixture as MockFixture))
    throw Error("Unsupported JEV_MOCK_FIXTURE.");
  return {
    mode: mode as AIConfig["mode"],
    jevMode: jevMode as AIConfig["mode"],
    agents,
    fixture: fixture as MockFixture,
    deadlineMs: 8000,
    arbitrationTimeoutMs: 3000,
    maxInference: 8,
    mockLatencyMs: 40,
  };
}
