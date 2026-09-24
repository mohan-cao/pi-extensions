import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCE_QUESTION,
  PROGRESS,
  REGRESS_QUESTION,
  judgeTrajectory,
  progressFrom,
  progressOf,
  summarizeProgress,
} from "../dist/index.js";

const jevConfig = {
  endpoint: "https://example.test/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 0,
};

/** A judgment built from its two answers — there is no label to get out of step. */
function judgment(advanceConfidence, regressConfidence) {
  return { advanceConfidence, regressConfidence };
}

function stubAnswers(advance, regress) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          advanced: { type: "noul", noul: advance },
          regressed: { type: "noul", noul: regress },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return () => {
    globalThis.fetch = original;
  };
}

test("PROGRESS is the documented set", () => {
  assert.deepEqual([...PROGRESS], ["held", "advanced", "regressed", "mixed"]);
});

/**
 * A prompt-contract test, not a behaviour test: rewording the questions
 * invalidates the eval baselines, so the wording is pinned deliberately. The
 * assertions name the properties the wording has to preserve.
 */
test("the question wording preserves the properties the eval assumes", () => {
  // Phase-agnostic: the same answers must read correctly in build and in design.
  assert.match(ADVANCE_QUESTION.instructions, /any kind of work/);
  assert.match(ADVANCE_QUESTION.criteria.true, /converged on agreement/);
  // The regression answer must not be collapsed by the advance answer, or the
  // four outcomes collapse back to three.
  assert.match(REGRESS_QUESTION.instructions, /independently of whether/);
});

test("progressFrom composes the two answers into four outcomes", () => {
  assert.equal(progressFrom(false, false), "held");
  assert.equal(progressFrom(true, false), "advanced");
  assert.equal(progressFrom(false, true), "regressed");
  assert.equal(progressFrom(true, true), "mixed");
});

test("progressOf applies the midpoint, and is the only place that knows it", () => {
  assert.equal(progressOf(judgment(0.9, 0.1)), "advanced");
  assert.equal(progressOf(judgment(0.1, 0.9)), "regressed");
  assert.equal(progressOf(judgment(0.9, 0.9)), "mixed");
  assert.equal(progressOf(judgment(0.1, 0.1)), "held");
  // Exactly at the midpoint counts as yes; the reliability gate is what stops a
  // coin flip from being counted.
  assert.equal(progressOf(judgment(0.5, 0.5)), "mixed");
});

