import type { JevConfig } from "@mohan-cao/jev-classifier";

/**
 * What a single turn did to the work.
 *
 * Four outcomes composed from two orthogonal questions, not one ordinal scale.
 * A turn can genuinely do both — settle the API shape and reopen the storage
 * choice — and forcing that onto a single axis loses exactly the information
 * that matters. This is the same reason classification asks two Nouls rather
 * than one Choice: a single axis makes the residual compete in an argmax.
 */
export const PROGRESS = ["held", "advanced", "regressed", "mixed"] as const;
export type Progress = (typeof PROGRESS)[number];

/** Composed from the two answers. `mixed` is not a failure state: it is both. */
export function progressFrom(advance: boolean, regress: boolean): Progress {
  if (advance && regress) return "mixed";
  if (advance) return "advanced";
  if (regress) return "regressed";
  return "held";
}

/**
 * −1, 0, +1 — the series the trend aggregates operate on.
 *
 * `mixed` nets to zero, because one thing moved each way. That is deliberate: a
 * run of mixed turns keeps changing things without netting forward, which is a
 * stall in the only sense this signal claims.
 */
export const PROGRESS_VALUE = {
  regressed: -1,
  held: 0,
  mixed: 0,
  advanced: 1,
} satisfies Record<Progress, number>;

/**
 * What the progress judge observed on one settled turn.
 *
 * Deliberately carries **only the two answers**, not a composed label. A label
 * here would be derived state that the type cannot keep consistent with its
 * inputs, and anything reading it would have to trust that they agree. Compose
 * with `progressOf` instead.
 */
export interface TrajectoryJudgment {
  /** P(the turn advanced the work). */
  advanceConfidence: number;
  /** P(the turn reopened or undid something). */
  regressConfidence: number;
  model?: string;
}

/** Transport settings plus this component's settings. */
export interface TrajectoryConfig extends JevConfig {
  /** Conversation turns supplied to the progress judge. */
  historyTurns: number;
  /**
   * Minimum **decisiveness** for both answers before a turn counts at all.
   *
   * A Noul carries P(true), so decisiveness is its distance from the midpoint —
   * 0.7 means each answer is at least 70% sure of itself. Gating on the raw
   * probability instead would exclude every one-sided turn, since a clear advance
   * has `P(regress) ≈ 0.1`.
   *
   * Gating on the weaker of the two keeps a single denominator, which is what
   * makes the rates comparable with one another. Below it the turn is excluded
   * rather than forced to `held`, which would inflate the denominator with turns
   * the judge could not read.
   */
  progressConfidenceThreshold: number;
}

/**
 * The aggregates, all pure arithmetic over the counted turns.
 *
 * Nothing here decides whether the work is "stuck". That judgement belongs to
 * the reader, and the point of reporting rates rather than a verdict is to give
 * them what they need to make it.
 */
export interface ProgressSummary {
  /** Turns where both answers cleared the confidence gate. */
  counted: number;
  /**
   * Turns where *something* advanced — `mixed` included.
   *
   * The rates are marginals of the two questions, so `advancedRate` and
   * `regressedRate` overlap on `mixed` turns. The gap between `mixedRate` and
   * what independence would predict is the interesting part.
   */
  advanced: number;
  /** Turns where something was reopened — `mixed` included. */
  regressed: number;
  /** Turns that did both. */
  mixed: number;
  advancedRate: number;
  regressedRate: number;
  mixedRate: number;
  /** Mean of the −1/0/+1 series. Positive means the work is progressing, even with much still open. */
  net: number;
  /** Sign changes in the series — thrashing, whatever it is about. */
  oscillation: number;
  /** Longest run that did not net forward. `held` and `mixed` both count as not netting forward. */
  longestStall: number;
}
