import type { RouterConfig } from "./types.js";

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): RouterConfig {
  return {
    endpoint: process.env.PI_JEV_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone",
    model: process.env.PI_JEV_MODEL ?? "jev-latest",
    // Jev answers in ~300-550ms. A hung classifier blocks every prompt, so the
    // default is deliberately short; fail-open covers the rest.
    timeoutMs: Math.max(1, numberFromEnv("PI_JEV_ROUTER_TIMEOUT_MS", 5_000)),
    retries: Math.max(0, Math.floor(numberFromEnv("PI_JEV_ROUTER_RETRIES", 2))),
    minConfidence: Math.min(
      1,
      Math.max(0, numberFromEnv("PI_JEV_ROUTER_MIN_CONFIDENCE", 0)),
    ),
    cacheTtlMs: Math.max(0, numberFromEnv("PI_JEV_ROUTER_CACHE_TTL_MS", 300_000)),
    cacheMaxEntries: Math.max(0, Math.floor(numberFromEnv("PI_JEV_ROUTER_CACHE_MAX", 64))),
  };
}
