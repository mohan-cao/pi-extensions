import type { NoulQuestionSpec } from "@mohan-cao/jev-classifier";

/**
 * The progress questions — two orthogonal Nouls, asked in one call.
 *
 * Deliberately **not** one ordinal scale. A turn can advance one thing and
 * reopen another, and a single axis cannot say so; two independent answers
 * compose into four outcomes in code, the same way classification keeps
 * `normal` as a residual instead of a competing argmax candidate.
 *
 * Phase-agnostic on purpose: the same answers read correctly in build as in
 * design, and converging on agreement counts as advancing.
 */

export const ADVANCE_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Did this turn move the work forward? Judge the effect on the work itself, not how smoothly the conversation went, and judge it for any kind of work: a decision settled by agreement advances the work as much as a newly resolved detail does.",
  criteria: {
    true: "The turn settled something, moved the work forward, or converged on agreement.",
    false: "The turn neither settled anything nor moved the work forward.",
  },
};

export const REGRESS_QUESTION: NoulQuestionSpec = {
  type: "noul",
  instructions:
    "Did this turn reopen or undo something previously settled? A detail that turned out to rest on a false premise counts — catching a wrong premise is the point, but it is still a reopening. Answer this independently of whether the turn also advanced something; both can be true of the same turn.",
  criteria: {
    true: "Something previously settled was reopened, revised, or undone.",
    false: "Nothing previously settled was reopened or undone.",
  },
};
