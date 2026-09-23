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

export interface ScoreQuestionSpec {
  type: "score";
  instructions: string;
  /** Ordered rubric; a description's position is its score, starting at 0. */
  criteria: string[];
}

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
