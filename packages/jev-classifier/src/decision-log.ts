import type {
  ClassificationSignals,
  PhaseJudgment,
  ResponseMode,
  TrajectoryJudgment,
} from "./types.js";
import type { VerifyResult } from "./verify.js";

/**
 * One settled turn, as the router judged it.
 *
 * Deliberately contains **no conversation text** — only judgments, probabilities,
 * and model ids.
 *
 * Acceptance of a model nudge is derived by diffing consecutive records: if
 * `recommendedModel` at turn N equals `modelRunning` at turn N+1, the user acted
 * on it. That is the only correctness proxy available without hand-labelling, and
 * it only produces data when routes are configured.
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
