import type { ChoiceQuestionSpec } from "@mohan-cao/jev-classifier";

/**
 * The progress question.
 *
 * Phase-agnostic on purpose. The same judgment has to read correctly in build as
 * in design — "X versus Y, and we agreed on Y" advances the work just as much as
 * a newly settled detail does — and naming a phase inside the question would
 * make it answer differently per phase for no gain.
 */
export const PROGRESS_QUESTION: ChoiceQuestionSpec = {
  type: "choice",
  instructions:
    "Did this turn move the work forward, hold, or reopen something? Judge the effect on the work itself, not how smoothly the conversation went, and judge it for any kind of work: a decision settled by agreement advances the work as much as a newly resolved detail does.",
  criteria: {
    advanced:
      "The turn settled something, moved the work forward, or converged on agreement.",
    held:
      "Neither advanced nor revisited: a clarifying question, an agreed scope, waiting on something.",
    regressed:
      "The turn reopened or undid something — including a previously settled detail that turned out to rest on a false premise.",
  },
};
