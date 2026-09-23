import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  PHASES,
  TtlCache,
  classifyWithJev,
  formatCoaching,
  formatPhaseNudge,
  formatVerifyStatus,
  judgePhase,
  judgeTrajectory,
  phaseRecommendation,
  policyFor,
  premisePolicyFor,
  verifyResponse,
  type ClassificationResult,
  type DecisionRecord,
  type Phase,
  type PhaseJudgment,
  type PhaseRecommendation,
  type TrajectoryJudgment,
  type VerifyResult,
} from "@mohan-cao/jev-classifier";

import {
  ROUTER_COMMAND_DESCRIPTION,
  createRouterCommandHandler,
  type PhaseRouteInfo,
  type RouterState,
} from "./commands.js";
import { loadConfig, loadPhaseConfig, loadTrajectoryConfig } from "./config.js";
import { lastExchange, recentHistory } from "./context.js";
import { appendDecision, decisionLogPath } from "./decision-log.js";
import {
  loadPreferences,
  preferencesPath,
  savePreferences,
  type Preferences,
} from "./preferences.js";
import { JEV_PROVIDER_ID, registerJevAuthProvider } from "./provider.js";

/** System-prompt section keys. Pi wraps each value in a tag of the same name. */
const POLICY_SECTION = "jev-response-policy";
const PREMISE_SECTION = "jev-premise-policy";
const VERIFY_STATUS_KEY = "jev-verify";
const PHASE_STATUS_KEY = "jev-next";
const COACHING_STATUS_KEY = "jev-progress";

function formatDecision(result: ClassificationResult): string {
  const { decomposition, boundedVerification, premiseDefect } = result.signals;
  const suffix = result.cached ? ", cached" : "";
  return `${result.mode} (p_decomp=${decomposition.toFixed(3)}, p_bounded=${boundedVerification.toFixed(3)}, premise=${premiseDefect.toFixed(2)}${suffix})`;
}

