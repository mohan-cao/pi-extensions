import { callSystemOne, parseNoulAnswer } from "./jev-client.js";
import {
  VERIFY_ANSWER_QUESTION,
  VERIFY_EVASIVE_QUESTION,
  VERIFY_TRICKY_QUESTION,
} from "./prompt.js";
import type { RouterConfig } from "./types.js";

const ANSWER_ID = "answers_question";
const EVASIVE_ID = "evasive";
const TRICKY_ID = "genuinely_tricky";

export type VerifyFlag = "ok" | "vague" | "tricky";

export interface VerifyResult {
  flag: VerifyFlag;
  /** P(the response directly answers the request). */
  answersQuestion: number;
  /** P(the response is vague/hedged to avoid committing). */
  evasive: number;
  /** P(the problem genuinely required decomposition). */
  tricky: number;
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
      [TRICKY_ID]: VERIFY_TRICKY_QUESTION,
    },
    apiKey,
    config,
    parentSignal,
  );

  const answersQuestion = parseNoulAnswer(payload, ANSWER_ID);
  const evasive = parseNoulAnswer(payload, EVASIVE_ID);
  const tricky = parseNoulAnswer(payload, TRICKY_ID);

  let flag: VerifyFlag = "ok";
  if (evasive >= config.verifyEvasiveThreshold || answersQuestion <= config.verifyAnswersThreshold) {
    flag = "vague";
  } else if (tricky >= config.verifyTrickyThreshold) {
    flag = "tricky";
  }

  return {
    flag,
    answersQuestion,
    evasive,
    tricky,
    ...(payload.model ? { model: payload.model } : {}),
  };
}

/** `undefined` clears the status indicator. */
export function formatVerifyStatus(result: VerifyResult): string | undefined {
  if (result.flag === "vague") return "💡 possible vagueness";
  if (result.flag === "tricky") return "💡 genuinely tricky";
  return undefined;
}
