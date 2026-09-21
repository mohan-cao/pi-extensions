import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "./config.js";
import { classifyWithJev } from "./jev-client.js";
import { policyFor } from "./policies.js";
import { JEV_PROVIDER_ID, registerJevAuthProvider } from "./provider.js";
import type { ClassificationResult } from "./types.js";

function formatDecision(result: ClassificationResult): string {
  const probability = result.probabilities[result.mode] ?? 0;
  return `${result.mode} (confidence=${result.confidence.toFixed(3)}, p=${probability.toFixed(3)})`;
}

export default function piJevResponseRouter(pi: ExtensionAPI): void {
  registerJevAuthProvider(pi);

  const config = loadConfig();
  let enabled = true;
  let debug = false;

  async function resolveApiKey(ctx: ExtensionContext) {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    return auth?.auth.apiKey;
  }

  pi.registerCommand("jev-router", {
    description: "Control/test the Jev response router: status | on | off | debug on|off | classify <text>",
    handler: async (rawArgs, ctx) => {
      const args = rawArgs.trim();

      if (args === "on") {
        enabled = true;
        ctx.ui.notify("Jev response router enabled", "info");
        return;
      }
      if (args === "off") {
        enabled = false;
        ctx.ui.notify("Jev response router disabled", "info");
        return;
      }
      if (args === "debug on") {
        debug = true;
        ctx.ui.notify("Jev response router debug notifications enabled", "info");
        return;
      }
      if (args === "debug off") {
        debug = false;
        ctx.ui.notify("Jev response router debug notifications disabled", "info");
        return;
      }
      if (args.startsWith("classify ")) {
        const apiKey = await resolveApiKey(ctx);
        if (!apiKey) {
          ctx.ui.notify("Jev is not authenticated. Run /login and select TypeSafe Jev (response router).", "warning");
          return;
        }

        const prompt = args.slice("classify ".length).trim();
        try {
          const decision = await classifyWithJev(prompt, apiKey, config, ctx.signal);
          ctx.ui.notify(`Jev: ${formatDecision(decision)}`, "info");
        } catch (error) {
          ctx.ui.notify(
            `Jev classification failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
        return;
      }

      const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
      const authState = auth?.auth.apiKey ? `authenticated (${auth.source ?? "configured"})` : "not authenticated";
      ctx.ui.notify(
        `Jev router: ${enabled ? "on" : "off"}; debug=${debug ? "on" : "off"}; ${authState}; model=${config.model}`,
        "info",
      );
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!enabled || !event.prompt.trim()) return;

    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      if (debug) {
        ctx.ui.notify(
          "Jev router skipped: not authenticated. Run /login and select TypeSafe Jev (response router).",
          "warning",
        );
      }
      return;
    }

    try {
      const decision = await classifyWithJev(event.prompt, apiKey, config, ctx.signal);

      if (debug) {
        ctx.ui.notify(`Jev route: ${formatDecision(decision)}`, "info");
      }

      if (decision.confidence < config.minConfidence) {
        if (debug) {
          ctx.ui.notify(
            `Jev route ignored: confidence ${decision.confidence.toFixed(3)} < ${config.minConfidence.toFixed(3)}`,
            "warning",
          );
        }
        return;
      }

      const policy = policyFor(decision.mode);
      if (!policy) return;

      return {
        systemPrompt: `${event.systemPrompt}\n\n${policy}`,
      };
    } catch (error) {
      // Fail open: a classifier outage should not prevent Pi from answering.
      if (debug) {
        ctx.ui.notify(
          `Jev router failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return;
    }
  });
}

export { classifyWithJev, parseClassificationResponse } from "./jev-client.js";
export { policyFor } from "./policies.js";
export type { ClassificationResult, ResponseMode, RouterConfig } from "./types.js";
