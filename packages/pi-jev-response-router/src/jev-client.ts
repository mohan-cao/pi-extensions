import { buildState, type HistoryTurn } from "./context.js";
import {
  BOUNDED_VERIFICATION_QUESTION,
  DECOMPOSITION_QUESTION,
  type NoulQuestionSpec,
} from "./prompt.js";
import {
  type ClassificationResult,
  type JevNoulAnswer,
  type JevSystemOneResponse,
  type ResponseMode,
  type RouterConfig,
} from "./types.js";

const DECOMPOSITION_ID = "requires_decomposition";
const BOUNDED_ID = "bounded_verification";

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
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

/**
 * Single transport for POST /v1/systemone. Answers are keyed by the question
 * names supplied in `questions`.
 */
export async function callSystemOne(
  state: unknown,
  questions: Record<string, unknown>,
  apiKey: string,
  config: RouterConfig,
  parentSignal?: AbortSignal,
): Promise<JevSystemOneResponse> {
  const requestBody = JSON.stringify({ model: config.model, state, questions });

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
      return (await response.json()) as JevSystemOneResponse;
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function parseNoulAnswer(payload: JevSystemOneResponse, id: string): number {
  const raw = payload.answers?.[id];
  if (!raw || typeof raw !== "object") {
    throw new JevError(`Jev response is missing answers.${id}`);
  }

  const answer = raw as Partial<JevNoulAnswer> & { type?: unknown };
  if (answer.type !== "noul") {
    throw new JevError(`Expected a noul answer for ${id}, got ${String(answer.type)}`);
  }
  if (typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) {
    throw new JevError(`Jev noul answer ${id} is missing a numeric value`);
  }
  return clamp01(answer.noul);
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
    },
    apiKey,
    config,
    parentSignal,
  );

  return parseClassificationResponse(payload, config);
}
