import type { ResponseMode } from "./types.js";

const BOUNDED_VERIFICATION_POLICY = `
<jev-response-policy mode="bounded-verification">
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
</jev-response-policy>
`.trim();

const DECOMPOSITION_POLICY = `
<jev-response-policy mode="decomposition-required">
The current user request was classified as requiring decomposition before a
reliable conclusion.

Do not force a binary verdict first. Identify the material assumptions,
definitions, conditions, or tradeoffs that control the answer. Break the issue
into the minimum useful subquestions, answer those subquestions, then
synthesize the result.

Avoid vague "it depends" hedging: name the dependencies explicitly and explain
how changing them changes the conclusion.
</jev-response-policy>
`.trim();

export function policyFor(mode: ResponseMode): string | undefined {
  switch (mode) {
    case "bounded_verification":
      return BOUNDED_VERIFICATION_POLICY;
    case "decomposition_required":
      return DECOMPOSITION_POLICY;
    case "normal":
      return undefined;
  }
}
