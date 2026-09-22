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

export interface RouterConfig {
  endpoint: string;
  model: string;
  timeoutMs: number;
  retries: number;
  /** P(decomposition) at or above which decomposition wins. */
  decompositionThreshold: number;
  /** P(bounded verification) at or above which bounded verification wins. */
  boundedVerificationThreshold: number;
  /** Number of prior conversation turns included in Jev state. 0 disables. */
  historyTurns: number;
  /** Classification cache TTL in ms. 0 disables caching. */
  cacheTtlMs: number;
  cacheMaxEntries: number;
  /** Whether post-generation verification runs by default. */
  verify: boolean;
  verifyEvasiveThreshold: number;
  verifyAnswersThreshold: number;
  verifyTrickyThreshold: number;
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
