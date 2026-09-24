import type { ResponseMode } from "./types.js";

/**
 * Policy bodies are injected as a named system-prompt section (see
 * `POLICY_SECTION` in the extension), so Pi wraps them in a
 * `<jev-response-policy>` tag. Do not re-add the wrapper here.
 */

const BOUNDED_VERIFICATION_POLICY = `
The current user request was classified as a bounded verification task.
Evaluate no more than three independently evaluable claims/questions.

For each claim:
- begin with exactly one of: Correct, Partially correct, or Incorrect;
- briefly explain why;
- list only the corrections or qualifications needed to make it accurate.

Do not manufacture an "it depends" discussion when qualifications do not
materially change the truth value. If an unexpected dependency genuinely makes
a direct verdict misleading, state that dependency precisely rather than
hedging vaguely.
`.trim();

const DECOMPOSITION_POLICY = `
The current user request was classified as requiring decomposition before a
reliable conclusion.

Do not force a binary verdict first. Identify the material assumptions,
definitions, conditions, or tradeoffs that control the answer. Break the issue
into the minimum useful subquestions, answer those subquestions, then
synthesize the result.

Avoid vague "it depends" hedging: name the dependencies explicitly and explain
how changing them changes the conclusion.
`.trim();

/**
 * A `Record` rather than a `switch`, so a new `ResponseMode` becomes a compile
 * error here instead of a silent `undefined` — which would mean no policy
 * injected, with nothing to notice it. Same idiom as `PROGRESS_VALUE` and
 * `PHASE_GLYPH`.
 */
const POLICY_BY_MODE = {
  bounded_verification: BOUNDED_VERIFICATION_POLICY,
  decomposition_required: DECOMPOSITION_POLICY,
  normal: undefined,
} satisfies Record<ResponseMode, string | undefined>;

export function policyFor(mode: ResponseMode): string | undefined {
  return POLICY_BY_MODE[mode];
}

const PREMISE_POLICY = `
The current user request may rest on a false or materially misleading premise.
If it does, state the correction in one sentence before answering. Do not
lecture, and do not restate the correction.
`.trim();

/**
 * The corrective modifier. Bounded verification already emits a verdict and
 * corrections, so applying this there would only duplicate them.
 */
export function premisePolicyFor(
  mode: ResponseMode,
  premiseDefect: number,
  threshold: number,
): string | undefined {
  if (mode === "bounded_verification") return undefined;
  return premiseDefect >= threshold ? PREMISE_POLICY : undefined;
}
