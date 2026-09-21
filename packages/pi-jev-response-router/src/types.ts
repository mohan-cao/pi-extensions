export const RESPONSE_MODES = [
  "bounded_verification",
  "decomposition_required",
  "normal",
] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

export interface ClassificationResult {
  mode: ResponseMode;
  confidence: number;
  probabilities: Record<ResponseMode, number>;
  model?: string;
}

export interface RouterConfig {
  endpoint: string;
  model: string;
  timeoutMs: number;
  retries: number;
  minConfidence: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevSystemOneResponse {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}
