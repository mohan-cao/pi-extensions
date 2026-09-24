export const FOOTER_MODES = ["compact", "icons", "off"] as const;
export type FooterMode = (typeof FOOTER_MODES)[number];

export const TRAJECTORIES = ["converging", "stuck_detail", "stuck_framing", "early"] as const;
export type Trajectory = (typeof TRAJECTORIES)[number];

/**
 * Transport settings for a Jev call.
 *
 * Deliberately the *only* config the core owns. Every threshold and preference
 * belongs to the component that uses it, so component configs extend this rather
 * than inheriting a kitchen-sink object.
 */
export interface JevConfig {
  endpoint: string;
  model: string;
  timeoutMs: number;
  retries: number;
}

/** A prior conversation turn included in the classifier state. */
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * What the post-generation trajectory judge observed. Orthogonal to phase: a
 * conversation can be stuck while implementing, or framing a problem badly
 * during general conversation.
 */
export interface TrajectoryJudgment {
  trajectory: Trajectory;
  trajectoryConfidence: number;
  model?: string;
}

/** Display policy for the coaching hint. */
export interface TrajectoryConfig {
  /** Minimum Choice confidence before a stuck-pattern hint is shown. */
  trajectoryConfidenceThreshold: number;
  /** Conversation turns supplied to the trajectory judge. */
  historyTurns: number;
}

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevSystemOneResponse {
  model?: string;
  answers?: Record<string, JevAnswer | undefined>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}
