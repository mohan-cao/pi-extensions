/**
 * The progress signal.
 *
 * One signed judgment per settled turn — did it advance the work, hold, or
 * reopen something — plus pure arithmetic over a series of those judgments. It
 * reports a series rather than a verdict: nothing here decides whether the work
 * is "stuck", because the reader is the one who can tell the difference between
 * a spiral and a correction.
 *
 * Read the README before relying on it. The tally's reset point is the host's
 * business, and there are no eval baselines for the redesigned signal yet.
 */

import {
  callSystemOne,
  parseChoiceAnswer,
  type HistoryTurn,
  type JevConfig,
} from "@mohan-cao/jev-classifier";

import { PROGRESS_QUESTION } from "./questions.js";
import {
  PROGRESS,
  PROGRESS_VALUE,
  type ProgressSummary,
  type TrajectoryJudgment,
} from "./types.js";

export { PROGRESS_QUESTION };
export { PROGRESS, PROGRESS_VALUE };
export type {
  Progress,
  ProgressSummary,
  TrajectoryConfig,
  TrajectoryJudgment,
} from "./types.js";

const PROGRESS_ID = "progress";

/**
 * Its own call, not shared with verification or the phase judgment. They read
 * different state and are conceptually independent — and questions sharing a
 * call can perturb each other.
 */
export async function judgeTrajectory(
  turns: HistoryTurn[],
  apiKey: string,
  config: JevConfig,
  parentSignal?: AbortSignal,
): Promise<TrajectoryJudgment> {
  const payload = await callSystemOne(
    { recent_conversation: turns.map((turn) => `${turn.role}: ${turn.text}`) },
    { [PROGRESS_ID]: PROGRESS_QUESTION },
    apiKey,
    config,
    parentSignal,
  );

  const progress = parseChoiceAnswer(payload, PROGRESS_ID, PROGRESS);
  const judgment = { progress: progress.choice, progressConfidence: progress.confidence };
  return payload.model ? { ...judgment, model: payload.model } : judgment;
}

/**
 * Pure arithmetic over a series of judgments, in order.
 *
 * Turns below `minConfidence` are **excluded** rather than forced to `held`: a
 * turn the judge could not read should not inflate the denominator.
 *
 * `oscillation` counts direction reversals, not pauses — `held` does not change
 * direction, so `advanced, held, regressed` is one reversal.
 */
export function summarizeProgress(
  judgments: TrajectoryJudgment[],
  minConfidence: number,
): ProgressSummary {
  const counted = judgments.filter((judgment) => judgment.progressConfidence >= minConfidence);

  if (counted.length === 0) {
    return { counted: 0, advanced: 0, net: 0, oscillation: 0, longestStall: 0, regressedShare: 0 };
  }

  let advanced = 0;
  let regressed = 0;
  let oscillation = 0;
  let longestStall = 0;
  let stall = 0;
  let lastSign = 0;
  let sum = 0;

  for (const judgment of counted) {
    const value = PROGRESS_VALUE[judgment.progress];
    sum += value;
    if (judgment.progress === "advanced") advanced += 1;
    if (judgment.progress === "regressed") regressed += 1;

    // A stall is any turn that did not advance — `regressed` is no more progress
    // than `held` is, even though it has a direction of its own.
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
    net: sum / counted.length,
    oscillation,
    longestStall,
    regressedShare: regressed / counted.length,
  };
}
