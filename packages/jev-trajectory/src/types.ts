import type { JevConfig } from "@mohan-cao/jev-classifier";

/**
 * What a single turn did to the work.
 *
 * There is deliberately no `stuck` value. "In progress and not converging" is
 * not the same as stuck, and a turn that neither advanced nor revisited has
 * nowhere to go in a vocabulary that only has progress and two flavours of
 * stuck. Divergence is likewise a real outcome, not a failure: reopening a
 * detail that turned out to rest on a false premise is how a wrong premise gets
 * caught.
 */
export const PROGRESS = ["regressed", "held", "advanced"] as const;
export type Progress = (typeof PROGRESS)[number];

/** −1, 0, +1 — the series every aggregate below operates on. */
export const PROGRESS_VALUE = {
  regressed: -1,
  held: 0,
  advanced: 1,
} satisfies Record<Progress, number>;

/** What the progress judge observed on one settled turn. */
export interface TrajectoryJudgment {
  progress: Progress;
  progressConfidence: number;
  model?: string;
}

/** Transport settings plus this component's settings. */
export interface TrajectoryConfig extends JevConfig {
  /** Conversation turns supplied to the progress judge. */
  historyTurns: number;
  /**
   * Minimum Choice confidence for a turn to count toward the tally at all.
   *
   * Below it the turn is **excluded** — neither number moves — rather than being
   * forced to `held`, which would inflate the denominator with turns the judge
   * could not read.
   */
  progressConfidenceThreshold: number;
}

/**
 * The aggregates, all pure arithmetic over the counted series.
 *
 * Nothing here decides whether the work is "stuck": that judgement belongs to
 * the reader, and the point of reporting a series rather than a verdict is to
 * give them what they need to make it.
 */
export interface ProgressSummary {
  /** Turns that cleared the confidence gate. */
  counted: number;
  /** Turns judged `advanced`. */
  advanced: number;
  /** Mean of the −1/0/+1 series. Positive means the work is progressing, even with much still open. */
  net: number;
  /** Sign changes in the series — thrashing, whatever it is about. */
  oscillation: number;
  /** Longest run of `held` or `regressed`. No net progress for that many turns. */
  longestStall: number;
  /** Proportion of counted turns that were `regressed`. */
  regressedShare: number;
}
