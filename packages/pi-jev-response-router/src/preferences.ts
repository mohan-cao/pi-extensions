import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { FOOTER_MODES, type FooterMode } from "@mohan-cao/jev-classifier";

/**
 * Runtime toggles that survive `/reload` and new sessions.
 *
 * Pi's storage guidance puts state living outside one session in external
 * storage, and there is no settings API for extensions, so the extension owns
 * a small JSON file under the agent config directory. Only runtime toggles
 * live here — endpoint, model, thresholds, and routes stay in env/config.
 */
export interface Preferences {
  enabled?: boolean;
  debug?: boolean;
  verify?: boolean;
  phase?: boolean;
  footer?: FooterMode;
}

const FILE_NAME = "pi-jev-response-router.json";

/** e.g. `~/.pi/agent/pi-jev-response-router.json`, honoring PI_CODING_AGENT_DIR. */
export function preferencesPath(): string {
  return join(getAgentDir(), FILE_NAME);
}

function isFooterMode(value: unknown): value is FooterMode {
  return typeof value === "string" && (FOOTER_MODES as readonly string[]).includes(value);
}

/** Missing, unreadable, or corrupt files yield `{}` rather than throwing. */
export function loadPreferences(): Preferences {
  const path = preferencesPath();
  if (!existsSync(path)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const record = parsed as Record<string, unknown>;
    const preferences: Preferences = {};
    if (typeof record.enabled === "boolean") preferences.enabled = record.enabled;
    if (typeof record.debug === "boolean") preferences.debug = record.debug;
    if (typeof record.verify === "boolean") preferences.verify = record.verify;
    if (typeof record.phase === "boolean") preferences.phase = record.phase;
    if (isFooterMode(record.footer)) preferences.footer = record.footer;
    return preferences;
  } catch {
    return {};
  }
}

/** Best-effort: a persistence failure must never break a session. */
export function savePreferences(preferences: Preferences): boolean {
  const path = preferencesPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
