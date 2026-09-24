export const FOOTER_MODES = ["compact", "icons", "off"] as const;
export type FooterMode = (typeof FOOTER_MODES)[number];

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
 * The question-spec vocabulary.
 *
 * Question specs live with the component that asks them, so the core keeps only
 * the shapes every component shares. This is the intended seam for a future
 * Langfuse `getPrompt()` loop.
 */
export interface NoulQuestionSpec {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface ScoreQuestionSpec {
  type: "score";
  instructions: string;
  /** Ordered rubric; a description's position is its score, starting at 0. */
  criteria: string[];
}

export interface ChoiceQuestionSpec {
  type: "choice";
  instructions: string;
  /** Choice name → when it applies. */
  criteria: Record<string, string>;
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
