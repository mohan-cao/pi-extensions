import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type { DecisionRecord } from "@mohan-cao/jev-classifier";

const FILE_NAME = "jev-decisions.jsonl";

/** e.g. `~/.pi/agent/jev-decisions.jsonl`, honoring PI_CODING_AGENT_DIR. */
export function decisionLogPath(): string {
  return join(getAgentDir(), FILE_NAME);
}

/** One JSON object per line. Best-effort: logging must never break a session. */
export function appendDecision(record: DecisionRecord): boolean {
  const path = decisionLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}
