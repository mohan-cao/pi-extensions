import type { JevConfig } from "@mohan-cao/jev-classifier";

export const RESPONSE_MODES = [
  "bounded_verification",
  "decomposition_required",
  "normal",
] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

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

/** The Jev `state` payload for classification. */
export interface ClassificationState {
  user_request: string;
  /** Prior turns, flattened as `"role: text"`. Omitted when there is no history. */
  recent_conversation?: string[];
}

/** Transport settings plus this component's thresholds. */
export interface ClassifyConfig extends JevConfig {
  /** P(decomposition) at or above which decomposition wins. */
  decompositionThreshold: number;
  /** P(bounded verification) at or above which bounded verification wins. */
  boundedVerificationThreshold: number;
  /** Expected premise defect (0-3) at or above which the premise is corrected. */
  premiseDefectThreshold: number;
  /** Number of prior conversation turns included in Jev state. 0 disables. */
  historyTurns: number;
}
