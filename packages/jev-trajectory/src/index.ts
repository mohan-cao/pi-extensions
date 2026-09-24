/**
 * The progress signal.
 *
 * Two orthogonal Noul judgments per settled turn — did it advance the work, did
 * it reopen something — composed into four outcomes, plus pure arithmetic over a
 * series of them. It reports rates rather than a verdict: nothing here decides
 * whether the work is "stuck", because the reader is the one who can tell a
 * spiral from a correction.
 *
 * Read the README before relying on it. The tally's reset point is the host's
 * business, and there are no eval baselines for this signal yet.
 */

import {
  callSystemOne,
  parseNoulAnswer,
  type HistoryTurn,
  type JevConfig,
} from "@mohan-cao/jev-classifier";

import { ADVANCE_QUESTION, REGRESS_QUESTION } from "./questions.js";
import {
  PROGRESS,
  PROGRESS_VALUE,
  progressFrom,
  type Progress,
  type ProgressSummary,
  type TrajectoryJudgment,
} from "./types.js";

export { ADVANCE_QUESTION, REGRESS_QUESTION };
export { PROGRESS, PROGRESS_VALUE, progressFrom };
export type {
  Progress,
  ProgressSummary,
  TrajectoryConfig,
  TrajectoryJudgment,
} from "./types.js";

const ADVANCE_ID = "advanced";
const REGRESS_ID = "regressed";

/**
 * A Noul is a probability, so composing it into a boolean needs a midpoint.
 * The reliability gate is separate and lives in `TrajectoryConfig`: 0.51 is
 * enough to *call* it advancing, but not enough to count it.
 */
const NOUL_CUTOFF = 0.5;

/**
 * The composed outcome of a judgment, at the Noul midpoint.
 *
 * The only place the cutoff appears, so nothing else has to know it.
 */
export function progressOf(judgment: TrajectoryJudgment): Progress {
  return progressFrom(
    judgment.advanceConfidence >= NOUL_CUTOFF,
    judgment.regressConfidence >= NOUL_CUTOFF,
  );
}

/**
 * Its own call, not shared with verification, classification, or the phase
 * judgment. They read different state and are conceptually independent — and
 * questions sharing a call can perturb each other.
 */
export async function judgeTrajectory(
  turns: HistoryTurn[],
  apiKey: string,
  config: JevConfig,
  parentSignal?: AbortSignal,
): Promise<TrajectoryJudgment> {
  const payload = await callSystemOne(
    { recent_conversation: turns.map((turn) => `${turn.role}: ${turn.text}`) },
    { [ADVANCE_ID]: ADVANCE_QUESTION, [REGRESS_ID]: REGRESS_QUESTION },
    apiKey,
    config,
    parentSignal,
  );

  const advanceConfidence = parseNoulAnswer(payload, ADVANCE_ID);
  const regressConfidence = parseNoulAnswer(payload, REGRESS_ID);

  const judgment = { advanceConfidence, regressConfidence };
  return payload.model ? { ...judgment, model: payload.model } : judgment;
}

/**
 * How decisive a Noul answer is: its distance from the midpoint, as 0.5–1.
 *
 * A Noul carries P(true), so a *confidently false* answer has a **low**
 * probability. Gating on the raw probability would therefore exclude every
 * one-sided turn — a clear advance has `P(regress) ≈ 0.1`, and the minimum of the
 * two would sit below any sensible threshold. What the gate wants is how far
 * each answer is from a coin flip.
 */
function decisiveness(probability: number): number {
  return Math.max(probability, 1 - probability);
}

/**
 * Pure arithmetic over a series of judgments, in order.
 *
 * A turn counts only when **both** answers are decisive enough. Turns below the
 * gate are excluded rather than forced to `held`: a turn the judge could not read
 * should not inflate the denominator, and one denominator is what makes the
 * rates comparable.
 *
 * `oscillation` counts direction reversals, not pauses — `held` and `mixed` both
 * net to zero, so neither changes direction.
 */
export function summarizeProgress(
  judgments: TrajectoryJudgment[],
  minConfidence: number,
): ProgressSummary {
  const counted = judgments.filter(
    (judgment) =>
      Math.min(decisiveness(judgment.advanceConfidence), decisiveness(judgment.regressConfidence)) >=
      minConfidence,
  );

  if (counted.length === 0) {
    return {
      counted: 0,
      advanced: 0,
      regressed: 0,
      mixed: 0,
      advancedRate: 0,
      regressedRate: 0,
      mixedRate: 0,
      net: 0,
      oscillation: 0,
      longestStall: 0,
    };
  }

  let advanced = 0;
  let regressed = 0;
  let mixed = 0;
  let oscillation = 0;
  let longestStall = 0;
  let stall = 0;
  let lastSign = 0;
  let sum = 0;

  for (const judgment of counted) {
    const progress = progressOf(judgment);

    // Marginals of the two questions, so `mixed` counts toward both.
    if (progress === "advanced" || progress === "mixed") advanced += 1;
    if (progress === "regressed" || progress === "mixed") regressed += 1;
    if (progress === "mixed") mixed += 1;

    const value = PROGRESS_VALUE[progress];
    sum += value;

    // A stall is any turn that did not net forward — `regressed` is no more
    // progress than `held` is, and `mixed` cancels itself out.
    if (value > 0) {
      stall = 0;
    } else {
      stall += 1;
    }
    longestStall = Math.max(longestStall, stall);

    const sign = Math.sign(value);
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign) oscillation += 1;
      lastSign = sign;
    }
  }

  return {
    counted: counted.length,
    advanced,
    regressed,
    mixed,
    advancedRate: advanced / counted.length,
    regressedRate: regressed / counted.length,
    mixedRate: mixed / counted.length,
    net: sum / counted.length,
    oscillation,
    longestStall,
  };
}
