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

  const judgment = {
    progress: progressFrom(advanceConfidence >= NOUL_CUTOFF, regressConfidence >= NOUL_CUTOFF),
    advanceConfidence,
    regressConfidence,
  };
  return payload.model ? { ...judgment, model: payload.model } : judgment;
}

/**
 * Pure arithmetic over a series of judgments, in order.
 *
 * A turn counts only when **both** answers clear `minConfidence`. Turns below it
 * are excluded rather than forced to `held`: a turn the judge could not read
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
    (judgment) => Math.min(judgment.advanceConfidence, judgment.regressConfidence) >= minConfidence,
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
    // Marginals of the two questions, so `mixed` counts toward both.
    if (judgment.progress === "advanced" || judgment.progress === "mixed") advanced += 1;
    if (judgment.progress === "regressed" || judgment.progress === "mixed") regressed += 1;
    if (judgment.progress === "mixed") mixed += 1;

    const value = PROGRESS_VALUE[judgment.progress];
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
