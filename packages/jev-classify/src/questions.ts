/**
 * The three classification questions.
 *
 * Deliberately narrow, independently evaluated Noul (yes/no) questions rather
 * than one mutually exclusive Choice. Two orthogonal signals composed in code
 * keep `normal` as the residual instead of a competing argmax candidate, which
 * is what made a previous single-choice router misclassify
 * decomposition-shaped requests as normal.
 */

import type { NoulQuestionSpec, ScoreQuestionSpec } from "@mohan-cao/jev-classifier";

export const DECOMPOSITION_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Judge the CURRENT request only. Use the conversation solely to resolve what the request refers to; do not let how earlier turns were answered influence the judgment. Does answering this request well require decomposing it first — identifying the material assumptions, conditions, missing inputs, or tradeoffs that control the answer — because a direct answer would discard something that materially changes it?",
  criteria: {
    true: "The current request itself materially depends on conditions, missing inputs, or tradeoffs that must be surfaced before a reliable conclusion can be given.",
    false:
      "A direct answer to the current request, including a short list of corrections, can be given without first decomposing the problem.",
  },
};

export const BOUNDED_VERIFICATION_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Does this request contain at most three concrete, independently evaluable claims or questions that can each be answered with a direct correct / partially-correct / incorrect verdict followed only by the corrections that matter?",
  criteria: {
    true: "At most three concrete claims or questions, each independently checkable, where a useful answer is essentially a verdict plus concise corrections.",
    false:
      "The request is open-ended, asks for design, planning, recommendation, or tradeoff analysis, or contains more than three checkable claims.",
  },
};

export const PREMISE_DEFECT_QUESTION: ScoreQuestionSpec = {
  type: "score",
  instructions:
    "How sound is the factual premise of this request? Rate whether the request presupposes something that is false, or true only under a narrower framing than the request implies.",
  criteria: [
    "Premise is sound. Nothing presupposed is false or misleading.",
    "Minor slip in wording or intent; imprecise but not misleading.",
    "The presupposition holds only under a narrower framing than the request implies; worth naming, but the request is still answerable as posed.",
    "The presupposition is false or materially misleading; answering as posed would reinforce a misconception.",
  ],
};
