export const RESPONSE_MODE_INSTRUCTIONS = `
Choose the response structure that best preserves correctness and usefulness.

BOUNDED_VERIFICATION applies when the request contains at most three concrete,
independently evaluable claims or questions, and a useful answer can directly
say whether each is correct, partially correct, or incorrect, followed by only
the corrections that matter.

DECOMPOSITION_REQUIRED applies when a direct verdict would discard materially
important assumptions, definitions, interacting constraints, tradeoffs, or
conditional branches. The response should identify those dependencies and
break the problem into the minimum useful subquestions before synthesizing an
answer.

NORMAL applies when neither specialised structure materially improves the
answer.

Do not choose DECOMPOSITION_REQUIRED merely because minor caveats exist. Choose
it only when those caveats materially change the answer. Do not choose
BOUNDED_VERIFICATION for broad design, planning, recommendation, or tradeoff
questions just because they contain a yes/no phrase.
`.trim();

export const RESPONSE_MODE_CRITERIA = {
  bounded_verification:
    "At most three concrete claims/questions suitable for a direct correct/partially-correct/incorrect verdict with concise corrections.",
  decomposition_required:
    "Important assumptions, conditions, tradeoffs, or interacting constraints must be decomposed before a reliable conclusion can be given.",
  normal:
    "Neither bounded verification nor explicit decomposition is materially useful for this request.",
} as const;
