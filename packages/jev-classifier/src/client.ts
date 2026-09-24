import {
  type JevChoiceAnswer,
  type JevConfig,
  type JevNoulAnswer,
  type JevScoreAnswer,
  type JevSystemOneResponse,
} from "./types.js";

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
  config: JevConfig,
  parentSignal?: AbortSignal,
): Promise<JevSystemOneResponse> {
  const requestBody = JSON.stringify({ model: config.model, state, questions });

  for (let attempt = 0; attempt <= config.retries; attempt += 1) {
    const scopedSignal = makeSignal(parentSignal, config.timeoutMs);
    let response: Response;

    try {
      // Operator-configured endpoint (PI_JEV_ENDPOINT), never derived from
      // request data — not an SSRF sink.
      // pi-lens-ignore: ts_ssrf_sink
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

export function clamp01(value: number): number {
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

export interface ScoreValue {
  /** Expected score: the probability-weighted average of the rubric levels. */
  score: number;
  /** Probability of each rubric level, keyed by level index. */
  probabilities: Record<string, number>;
}

export function parseScoreAnswer(payload: JevSystemOneResponse, id: string): ScoreValue {
  const raw = payload.answers?.[id];
  if (!raw || typeof raw !== "object") {
    throw new JevError(`Jev response is missing answers.${id}`);
  }

  const answer = raw as Partial<JevScoreAnswer> & { type?: unknown };
  if (answer.type !== "score") {
    throw new JevError(`Expected a score answer for ${id}, got ${String(answer.type)}`);
  }
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) {
    throw new JevError(`Jev score answer ${id} is missing a numeric value`);
  }
  if (!answer.probabilities || typeof answer.probabilities !== "object") {
    throw new JevError(`Jev score answer ${id} is missing probabilities`);
  }
  return { score: answer.score, probabilities: answer.probabilities };
}

export interface ChoiceValue<T extends string = string> {
  choice: T;
  confidence: number;
  probabilities: Record<string, number>;
}

export function parseChoiceAnswer<T extends string>(
  payload: JevSystemOneResponse,
  id: string,
  allowed: readonly T[],
): ChoiceValue<T> {
  const raw = payload.answers?.[id];
  if (!raw || typeof raw !== "object") {
    throw new JevError(`Jev response is missing answers.${id}`);
  }

  const answer = raw as Partial<JevChoiceAnswer> & { type?: unknown };
  if (answer.type !== "choice") {
    throw new JevError(`Expected a choice answer for ${id}, got ${String(answer.type)}`);
  }
  if (typeof answer.choice !== "string" || !(allowed as readonly string[]).includes(answer.choice)) {
    throw new JevError(`Unexpected ${id} choice: ${String(answer.choice)}`);
  }
  if (typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence)) {
    throw new JevError(`Jev choice answer ${id} is missing a numeric confidence`);
  }

  return {
    choice: answer.choice as T,
    confidence: clamp01(answer.confidence),
    probabilities: answer.probabilities ?? {},
  };
}
