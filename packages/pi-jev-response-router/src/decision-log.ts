import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import type {
  ClassificationSignals,
  ResponseMode,
  TrajectoryJudgment,
  VerifyResult,
} from "@mohan-cao/jev-classifier";
import type { PhaseJudgment } from "@mohan-cao/jev-phase";

const FILE_NAME = "jev-decisions.jsonl";

/**
 * One settled turn, as this extension judged it.
 *
 * Deliberately contains **no conversation text** — only judgments, probabilities,
 * and model ids.
 *
 * Acceptance of a model nudge is derived by diffing consecutive records: if
 * `recommendedModel` at turn N equals `modelRunning` at turn N+1, the user acted
 * on it. That is the only correctness proxy available without hand-labelling, and
 * it only produces data when routes are configured.
 *
 * This type lives here rather than in the core because it is a **host concern**:
 * it names the judgments this particular collection runs, and the writer needs
 * the agent directory. The core stays dependency- and preference-free, which
 * means it cannot reference component types.
 */
export interface DecisionRecord {
  /** ISO 8601. */
  at: string;
  /** Absent when classification failed open for this turn. */
  mode?: ResponseMode;
  signals?: ClassificationSignals;
  /** The model that answered this turn. */
  modelRunning?: string;
  verify?: VerifyResult;
  phase?: PhaseJudgment;
  /** The model the nudge recommended, when one fired. */
  recommendedModel?: string;
  trajectory?: TrajectoryJudgment;
  /** Whether a coaching hint was actually rendered. */
  coachingHint?: boolean;
}

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
