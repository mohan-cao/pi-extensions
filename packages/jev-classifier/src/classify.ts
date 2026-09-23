import { callSystemOne, clamp01, parseNoulAnswer, parseScoreAnswer } from "./client.js";
import {
  BOUNDED_VERIFICATION_QUESTION,
  DECOMPOSITION_QUESTION,
  PREMISE_DEFECT_QUESTION,
  type NoulQuestionSpec,
  type ScoreQuestionSpec,
} from "./questions.js";
import type {
  ClassificationResult,
  ClassificationState,
  HistoryTurn,
  JevSystemOneResponse,
  ResponseMode,
  RouterConfig,
} from "./types.js";

const DECOMPOSITION_ID = "requires_decomposition";
const BOUNDED_ID = "bounded_verification";
const PREMISE_ID = "premise_defect";

/**
 * The Jev `state`. History is included so follow-ups are classifiable, but the
 * decomposition question is worded to judge the current request only — measured
 * history inflation is why (see the eval harness).
 */
export function buildState(prompt: string, history: HistoryTurn[]): ClassificationState {
  if (history.length === 0) return { user_request: prompt };
  return {
    recent_conversation: history.map((turn) => `${turn.role}: ${turn.text}`),
    user_request: prompt,
  };
}

/** Decomposition takes precedence; `normal` is the residual, never a competitor. */
export function composeMode(
  signals: ClassificationResult["signals"],
  config: Pick<RouterConfig, "decompositionThreshold" | "boundedVerificationThreshold">,
): ResponseMode {
  if (signals.decomposition >= config.decompositionThreshold) return "decomposition_required";
  if (signals.boundedVerification >= config.boundedVerificationThreshold) {
    return "bounded_verification";
  }
  return "normal";
}

export function parseClassificationResponse(
  payload: JevSystemOneResponse,
  config: Pick<RouterConfig, "decompositionThreshold" | "boundedVerificationThreshold">,
): ClassificationResult {
  const signals = {
    decomposition: parseNoulAnswer(payload, DECOMPOSITION_ID),
    boundedVerification: parseNoulAnswer(payload, BOUNDED_ID),
    premiseDefect: parseScoreAnswer(payload, PREMISE_ID).score,
  };

  const mode = composeMode(signals, config);
  const probabilities: Record<ResponseMode, number> = {
    bounded_verification: signals.boundedVerification,
    decomposition_required: signals.decomposition,
    normal: clamp01(1 - Math.max(signals.decomposition, signals.boundedVerification)),
  };

  const confidence =
    mode === "decomposition_required"
      ? signals.decomposition
      : mode === "bounded_verification"
        ? signals.boundedVerification
        : probabilities.normal;

  return {
    mode,
    confidence,
    probabilities,
    signals,
    ...(payload.model ? { model: payload.model } : {}),
  };
}

export async function classifyWithJev(
  prompt: string,
  apiKey: string,
  config: RouterConfig,
  parentSignal?: AbortSignal,
  history: HistoryTurn[] = [],
): Promise<ClassificationResult> {
  const payload = await callSystemOne(
    buildState(prompt, history),
    {
      [DECOMPOSITION_ID]: DECOMPOSITION_QUESTION satisfies NoulQuestionSpec,
      [BOUNDED_ID]: BOUNDED_VERIFICATION_QUESTION satisfies NoulQuestionSpec,
      [PREMISE_ID]: PREMISE_DEFECT_QUESTION satisfies ScoreQuestionSpec,
    },
    apiKey,
    config,
    parentSignal,
  );

  return parseClassificationResponse(payload, config);
}
