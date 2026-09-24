import type { FooterMode } from "@mohan-cao/jev-classifier";
import { summarizeProgress, type ProgressSummary, type TrajectoryJudgment } from "@mohan-cao/jev-trajectory";

/**
 * The host side of the progress signal.
 *
 * The tally is cumulative from the last **state transition** and resets to `0/0`
 * there, because what is being measured is how *this stretch* of work is going
 * rather than the session as a whole. The reset point is decided here rather than
 * in `@mohan-cao/jev-trajectory`, which has no business knowing about phases.
 *
 * The footer renders numbers only. The ratio is already the compact form, so
 * `icons` mode renders identically to `compact` by design rather than by
 * oversight.
 */
export class ProgressTally {
  #judgments: TrajectoryJudgment[] = [];
  #phase: string | undefined;

  /**
   * Records one turn, clearing the series first if the phase changed.
   *
   * Call this only once both the phase and progress judgments for the turn are
   * known — they run concurrently, so a caller that records from inside the
   * progress judgment cannot see the phase that belongs with it.
   */
  record(judgment: TrajectoryJudgment, phase: string | undefined): void {
    if (this.#phase !== undefined && phase !== undefined && phase !== this.#phase) {
      this.#judgments = [];
    }
    this.#phase = phase;
    this.#judgments.push(judgment);
  }

  reset(): void {
    this.#judgments = [];
  }

  summary(threshold: number): ProgressSummary {
    return summarizeProgress(this.#judgments, threshold);
  }

  /** `3/8` — turns that advanced, out of turns that counted. */
  format(mode: FooterMode, threshold: number): string | undefined {
    if (mode === "off") return undefined;
    const { advanced, counted } = this.summary(threshold);
    return `${advanced}/${counted}`;
  }
}
