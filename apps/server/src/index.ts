import "dotenv/config";
import { buildApp } from "./app.js";
import { AIService } from "./ai/service.js";
import { readConfig } from "./ai/config.js";
const config = readConfig();
for (const [i, agent] of config.agents.entries())
  if (agent.reason)
    console.warn(`Agent ${i === 0 ? "A" : "B"} unavailable: ${agent.reason}`);
const ai = new AIService(config);
if (ai.jevUnavailable) console.warn(`JEV unavailable: ${ai.jevUnavailable}`);
console.log(ai.cloud.message);
const { app } = await buildApp({
  demoMode: config.mode,
  jevMode: config.jevMode,
  setup: (e) => ai.attach(e),
  providers: () => ai.providers(),
});
app.addHook("onClose", async () => ai.close());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
});
