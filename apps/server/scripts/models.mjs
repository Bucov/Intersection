import { supportedModels } from "@mozaik-ai/core";
for (const provider of ["google", "anthropic"]) {
  console.log(
    provider === "google"
      ? "Gemini — AGENT_*_PROVIDER=gemini"
      : "Claude — AGENT_*_PROVIDER=claude",
  );
  for (const { specification: s } of supportedModels.filter(
    (m) => m.specification.provider === provider,
  ))
    console.log(`  ${s.name}`);
}
