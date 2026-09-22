import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { TtlCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { recentHistory } from "./context.js";
import { classifyWithJev } from "./jev-client.js";
import { policyFor } from "./policies.js";
import { JEV_PROVIDER_ID, registerJevAuthProvider } from "./provider.js";
import type { ClassificationResult } from "./types.js";

/** System-prompt section key. Pi wraps the value in a tag of the same name. */
const POLICY_SECTION = "jev-response-policy";

function formatDecision(result: ClassificationResult): string {
  const { decomposition, boundedVerification } = result.signals;
  const suffix = result.cached ? ", cached" : "";
  return `${result.mode} (p_decomp=${decomposition.toFixed(3)}, p_bounded=${boundedVerification.toFixed(3)}${suffix})`;
}

export default function piJevResponseRouter(pi: ExtensionAPI): void {
  registerJevAuthProvider(pi);

  const config = loadConfig();
  const cache = new TtlCache<ClassificationResult>(config.cacheTtlMs, config.cacheMaxEntries);
  let enabled = true;
  let debug = false;

  async function resolveApiKey(ctx: ExtensionContext) {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    return auth?.auth.apiKey;
  }

  pi.registerCommand("jev-router", {
    description:
      "Control/test the Jev response router: status | on | off | debug on|off | clear-cache | classify <text>",
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
      if (args === "clear-cache") {
        cache.clear();
        ctx.ui.notify("Jev classification cache cleared", "info");
        return;
      }
      if (args.startsWith("classify ")) {
        const apiKey = await resolveApiKey(ctx);
        if (!apiKey) {
          ctx.ui.notify(
            "Jev is not authenticated. Run /login and select TypeSafe Jev (response router).",
            "warning",
          );
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
      const authState = auth?.auth.apiKey
        ? `authenticated (${auth.source ?? "configured"})`
        : "not authenticated";
      ctx.ui.notify(
        [
          `Jev router: ${enabled ? "on" : "off"}`,
          `debug=${debug ? "on" : "off"}`,
          authState,
          `model=${config.model}`,
          `thresholds: decomp>=${config.decompositionThreshold}, bounded>=${config.boundedVerificationThreshold}`,
          `history=${config.historyTurns} turns`,
          `cache=${cache.size}/${config.cacheMaxEntries}`,
        ].join("; "),
        "info",
      );
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Clear the previous turn's steering so a `normal` classification cannot
    // inherit a stale policy.
    delete event.systemPromptOptions.sections[POLICY_SECTION];

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
      const history = recentHistory(ctx, config.historyTurns, event.prompt);
      const cacheKey = JSON.stringify([event.prompt, history]);

      let decision = cache.get(cacheKey);
      if (decision) {
        decision = { ...decision, cached: true };
      } else {
        decision = await classifyWithJev(event.prompt, apiKey, config, ctx.signal, history);
        cache.set(cacheKey, decision);
      }

      if (debug) {
        ctx.ui.notify(`Jev route: ${formatDecision(decision)}`, "info");
      }

      const policy = policyFor(decision.mode);
      if (!policy) return;

      // Mutating `sections` lets Pi emit a minimal prompt patch and keep the
      // provider cache prefix intact. Returning `systemPrompt` would replace
      // the whole prompt on every mode change, i.e. a full cache miss.
      event.systemPromptOptions.sections[POLICY_SECTION] = policy;
      return;
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

export { classifyWithJev, parseClassificationResponse, parseNoulAnswer } from "./jev-client.js";
export { policyFor } from "./policies.js";
export { TtlCache } from "./cache.js";
export type { ClassificationResult, ResponseMode, RouterConfig } from "./types.js";
