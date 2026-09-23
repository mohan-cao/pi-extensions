import { callSystemOne, parseNoulAnswer, parseScoreAnswer } from "./client.js";
import {
  VERIFY_ANSWER_QUESTION,
  VERIFY_EVASIVE_QUESTION,
  VERIFY_OBLIGATION_QUESTION,
} from "./questions.js";
import type { FooterMode, RouterConfig } from "./types.js";

const ANSWER_ID = "answers_question";
const EVASIVE_ID = "evasive";
const OBLIGATION_ID = "obligation_unmet";

export type VerifyFlag = "ok" | "evasive" | "unmet";

export interface VerifyResult {
  flag: VerifyFlag;
  /** P(the response addresses the actual request). */
  answersQuestion: number;
  /** P(the response avoids committing to a position the request calls for). */
  evasive: number;
  /** Expected obligation failure, 0-3. Higher means the answer did less of what was needed. */
  obligationUnmet: number;
  model?: string;
}

/**
 * Post-generation verification only. This deliberately does not retry or
 * rewrite the answer; it produces a signal the caller can surface to the user.
 */
export async function verifyResponse(
  request: string,
  response: string,
  apiKey: string,
  config: RouterConfig,
  parentSignal?: AbortSignal,
): Promise<VerifyResult> {
  const payload = await callSystemOne(
    { user_request: request, assistant_response: response },
    {
      [ANSWER_ID]: VERIFY_ANSWER_QUESTION,
      [EVASIVE_ID]: VERIFY_EVASIVE_QUESTION,
      [OBLIGATION_ID]: VERIFY_OBLIGATION_QUESTION,
    },
    apiKey,
    config,
    parentSignal,
  );

  const answersQuestion = parseNoulAnswer(payload, ANSWER_ID);
  const evasive = parseNoulAnswer(payload, EVASIVE_ID);
  const obligationUnmet = parseScoreAnswer(payload, OBLIGATION_ID).score;

  let flag: VerifyFlag = "ok";
  if (evasive >= config.verifyEvasiveThreshold || answersQuestion <= config.verifyAnswersThreshold) {
    flag = "evasive";
  } else if (obligationUnmet >= config.verifyObligationThreshold) {
    flag = "unmet";
  }

  return {
    flag,
    answersQuestion,
    evasive,
    obligationUnmet,
    ...(payload.model ? { model: payload.model } : {}),
  };
}

/**
 * `undefined` clears the status indicator. `off` renders nothing; `icons`
 * renders the glyph alone; `compact` (the default) adds the label.
 */
export function formatVerifyStatus(
  result: VerifyResult,
  mode: FooterMode = "compact",
): string | undefined {
  if (mode === "off" || result.flag === "ok") return undefined;

  const glyph = result.flag === "evasive" ? "🤷" : "🚩";
  return mode === "icons" ? glyph : `${glyph} ${result.flag}`;
}
