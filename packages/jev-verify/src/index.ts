/**
 * The verification signal.
 *
 * Judges a completed exchange on three questions — did the response address the
 * request, did it avoid committing to a position the request called for, and did
 * it meet its obligation — and reports one flag. It is a **signal only**: it does
 * not retry or rewrite the answer.
 *
 * Read the README before trusting the flag. It is known to be too permissive,
 * and the reason is structural rather than a matter of tuning.
 */

import {
  callSystemOne,
  parseNoulAnswer,
  parseScoreAnswer,
  type FooterMode,
  type JevConfig,
  type NoulQuestionSpec,
  type ScoreQuestionSpec,
} from "@mohan-cao/jev-classifier";

export const VERIFY_ANSWER_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Does the response address the user's actual request? Addressing includes naming what the answer depends on, or asking for information it depends on; it does not require a single final verdict.",
  criteria: {
    true: "The response engages the actual question and gives the user something actionable or conclusive, including a clear statement of what the answer depends on.",
    false:
      "The response deflects, answers a different question, or leaves the user's request unaddressed.",
  },
};

export const VERIFY_EVASIVE_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Does the response avoid committing to a position that the request calls for? Distinguish genuine evasion from a conditional answer that names the determining factors and then commits within them.",
  criteria: {
    true: "The response declines to take any position, or offers only generic caveats and filler, even though the request called for a conclusion.",
    false:
      "The response commits to a position, or conditions its answer on explicitly named factors and commits within each. Conditional-but-committed is not evasion.",
  },
};

export const VERIFY_OBLIGATION_QUESTION: ScoreQuestionSpec = {
  type: "score",
  instructions:
    "Given what the request did and did not provide, did the response meet its obligation? If the request rested on a false or oversimplified premise, did the response correct it? If the request omitted information needed to answer well, did the response surface those inputs (by asking, or by branching on the determining conditions) rather than giving a generic answer that would be true regardless?",
  criteria: [
    "Fully met. Answered as posed and addressed any false premise or missing input.",
    "Mostly met. Minor omissions that don't change whether the answer is useful.",
    "Partially met. Answered the literal question but left a material premise or missing input unaddressed.",
    "Not met. Technically true but misleading or unusable, because it ignored a false premise or the information the answer actually depends on.",
  ],
};

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

/** Transport settings plus this component's thresholds. */
export interface VerifyConfig extends JevConfig {
  /** Whether verification runs by default. */
  enabled: boolean;
  /** P(evasive) at or above which the response is flagged as evading. */
  evasiveThreshold: number;
  /** P(answers the question) at or below which the response is flagged. */
  answersThreshold: number;
  /** Expected obligation failure (0-3) at or above which the answer is flagged. */
  obligationThreshold: number;
}

/**
 * Post-generation verification only. This deliberately does not retry or
 * rewrite the answer; it produces a signal the caller can surface to the user.
 */
export async function verifyResponse(
  request: string,
  response: string,
  apiKey: string,
  config: VerifyConfig,
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
  if (evasive >= config.evasiveThreshold || answersQuestion <= config.answersThreshold) {
    flag = "evasive";
  } else if (obligationUnmet >= config.obligationThreshold) {
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