export default function piJevResponseRouter(pi: ExtensionAPI): void {
  registerJevAuthProvider(pi);

  const config = loadConfig();
  const trajectoryConfig = loadTrajectoryConfig();
  const cache = new TtlCache<ClassificationResult>(config.cacheTtlMs, config.cacheMaxEntries);

  // Persisted preferences win over environment-derived defaults, so a command is
  // durable while env still works as a one-shot override when no file exists.
  const stored = loadPreferences();

  // Phase routes follow the same precedence, and a picker choice has to take
  // effect without a restart — hence `let`, reloaded by `setRoute` below.
  let routeOverrides: Partial<Record<Phase, string>> = stored.routes ?? {};
  let phaseConfig = loadPhaseConfig(routeOverrides);
  const state: RouterState = {
    enabled: stored.enabled ?? true,
    debug: stored.debug ?? false,
    verify: stored.verify ?? config.verify,
    phase: stored.phase ?? true,
    coaching: stored.coaching ?? true,
    log: stored.log ?? true,
    footer: stored.footer ?? "compact",
  };

  // Assembled across a turn: classification in `before_agent_start`, the
  // post-generation judgments in `agent_settled`, written once at the end.
  let pending: DecisionRecord | undefined;

  // Kept for the status readout, so "why is nothing showing?" is answerable.
  let lastPhase: PhaseJudgment | undefined;
  let lastRecommendation: PhaseRecommendation | undefined;
  let lastTrajectory: TrajectoryJudgment | undefined;

  function persist(): boolean {
    const preferences: Preferences = {
      enabled: state.enabled,
      debug: state.debug,
      verify: state.verify,
      phase: state.phase,
      coaching: state.coaching,
      log: state.log,
      footer: state.footer,
    };
    // Omitted entirely when unset, so a file that never used routes stays clean.
    if (Object.keys(routeOverrides).length > 0) preferences.routes = routeOverrides;
    return savePreferences(preferences);
  }

  /**
   * Model ids for the picker. Routes are matched on `model.id` alone — that is
   * what `ctx.model.id` gives the reverse lookup — so ids are deduped across
   * providers rather than offered as provider-qualified duplicates.
   */
  function availableModels(ctx: ExtensionContext): string[] {
    const ids: string[] = [];
    for (const model of ctx.modelRegistry.getAvailable()) {
      if (!ids.includes(model.id)) ids.push(model.id);
    }
    return ids;
  }

  function phaseRoutes(): PhaseRouteInfo[] {
    const routes: PhaseRouteInfo[] = [];
    for (const phase of PHASES) {
      const model = phaseConfig.routes[phase]?.model;
      if (!model) continue;
      routes.push({ phase, model, source: routeOverrides[phase] ? "preference" : "env" });
    }
    return routes;
  }

  /** An empty `model` records an explicit clear, overriding any env var. */
  function setRoute(phase: Phase, model: string): boolean {
    routeOverrides = { ...routeOverrides, [phase]: model };
    const saved = persist();
    phaseConfig = loadPhaseConfig(routeOverrides);
    return saved;
  }

  async function resolveApiKey(ctx: ExtensionContext) {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    return auth?.auth.apiKey;
  }

  function describeLastPhase(): string {
    if (!lastPhase) return "none yet";
    const nudge = lastRecommendation ? "" : " (no nudge)";
    return `${lastPhase.phase}@${lastPhase.phaseConfidence.toFixed(2)}${nudge}`;
  }

  function describeLastTrajectory(): string {
    if (!lastTrajectory) return "none yet";
    return `${lastTrajectory.trajectory}@${lastTrajectory.trajectoryConfidence.toFixed(2)}`;
  }

  async function reportStatus(ctx: ExtensionContext): Promise<void> {
    const auth = await ctx.modelRegistry.getProviderAuth(JEV_PROVIDER_ID);
    const authState = auth?.auth.apiKey
      ? `authenticated (${auth.source ?? "configured"})`
      : "not authenticated";
    // `*` marks a route chosen with /jev-router route, over an env-provided one.
    const routes = phaseRoutes().map(
      (route) => `${route.phase}${route.source === "preference" ? "*" : ""}`,
    );
    ctx.ui.notify(
      [
        `Jev router: ${state.enabled ? "on" : "off"}`,
        `verify=${state.verify ? "on" : "off"}`,
        `phase=${state.phase ? "on" : "off"}`,
        `coaching=${state.coaching ? "on" : "off"}`,
        `log=${state.log ? "on" : "off"}`,
        `debug=${state.debug ? "on" : "off"}`,
        `footer=${state.footer}`,
        authState,
        `model=${config.model}`,
        `thresholds: decomp>=${config.decompositionThreshold}, bounded>=${config.boundedVerificationThreshold}`,
        `history=${config.historyTurns} turns`,
        `cache=${cache.size}/${config.cacheMaxEntries}`,
        `prefs=${preferencesPath()}`,
        `decisions=${decisionLogPath()}`,
        `phaseRoutes=${routes.length > 0 ? routes.join(",") : "none — set one with /jev-router route"}`,
        `currentModel=${ctx.model?.id ?? "unknown"}`,
        `lastPhase=${describeLastPhase()}`,
        `lastTrajectory=${describeLastTrajectory()}`,
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

  async function runVerification(
    apiKey: string,
    ctx: ExtensionContext,
  ): Promise<VerifyResult | undefined> {
    const exchange = lastExchange(ctx);
    if (!exchange) return undefined;

    try {
      const result = await verifyResponse(
        exchange.request,
        exchange.response,
        apiKey,
        config,
        ctx.signal,
      );

      ctx.ui.setStatus(VERIFY_STATUS_KEY, formatVerifyStatus(result, state.footer));

      if (state.debug) {
        ctx.ui.notify(
          `Jev verify: ${result.flag} (answers=${result.answersQuestion.toFixed(2)}, evasive=${result.evasive.toFixed(2)}, obligation=${result.obligationUnmet.toFixed(2)})`,
          "info",
        );
      }
      return result;
    } catch (error) {
      // Verification is advisory; never let it affect the run.
      if (state.debug) {
        ctx.ui.notify(
          `Jev verify failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return undefined;
    }
  }

  async function runPhaseJudgment(
    apiKey: string,
    ctx: ExtensionContext,
  ): Promise<{ judgment: PhaseJudgment; recommendedModel?: string } | undefined> {
    const turns = recentHistory(ctx, phaseConfig.historyTurns, "");
    if (turns.length === 0) return undefined;

    try {
      const judgment = await judgePhase(turns, apiKey, config, ctx.signal);
      const recommendation = phaseRecommendation(judgment, ctx.model?.id, phaseConfig);
      lastPhase = judgment;
      lastRecommendation = recommendation;

      ctx.ui.setStatus(PHASE_STATUS_KEY, formatPhaseNudge(recommendation, state.footer));

      if (state.debug) {
        ctx.ui.notify(
          `Jev phase: ${judgment.phase} (conf=${judgment.phaseConfidence.toFixed(2)})`,
          "info",
        );
      }
      return recommendation?.model
        ? { judgment, recommendedModel: recommendation.model }
        : { judgment };
    } catch (error) {
      // Phase judgment is advisory; never let it affect the run.
      if (state.debug) {
        ctx.ui.notify(
          `Jev phase failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return undefined;
    }
  }

  async function runTrajectoryJudgment(
    apiKey: string,
    ctx: ExtensionContext,
  ): Promise<{ judgment: TrajectoryJudgment; hint: boolean } | undefined> {
    const turns = recentHistory(ctx, trajectoryConfig.historyTurns, "");
    if (turns.length === 0) return undefined;

    try {
      const judgment = await judgeTrajectory(turns, apiKey, config, ctx.signal);
      lastTrajectory = judgment;

      const hint = formatCoaching(
        judgment,
        state.footer,
        trajectoryConfig.trajectoryConfidenceThreshold,
      );
      ctx.ui.setStatus(COACHING_STATUS_KEY, hint);

      if (state.debug) {
        ctx.ui.notify(
          `Jev trajectory: ${judgment.trajectory} (conf=${judgment.trajectoryConfidence.toFixed(2)})`,
          "info",
        );
      }
      return { judgment, hint: hint !== undefined };
    } catch (error) {
      // Coaching is advisory; never let it affect the run.
      if (state.debug) {
        ctx.ui.notify(
          `Jev trajectory failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return undefined;
    }
  }

  pi.registerCommand("jev-router", {
    description: ROUTER_COMMAND_DESCRIPTION,
    handler: createRouterCommandHandler({
      state,
      persist,
      clearCache: () => cache.clear(),
      clearStatuses: (ctx) => {
        ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
        ctx.ui.setStatus(PHASE_STATUS_KEY, undefined);
        ctx.ui.setStatus(COACHING_STATUS_KEY, undefined);
      },
      classify: runClassify,
      reportStatus,
      phaseRoutes,
      availableModels,
      setRoute,
    }),
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Clear the previous turn's indicator and steering so a `normal`
    // classification cannot inherit stale state.
    if (ctx.hasUI) {
      ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
      ctx.ui.setStatus(PHASE_STATUS_KEY, undefined);
      ctx.ui.setStatus(COACHING_STATUS_KEY, undefined);
    }
    delete event.systemPromptOptions.sections[POLICY_SECTION];
    delete event.systemPromptOptions.sections[PREMISE_SECTION];

    pending = { at: new Date().toISOString() };

    if (!state.enabled || !event.prompt.trim()) return;

    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) {
      if (state.debug) {
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

      pending.mode = decision.mode;
      pending.signals = decision.signals;

      if (state.debug) {
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
      if (state.debug) {
        ctx.ui.notify(
          `Jev router failed open: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return;
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!state.enabled) return;
    // Both judgments only produce status indicators, so skip the Jev calls
    // entirely when there is nowhere to render them (e.g. -p / json mode).
    if (!ctx.hasUI) return;

    const apiKey = await resolveApiKey(ctx);
    if (!apiKey) return;

    // Independent judgments, so run them concurrently: wall clock is the slowest,
    // not the sum. Each catches its own errors, but allSettled means an unexpected
    // throw in one cannot silently drop the others.
    const [verification, phase, trajectory] = await Promise.allSettled([
      state.verify ? runVerification(apiKey, ctx) : Promise.resolve(undefined),
      state.phase ? runPhaseJudgment(apiKey, ctx) : Promise.resolve(undefined),
      state.coaching ? runTrajectoryJudgment(apiKey, ctx) : Promise.resolve(undefined),
    ]);

    if (state.debug) {
      for (const result of [verification, phase, trajectory]) {
        if (result.status === "rejected") {
          ctx.ui.notify(
            `Jev judgment rejected: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            "warning",
          );
        }
      }
    }

    if (state.log) {
      const record: DecisionRecord = pending ?? { at: new Date().toISOString() };
      if (ctx.model?.id) record.modelRunning = ctx.model.id;
      if (verification.status === "fulfilled" && verification.value) {
        record.verify = verification.value;
      }
      if (phase.status === "fulfilled" && phase.value) {
        record.phase = phase.value.judgment;
        if (phase.value.recommendedModel) record.recommendedModel = phase.value.recommendedModel;
      }
      if (trajectory.status === "fulfilled" && trajectory.value) {
        record.trajectory = trajectory.value.judgment;
        record.coachingHint = trajectory.value.hint;
      }
      appendDecision(record);
    }
    pending = undefined;
  });
}

// Re-export the core surface so existing consumers keep working.
export {
  FOOTER_MODES,
  PHASES,
  TRAJECTORIES,
  TtlCache,
  buildState,
  classifyWithJev,
  composeMode,
  formatCoaching,
  formatPhaseNudge,
  formatVerifyStatus,
  judgePhase,
  parseClassificationResponse,
  parseNoulAnswer,
  parseScoreAnswer,
  phaseRecommendation,
  policyFor,
  premisePolicyFor,
  verifyResponse,
} from "@mohan-cao/jev-classifier";
export type {
  ClassificationResult,
  ClassificationSignals,
  FooterMode,
  Phase,
  PhaseConfig,
  PhaseJudgment,
  PhaseRecommendation,
  ResponseMode,
  RouterConfig,
  Trajectory,
  VerifyFlag,
  VerifyResult,
} from "@mohan-cao/jev-classifier";
export { loadPreferences, preferencesPath, savePreferences } from "./preferences.js";
export type { Preferences } from "./preferences.js";
