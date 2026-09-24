import { type JevConfig, type RouterConfig, type TrajectoryConfig } from "@mohan-cao/jev-classifier";
import type { VerifyConfig } from "@mohan-cao/jev-verify";
import { PHASES, type Phase, type PhaseConfig } from "@mohan-cao/jev-phase";

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadConfig(): RouterConfig {
  // PI_JEV_ROUTER_MIN_CONFIDENCE was the pre-0.2 knob. It was effectively a
  // no-op (confidence is in [0, 1] and the default was 0), so it now serves as
  // a shared fallback default for the two real thresholds.
  const legacyMinConfidence = numberFromEnv("PI_JEV_ROUTER_MIN_CONFIDENCE", 0);

  return {
    endpoint: process.env.PI_JEV_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone",
    model: process.env.PI_JEV_MODEL ?? "jev-latest",
    // Jev answers in ~300-550ms. A hung classifier blocks every prompt, so the
    // default is deliberately short; fail-open covers the rest.
    timeoutMs: Math.max(1, numberFromEnv("PI_JEV_ROUTER_TIMEOUT_MS", 5_000)),
    retries: Math.max(0, Math.floor(numberFromEnv("PI_JEV_ROUTER_RETRIES", 2))),
    decompositionThreshold: clamp01(
      numberFromEnv("PI_JEV_ROUTER_DECOMPOSITION_THRESHOLD", legacyMinConfidence || 0.6),
    ),
    boundedVerificationThreshold: clamp01(
      numberFromEnv("PI_JEV_ROUTER_BOUNDED_THRESHOLD", legacyMinConfidence || 0.6),
    ),
    premiseDefectThreshold: clamp(numberFromEnv("PI_JEV_ROUTER_PREMISE_THRESHOLD", 2.8), 0, 3),
    historyTurns: Math.max(0, Math.floor(numberFromEnv("PI_JEV_ROUTER_HISTORY_TURNS", 4))),
    cacheTtlMs: Math.max(0, numberFromEnv("PI_JEV_ROUTER_CACHE_TTL_MS", 300_000)),
    cacheMaxEntries: Math.max(0, Math.floor(numberFromEnv("PI_JEV_ROUTER_CACHE_MAX", 64))),
  };
}

/**
 * Verification's own thresholds, layered on the transport settings.
 *
 * The component owns these because they are only meaningful to it — the core's
 * config stops at transport, so nothing in the classifier needs an opinion about
 * what a sensible evasion threshold is.
 */
export function loadVerifyConfig(jev: JevConfig): VerifyConfig {
  return {
    ...jev,
    enabled: boolFromEnv("PI_JEV_ROUTER_VERIFY", true),
    evasiveThreshold: clamp01(numberFromEnv("PI_JEV_ROUTER_VERIFY_EVASIVE_THRESHOLD", 0.6)),
    answersThreshold: clamp01(numberFromEnv("PI_JEV_ROUTER_VERIFY_ANSWERS_THRESHOLD", 0.35)),
    obligationThreshold: clamp(
      numberFromEnv("PI_JEV_ROUTER_VERIFY_OBLIGATION_THRESHOLD", 1.5),
      0,
      3,
    ),
  };
}

/** The only place the environment variable names appear. */
const PHASE_ENV = {
  build: "PI_JEV_PHASE_BUILD_MODEL",
  design: "PI_JEV_PHASE_DESIGN_MODEL",
  general: "PI_JEV_PHASE_GENERAL_MODEL",
} satisfies Record<Phase, string>;

/**
 * Semantic phase routing stays separate from model policy: Jev emits phases, and
 * this map is the only place a provider or model name appears. The reverse
 * lookup (model to phase) is what decides whether a nudge is warranted.
 *
 * `overrides` comes from the preferences file, written by `/jev-router route`.
 * A preference wins over the environment, and an empty string is a real value
 * that clears a route the environment would otherwise set — so the test below
 * is truthiness, not presence.
 */

export function loadPhaseConfig(overrides?: Partial<Record<Phase, string>>): PhaseConfig {
  const routes: PhaseConfig["routes"] = {};
  for (const phase of PHASES) {
    const model = overrides?.[phase] ?? process.env[PHASE_ENV[phase]];
    if (model) routes[phase] = { model };
  }

  return {
    routes,
    phaseConfidenceThreshold: clamp(numberFromEnv("PI_JEV_PHASE_CONFIDENCE_THRESHOLD", 0.7), 0, 1),
    historyTurns: Math.max(0, Math.floor(numberFromEnv("PI_JEV_PHASE_HISTORY_TURNS", 8))),
  };
}

/** Independent of phase: coaching is about the process, not the work's kind. */
export function loadTrajectoryConfig(): TrajectoryConfig {
  return {
    trajectoryConfidenceThreshold: clamp(numberFromEnv("PI_JEV_TRAJECTORY_THRESHOLD", 0.7), 0, 1),
    historyTurns: Math.max(0, Math.floor(numberFromEnv("PI_JEV_TRAJECTORY_HISTORY_TURNS", 8))),
  };
}
