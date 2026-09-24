/**
 * The question-spec vocabulary, and the one question the core still owns.
 *
 * Question specs live with the component that asks them, so this file keeps only
 * the shapes every component shares plus the trajectory question, which has not
 * been extracted yet. It is the intended seam for a future Langfuse
 * `getPrompt()` loop.
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
