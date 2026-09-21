import { RESPONSE_MODE_CRITERIA, RESPONSE_MODE_INSTRUCTIONS } from "./prompt.js";
import {
  RESPONSE_MODES,
  type ClassificationResult,
  type JevChoiceAnswer,
  type JevSystemOneResponse,
  type ResponseMode,
  type RouterConfig,
} from "./types.js";

const QUESTION_ID = "response_mode";

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

function isResponseMode(value: string): value is ResponseMode {
  return (RESPONSE_MODES as readonly string[]).includes(value);
}

function normalizeProbabilities(
  probabilities: Record<string, number>,
): Record<ResponseMode, number> {
  return {
    bounded_verification: probabilities.bounded_verification ?? 0,
    decomposition_required: probabilities.decomposition_required ?? 0,
    normal: probabilities.normal ?? 0,
  };
}

export function parseClassificationResponse(
  payload: JevSystemOneResponse,
): ClassificationResult {
  const raw = payload.answers?.[QUESTION_ID];
  if (!raw || typeof raw !== "object") {
    throw new JevError(`Jev response is missing answers.${QUESTION_ID}`);
  }

  const answer = raw as Partial<JevChoiceAnswer>;
  if (answer.type !== "choice") {
    throw new JevError(`Expected a choice answer for ${QUESTION_ID}`);
  }
  if (typeof answer.choice !== "string" || !isResponseMode(answer.choice)) {
    throw new JevError(`Unexpected Jev response mode: ${String(answer.choice)}`);
  }
  if (typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence)) {
    throw new JevError("Jev choice answer is missing a numeric confidence");
  }
  if (!answer.probabilities || typeof answer.probabilities !== "object") {
    throw new JevError("Jev choice answer is missing probabilities");
  }

  return {
    mode: answer.choice,
    confidence: answer.confidence,
    probabilities: normalizeProbabilities(answer.probabilities),
    ...(payload.model ? { model: payload.model } : {}),
  };
}

function buildRequest(prompt: string, model: string) {
  return {
    model,
    state: {
      user_request: prompt,
    },
    questions: {
      [QUESTION_ID]: {
        type: "choice",
        instructions: RESPONSE_MODE_INSTRUCTIONS,
        criteria: RESPONSE_MODE_CRITERIA,
      },
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return Math.min(2_000, 250 * 2 ** attempt);
}

function makeSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Jev request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  const onAbort = () => controller.abort(parent?.reason ?? new Error("Aborted"));
  parent?.addEventListener("abort", onAbort, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

export async function classifyWithJev(
  prompt: string,
  apiKey: string,
  config: RouterConfig,
  parentSignal?: AbortSignal,
): Promise<ClassificationResult> {
  const requestBody = JSON.stringify(buildRequest(prompt, config.model));

  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const scopedSignal = makeSignal(parentSignal, config.timeoutMs);
    let response: Response;

    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal: scopedSignal.signal,
      });
    } finally {
      scopedSignal.dispose();
    }

    if (response.ok) {
      return parseClassificationResponse(
        (await response.json()) as JevSystemOneResponse,
      );
    }

    const retryable = response.status === 429 || response.status === 529;
    if (retryable && attempt < config.retries) {
      await delay(retryDelayMs(response, attempt), parentSignal);
      continue;
    }

    const body = (await response.text()).slice(0, 500);
    throw new JevError(
      `Jev request failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
      response.status,
    );
  }

  throw new JevError("Jev request failed after retries");
}
