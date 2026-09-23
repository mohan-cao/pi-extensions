import type { RouterConfig } from "@mohan-cao/jev-classifier";

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
    verify: boolFromEnv("PI_JEV_ROUTER_VERIFY", true),
    verifyEvasiveThreshold: clamp01(numberFromEnv("PI_JEV_ROUTER_VERIFY_EVASIVE_THRESHOLD", 0.6)),
    verifyAnswersThreshold: clamp01(numberFromEnv("PI_JEV_ROUTER_VERIFY_ANSWERS_THRESHOLD", 0.35)),
    verifyObligationThreshold: clamp(
      numberFromEnv("PI_JEV_ROUTER_VERIFY_OBLIGATION_THRESHOLD", 1.5),
      0,
      3,
    ),
  };
}
