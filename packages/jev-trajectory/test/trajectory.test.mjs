import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCE_QUESTION,
  PROGRESS,
  REGRESS_QUESTION,
  judgeTrajectory,
  progressFrom,
  summarizeProgress,
} from "../dist/index.js";

const jevConfig = {
  endpoint: "https://example.test/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 0,
};

/** A judgment with both answers at the same confidence. */
function judgment(progress, confidence = 0.9) {
  return { progress, advanceConfidence: confidence, regressConfidence: confidence };
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

test("PROGRESS is the documented set, with no stuck value", () => {
  assert.deepEqual([...PROGRESS], ["held", "advanced", "regressed", "mixed"]);
  assert.equal(PROGRESS.includes("stuck_detail"), false);
});

test("the questions are phase-agnostic and independent", () => {
  assert.match(ADVANCE_QUESTION.instructions, /any kind of work/);
  assert.match(ADVANCE_QUESTION.criteria.true, /converged on agreement/);
  // The regression question must not be collapsed by the advance answer.
  assert.match(REGRESS_QUESTION.instructions, /independently of whether/);
});

test("progressFrom composes the two answers into four outcomes", () => {
  assert.equal(progressFrom(false, false), "held");
  assert.equal(progressFrom(true, false), "advanced");
  assert.equal(progressFrom(false, true), "regressed");
  assert.equal(progressFrom(true, true), "mixed");
});

test("judgeTrajectory asks both questions in one call and composes them", async () => {
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

    // Both answers true of the same turn: the case a single axis could not say.
    assert.equal(result.progress, "mixed");
    assert.equal(result.advanceConfidence, 0.9);
    assert.equal(result.regressConfidence, 0.8);
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
    assert.equal(result.progress, "regressed");
  } finally {
    restore();
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
    [
      judgment("advanced"),
      { progress: "advanced", advanceConfidence: 0.95, regressConfidence: 0.4 },
      judgment("advanced"),
    ],
    0.7,
  );
  assert.equal(summary.counted, 2);
  assert.equal(summary.advanced, 2);
});

test("summarizeProgress reports marginals, so mixed counts toward both", () => {
  const summary = summarizeProgress(
    [judgment("advanced"), judgment("mixed"), judgment("regressed"), judgment("held")],
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
    [judgment("advanced"), judgment("mixed"), judgment("held"), judgment("regressed")],
    0.7,
  );
  assert.equal(summary.net, 0);
  // Three turns in a row that did not net forward.
  assert.equal(summary.longestStall, 3);
});

test("oscillation counts reversals, not pauses", () => {
  // A pause or a cancel does not change direction.
  assert.equal(
    summarizeProgress([judgment("advanced"), judgment("mixed"), judgment("regressed")], 0.7)
      .oscillation,
    1,
  );
  assert.equal(
    summarizeProgress(
      [judgment("advanced"), judgment("regressed"), judgment("advanced"), judgment("regressed")],
      0.7,
    ).oscillation,
    3,
  );
  assert.equal(
    summarizeProgress([judgment("advanced"), judgment("advanced"), judgment("held")], 0.7)
      .oscillation,
    0,
  );
});

test("a correction cycle and a spiral differ in the rates, not in a verdict", () => {
  const cycle = summarizeProgress(
    [judgment("mixed"), judgment("mixed"), judgment("advanced")],
    0.7,
  );
  const spiral = summarizeProgress(
    [judgment("regressed"), judgment("regressed"), judgment("held")],
    0.7,
  );

  assert.equal(cycle.regressedRate, spiral.regressedRate);
  assert.ok(cycle.advancedRate > spiral.advancedRate);
  assert.ok(cycle.net > spiral.net);
});
