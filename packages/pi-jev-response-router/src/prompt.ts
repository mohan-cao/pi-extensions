/**
 * Classifier prompt seam.
 *
 * These are deliberately narrow, independently evaluated Noul (yes/no)
 * questions rather than one mutually exclusive Choice. Two orthogonal signals
 * composed in code keep `normal` as the residual instead of a competing
 * argmax candidate, which is what made the previous single-choice router
 * misclassify decomposition-shaped requests as normal.
 *
 * This file is the intended seam for a future Langfuse `getPrompt()` loop.
 */

export interface NoulQuestionSpec {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export const DECOMPOSITION_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Does answering this request well require decomposing it first, by identifying material assumptions, definitions, conditions, interacting constraints, or tradeoffs, because a direct verdict or single-answer response would discard something that materially changes the answer?",
  criteria: {
    true: "The answer materially depends on assumptions, definitions, conditions, or tradeoffs that must be surfaced and weighed before a reliable conclusion can be given.",
    false:
      "A direct answer, including a short list of corrections, can be given without first decomposing the problem.",
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

export const VERIFY_ANSWER_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions: "Does the response directly and substantively answer the user's request?",
  criteria: {
    true: "The response addresses the actual question asked and gives the user something actionable or conclusive.",
    false:
      "The response deflects, answers a different question, or leaves the user's request unaddressed.",
  },
};

export const VERIFY_EVASIVE_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Is the response vague, hedged, or non-committal in a way that avoids taking a position the request calls for?",
  criteria: {
    true: "The response leans on generic caveats, an 'it depends' frame, or filler instead of committing where a position was warranted.",
    false:
      "The response commits to a position, or clearly states what it does not know and why, without hiding behind vague hedging.",
  },
};

export const VERIFY_TRICKY_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Does this problem genuinely require decomposition, such as material assumptions, tradeoffs, or interacting constraints, such that a single direct answer would be misleading?",
  criteria: {
    true: "The problem space is genuinely conditional or multi-dimensional; a direct verdict would oversimplify it.",
    false: "A direct answer is appropriate and no significant decomposition is needed.",
  },
};
