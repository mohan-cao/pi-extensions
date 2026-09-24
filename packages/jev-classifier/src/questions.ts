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

export interface ChoiceQuestionSpec {
  type: "choice";
  instructions: string;
  /** Choice name → when it applies. */
  criteria: Record<string, string>;
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

export const TRAJECTORY_QUESTION: ChoiceQuestionSpec = {
  type: "choice",
  instructions:
    "Is this conversation making progress, independent of what it is about? Judge the pattern across recent turns — is each turn covering new ground and resolving something, or is ground being revisited at increasing depth or in different words?",
  criteria: {
    converging:
      "Each turn covers new ground and resolves something. The conversation is moving toward a conclusion or decision.",
    stuck_detail:
      "Turns keep escalating into finer detail on the same question, revisiting ground already covered, without resolving it or reaching a decision.",
    stuck_framing:
      "Turns revisit the same issue in different words. Progress is blocked by how the problem is framed, not by missing effort.",
    early: "Too few turns, or too little substance, to judge progress.",
  },
};