test("judgeTrajectory asks both questions in one call and returns both answers", async () => {
  const originalFetch = globalThis.fetch;
  const questionsSeen = [];

  globalThis.fetch = async (_url, init) => {
    questionsSeen.push(Object.keys(JSON.parse(init.body).questions).sort());
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          advanced: { type: "noul", noul: 0.9 },
          regressed: { type: "noul", noul: 0.8 },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await judgeTrajectory([{ role: "user", text: "hi" }], "k", jevConfig);

    // Both true of the same turn: the case a single axis could not say.
    assert.equal(result.advanceConfidence, 0.9);
    assert.equal(result.regressConfidence, 0.8);
    assert.equal(progressOf(result), "mixed");
    assert.equal(result.model, "jev-1.13.0");
    assert.deepEqual(questionsSeen, [["advanced", "regressed"]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("judgeTrajectory reads a one-sided turn correctly", async () => {
  const restore = stubAnswers(0.05, 0.95);
  try {
    const result = await judgeTrajectory([{ role: "user", text: "hi" }], "k", jevConfig);
    assert.equal(progressOf(result), "regressed");
  } finally {
    restore();
  }
});

test("judgeTrajectory fails on a payload that is missing an answer", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ answers: { advanced: { type: "noul", noul: 0.9 } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    // The caller is responsible for failing open; the judge must not invent a value.
    await assert.rejects(
      () => judgeTrajectory([{ role: "user", text: "hi" }], "k", jevConfig),
      /missing answers\.regressed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("summarizeProgress returns zeros for an empty series", () => {
  assert.deepEqual(summarizeProgress([], 0.7), {
    counted: 0,
    advanced: 0,
    regressed: 0,
    mixed: 0,
    advancedRate: 0,
    regressedRate: 0,
    mixedRate: 0,
    net: 0,
    oscillation: 0,
    longestStall: 0,
  });
});

test("summarizeProgress excludes a turn where either answer is unsure", () => {
  // The gate is on the weaker of the two answers, so one uncertain answer is
  // enough to drop the turn — otherwise the rates would not be comparable.
  const summary = summarizeProgress(
    [judgment(0.9, 0.9), judgment(0.95, 0.4), judgment(0.9, 0.9)],
    0.7,
  );
  assert.equal(summary.counted, 2);
  assert.equal(summary.advanced, 2);
});

test("the gate is on decisiveness, not on the raw probability", () => {
  // A clear advance is confidently NOT a regression: P(regress) is near zero.
  // Gating on the raw probability would exclude every one-sided turn and leave
  // the signal inert — the ratio would sit at 0/1 forever.
  const summary = summarizeProgress([judgment(0.95, 0.05), judgment(0.05, 0.95)], 0.7);
  assert.equal(summary.counted, 2);
  assert.equal(summary.advanced, 1);
  assert.equal(summary.regressed, 1);
  assert.equal(summary.net, 0);

  // 0.3 is as decisive as 0.7 — both are 0.2 from the midpoint.
  assert.equal(summarizeProgress([judgment(0.3, 0.1)], 0.7).counted, 1);
  // A coin flip on either answer drops the turn.
  assert.equal(summarizeProgress([judgment(0.95, 0.5)], 0.7).counted, 0);
  assert.equal(summarizeProgress([judgment(0.55, 0.1)], 0.7).counted, 0);
});

test("summarizeProgress reports marginals, so mixed counts toward both", () => {
  const summary = summarizeProgress(
    [
      judgment(0.9, 0.1), // advanced
      judgment(0.9, 0.9), // mixed
      judgment(0.1, 0.9), // regressed
      judgment(0.1, 0.1), // held
    ],
    0.7,
  );

  assert.equal(summary.counted, 4);
  assert.equal(summary.mixed, 1);
  // advanced = pure advances + mixed; regressed = pure regressions + mixed.
  assert.equal(summary.advanced, 2);
  assert.equal(summary.regressed, 2);
  assert.equal(summary.advancedRate, 0.5);
  assert.equal(summary.regressedRate, 0.5);
  assert.equal(summary.mixedRate, 0.25);
});

test("a mixed turn cancels out of the trend, and counts as a stall", () => {
  // +1, 0, 0, -1 → net 0.
  const summary = summarizeProgress(
    [
      judgment(0.9, 0.1), // advanced
      judgment(0.9, 0.9), // mixed
      judgment(0.1, 0.1), // held
      judgment(0.1, 0.9), // regressed
    ],
    0.7,
  );
  assert.equal(summary.net, 0);
  // Three turns in a row that did not net forward.
  assert.equal(summary.longestStall, 3);
});

test("oscillation counts reversals, not pauses", () => {
  // A pause or a cancel does not change direction.
  assert.equal(
    summarizeProgress([judgment(0.9, 0.1), judgment(0.9, 0.9), judgment(0.1, 0.9)], 0.7)
      .oscillation,
    1,
  );
  assert.equal(
    summarizeProgress(
      [judgment(0.9, 0.1), judgment(0.1, 0.9), judgment(0.9, 0.1), judgment(0.1, 0.9)],
      0.7,
    ).oscillation,
    3,
  );
  assert.equal(
    summarizeProgress([judgment(0.9, 0.1), judgment(0.9, 0.1), judgment(0.1, 0.1)], 0.7)
      .oscillation,
    0,
  );
});

test("a single-turn series has no oscillation and no stall", () => {
  const summary = summarizeProgress([judgment(0.9, 0.1)], 0.7);
  assert.equal(summary.oscillation, 0);
  assert.equal(summary.longestStall, 0);
});

test("a correction cycle and a spiral differ in the rates, not in a verdict", () => {
  const cycle = summarizeProgress(
    [judgment(0.9, 0.9), judgment(0.9, 0.9), judgment(0.9, 0.1)],
    0.7,
  );
  const spiral = summarizeProgress(
    [judgment(0.1, 0.9), judgment(0.1, 0.9), judgment(0.1, 0.1)],
    0.7,
  );

  assert.equal(cycle.regressedRate, spiral.regressedRate);
  assert.ok(cycle.advancedRate > spiral.advancedRate);
  assert.ok(cycle.net > spiral.net);
});
