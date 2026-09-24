export const RESPONSE_MODES = [
  "bounded_verification",
  "decomposition_required",
  "normal",
] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

export const FOOTER_MODES = ["compact", "icons", "off"] as const;
export type FooterMode = (typeof FOOTER_MODES)[number];

export const TRAJECTORIES = ["converging", "stuck_detail", "stuck_framing", "early"] as const;
export type Trajectory = (typeof TRAJECTORIES)[number];

/** Raw Jev signals that drive the composed decision, each in [0, 1]. */
export interface ClassificationSignals {
  /** P(the request requires decomposition before a reliable answer). */
  decomposition: number;
  /** P(the request is bounded verification). */
  boundedVerification: number;
  /** Expected severity of a false or misleading premise, 0-3. */
  premiseDefect: number;
}

export interface ClassificationResult {
  mode: ResponseMode;
  /** Probability of the signal that drove the decision. */
  confidence: number;
  probabilities: Record<ResponseMode, number>;
  signals: ClassificationSignals;
  model?: string;
  cached?: boolean;
}

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

/**
 * The classification component's config, plus transport.
 *
 * Still here rather than in a `jev-classify` package because that extraction has
 * not happened yet — which makes this the last set of preferences left in the
 * core, and the reason it is not yet preference-free.
 */
export interface RouterConfig extends JevConfig {
  /** P(decomposition) at or above which decomposition wins. */
  decompositionThreshold: number;
  /** P(bounded verification) at or above which bounded verification wins. */
  boundedVerificationThreshold: number;
  /** Expected premise defect (0-3) at or above which the premise is corrected. */
  premiseDefectThreshold: number;
  /** Number of prior conversation turns included in Jev state. 0 disables. */
  historyTurns: number;
  /** Classification cache TTL in ms. 0 disables caching. */
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

/** The Jev `state` payload for classification. */
export interface ClassificationState {
  user_request: string;
  /** Prior turns, flattened as `"role: text"`. Omitted when there is no history. */
  recent_conversation?: string[];
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
