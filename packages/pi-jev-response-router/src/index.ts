import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { TtlCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { lastExchange, recentHistory } from "./context.js";
import { classifyWithJev } from "./jev-client.js";
import { policyFor, premisePolicyFor } from "./policies.js";
import { loadPreferences, preferencesPath, savePreferences } from "./preferences.js";
import { JEV_PROVIDER_ID, registerJevAuthProvider } from "./provider.js";
import { FOOTER_MODES, type ClassificationResult, type FooterMode } from "./types.js";
import { formatVerifyStatus, verifyResponse } from "./verify.js";

/** System-prompt section key. Pi wraps the value in a tag of the same name. */
const POLICY_SECTION = "jev-response-policy";
const PREMISE_SECTION = "jev-premise-policy";
const VERIFY_STATUS_KEY = "jev-verify";

function formatDecision(result: ClassificationResult): string {
  const { decomposition, boundedVerification, premiseDefect } = result.signals;
  const suffix = result.cached ? ", cached" : "";
  return `${result.mode} (p_decomp=${decomposition.toFixed(3)}, p_bounded=${boundedVerification.toFixed(3)}, premise=${premiseDefect.toFixed(2)}${suffix})`;
}

export default function piJevResponseRouter(pi: ExtensionAPI): void {
  registerJevAuthProvider(pi);

  const config = loadConfig();
  const cache = new TtlCache<ClassificationResult>(config.cacheTtlMs, config.cacheMaxEntries);

  // Persisted preferences win over environment-derived defaults, so a command is
  // durable while env still works as a one-shot override when no file exists.
  const stored = loadPreferences();
  let enabled = stored.enabled ?? true;
  let debug = stored.debug ?? false;
  let verifyEnabled = stored.verify ?? config.verify;
  let footer: FooterMode = stored.footer ?? "compact";

  function persist(): boolean {
    return savePreferences({ enabled, debug, verify: verifyEnabled, footer });
  }

  async function resolveApiKey(ctx: ExtensionContext) {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    return auth?.auth.apiKey;
  }

  function booleanToggle(value: string): boolean | undefined {
    if (value === "on") return true;
    if (value === "off") return false;
    return undefined;
  }

  function setEnabled(value: boolean, ctx: ExtensionContext): void {
    enabled = value;
    persist();
    if (!enabled) ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
    ctx.ui.notify(`Jev response router ${enabled ? "enabled" : "disabled"}`, "info");
  }

  function setDebug(rest: string, ctx: ExtensionContext): void {
    const next = booleanToggle(rest);
    if (next === undefined) {
      ctx.ui.notify("Usage: /jev-router debug on|off", "warning");
      return;
    }
    debug = next;
    persist();
    ctx.ui.notify(`Jev response router debug notifications ${next ? "enabled" : "disabled"}`, "info");
  }

  function setVerify(rest: string, ctx: ExtensionContext): void {
    const next = booleanToggle(rest);
    if (next === undefined) {
      ctx.ui.notify("Usage: /jev-router verify on|off", "warning");
      return;
    }
    verifyEnabled = next;
    persist();
    if (!verifyEnabled) ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
    ctx.ui.notify(`Jev post-generation verification ${next ? "enabled" : "disabled"}`, "info");
  }

  function setFooter(rest: string, ctx: ExtensionContext): void {
    if (!(FOOTER_MODES as readonly string[]).includes(rest)) {
      ctx.ui.notify(`Unknown footer mode "${rest}". Use: ${FOOTER_MODES.join(", ")}.`, "warning");
      return;
    }
    footer = rest as FooterMode;
    persist();
    ctx.ui.notify(`Jev footer mode: ${footer}`, "info");
  }

  function clearCache(ctx: ExtensionContext): void {
    cache.clear();
    ctx.ui.notify("Jev classification cache cleared", "info");
  }

  async function reportStatus(ctx: ExtensionContext): Promise<void> {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    const authState = auth?.auth.apiKey
      ? `authenticated (${auth.source ?? "configured"})`
      : "not authenticated";
    ctx.ui.notify(
      [
        `Jev router: ${enabled ? "on" : "off"}`,
        `verify=${verifyEnabled ? "on" : "off"}`,
        `debug=${debug ? "on" : "off"}`,
        `footer=${footer}`,
        authState,
        `model=${config.model}`,
        `thresholds: decomp>=${config.decompositionThreshold}, bounded>=${config.boundedVerificationThreshold}`,
        `history=${config.historyTurns} turns`,
        `cache=${cache.size}/${config.cacheMaxEntries}`,
        `prefs=${preferencesPath()}`,
      ].join("; "),
      "info",
    );
  }

  async function runClassify(prompt: string, ctx: ExtensionContext): Promise<void> {
    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      ctx.ui.notify(
        "Jev is not authenticated. Run /login and select TypeSafe Jev (response router).",
        "warning",
      );
      return;
    }

    try {
      const decision = await classifyWithJev(prompt, apiKey, config, ctx.signal);
      ctx.ui.notify(`Jev: ${formatDecision(decision)}`, "info");
    } catch (error) {
      ctx.ui.notify(
        `Jev classification failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  type Command = (rest: string, ctx: ExtensionContext) => void | Promise<void>;

  const reportStatusCommand: Command = (_rest, ctx) => reportStatus(ctx);

  const commands = new Map<string, Command>([
    ["on", (_rest, ctx) => setEnabled(true, ctx)],
    ["off", (_rest, ctx) => setEnabled(false, ctx)],
    ["debug", setDebug],
    ["verify", setVerify],
    ["footer", setFooter],
    ["clear-cache", (_rest, ctx) => clearCache(ctx)],
    [
      "classify",
      (rest, ctx) => {
        if (!rest) {
          ctx.ui.notify("Usage: /jev-router classify <text>", "warning");
          return;
        }
        return runClassify(rest, ctx);
      },
    ],
    ["status", reportStatusCommand],
  ]);

  pi.registerCommand("jev-router", {
    description:
      "Control/test the Jev response router: status | on | off | debug on|off | verify on|off | footer compact|icons|off | clear-cache | classify <text>",
    handler: async (rawArgs, ctx) => {
      const [verb = "", ...rest] = rawArgs.trim().split(/\s+/);
      const command = commands.get(verb) ?? reportStatusCommand;
      await command(rest.join(" "), ctx);
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Clear the previous turn's indicator and steering so a `normal`
    // classification cannot inherit stale state.
    if (ctx.hasUI) ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
    delete event.systemPromptOptions.sections[POLICY_SECTION];
    delete event.systemPromptOptions.sections[PREMISE_SECTION];

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

      // Mutating `sections` lets Pi emit a minimal prompt patch and keep the
      // provider cache prefix intact. Returning `systemPrompt` would replace
      // the whole prompt on every mode change, i.e. a full cache miss.
      const policy = policyFor(decision.mode);
      if (policy) {
        event.systemPromptOptions.sections[POLICY_SECTION] = policy;
      }

      const premisePolicy = premisePolicyFor(
        decision.mode,
        decision.signals.premiseDefect,
        config.premiseDefectThreshold,
      );
      if (premisePolicy) {
        event.systemPromptOptions.sections[PREMISE_SECTION] = premisePolicy;
      }

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

  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled || !verifyEnabled) return;
    // The only product of verification is a status indicator, so skip the Jev
    // call entirely when there is nowhere to render it (e.g. -p / json mode).
    if (!ctx.hasUI) return;

    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) return;

    const exchange = lastExchange(ctx);
    if (!exchange) return;

    try {
      const result = await verifyResponse(
        exchange.request,
        exchange.response,
        apiKey,
        config,
        ctx.signal,
      );

      ctx.ui.setStatus(VERIFY_STATUS_KEY, formatVerifyStatus(result, footer));

      if (debug) {
        ctx.ui.notify(
          `Jev verify: ${result.flag} (answers=${result.answersQuestion.toFixed(2)}, evasive=${result.evasive.toFixed(2)}, obligation=${result.obligationUnmet.toFixed(2)})`,
          "info",
        );
      }
    } catch (error) {
      // Verification is advisory; never let it affect the run.
      if (debug) {
        ctx.ui.notify(
          `Jev verify failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
  });
}

export {
  classifyWithJev,
  parseClassificationResponse,
  parseNoulAnswer,
  parseScoreAnswer,
} from "./jev-client.js";
export { policyFor, premisePolicyFor } from "./policies.js";
export { verifyResponse, formatVerifyStatus } from "./verify.js";
export { TtlCache } from "./cache.js";
export { loadPreferences, preferencesPath, savePreferences } from "./preferences.js";
export type { Preferences } from "./preferences.js";
export { FOOTER_MODES } from "./types.js";
export type {
  ClassificationResult,
  FooterMode,
  ResponseMode,
  RouterConfig,
} from "./types.js";
export type { VerifyResult, VerifyFlag } from "./verify.js";
